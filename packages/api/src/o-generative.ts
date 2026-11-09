import { disabledAnalytics } from './analytics.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { interpretQuestion, withGovernedMetrics, type InterpretationResult, type SchemaField } from '@opensight/o-interpreter';
import { resolveSecurity, ExpressionBinder, parseExpression, QueryEngineError } from '@opensight/query-engine';
import { method, send } from './automation-routes.js';
import { AIError } from './ai-providers.js';
import { generativeInstructions, planInstructions, reviseInstructions, hasFieldNamePII, redactPII } from './ai-guard.js';
import type { Completion } from './ai-providers.js';
import type { PublishedMetric, InteractiveQuery } from '@opensight/query-engine';
import type { AISettings } from './ai-settings.js';
import { readBody, RequestError, type SalesQuery } from './query.js';
import { record, invalid } from './schedule.js';
import type { Identity, SecurityService } from './security.js';
import type { OrganizationService } from './organization.js';
import { requireOScope } from './o-routes.js';

export interface GenerativeSchemaSource {
  securitySchema(): Promise<{ columns: Parameters<typeof resolveSecurity>[1]; deniedColumns: readonly string[]; datasetId: string }>;
  metricLookup(): Promise<readonly PublishedMetric[]>;
  execute(query: InteractiveQuery): Promise<unknown>;
}
export interface DeliveredCompletion { text: string; managed?: boolean; commit(count?: number): Promise<void>; remaining?(): Promise<number> }
export interface AnswerReceiptHooks {
  pending(answer: unknown, count: number, completion: DeliveredCompletion): Promise<void>;
  committed(): Promise<void>;
}
async function schema(body: Record<string, unknown>, source: GenerativeSchemaSource) {
  const metadata = await source.securitySchema(), policy = { deniedColumns: metadata.deniedColumns };
  const raw = body.calculatedFields ?? [];
  if (!Array.isArray(raw) || raw.length > 100) invalid('$.calculatedFields', 'expected at most 100 calculations');
  const declarations = raw.map(value => {
    const c = record(value, ['name', 'expression', 'role']);
    if (typeof c.name !== 'string' || typeof c.expression !== 'string' || !['dimension', 'measure'].includes(String(c.role))) invalid('$.calculatedFields', 'invalid calculation');
    // The provider prompt carries field names as data, but the O interpreter
    // rejects unsafe schema names outright — fail here with a clear 400
    // instead of spending a provider call on a request that cannot succeed.
    if (!c.name.trim() || /[{}\0]/.test(c.name)) invalid('$.calculatedFields', 'calculated field names must be nonempty and cannot contain braces');
    return { Name: c.name, Expression: c.expression, DataSetIdentifier: metadata.datasetId };
  });
  const binder = new ExpressionBinder(metadata.datasetId, metadata.columns, declarations, [], {}, (name, path) => {
    // #180: match missing-name binding failures before any provider call.
    if (policy.deniedColumns.includes(name)) throw new QueryEngineError('UNRESOLVED_BINDING', path, `unknown column: ${name}`);
  });
  const fields: SchemaField[] = metadata.columns.filter(c => !policy.deniedColumns.includes(c.name)).map(c => ({ name: c.name, type: c.type }));
  for (const c of declarations) {
    const bound = binder.bind(c.Name, '$.calculatedFields');
    fields.push({ name: c.Name, type: bound.scalarType === 'number' ? 'DECIMAL' : bound.scalarType === 'datetime' ? 'DATETIME' : 'STRING' });
  }
  const metrics = await source.metricLookup();
  return { fields: withGovernedMetrics(fields, metadata.datasetId, metrics.map(m => ({ ...m, datasetId: metadata.datasetId, state: 'published' }))), binder };
}
function providerObject(text: string, keys: string[]): Record<string, unknown> {
  try { return record(JSON.parse(text) as unknown, keys); }
  catch { throw new AIError(502, 'O_INVALID_PROVIDER_RESPONSE', 'Provider did not return a supported O response'); }
}
export async function generativeRoute(request: IncomingMessage, response: ServerResponse, path: string, query: string, identity: Identity, security: SecurityService, organization: OrganizationService, ai: AISettings, sales?: SalesQuery, analytics = disabledAnalytics): Promise<boolean> {
  if (!['/api/o/status', '/api/o/generate', '/api/o/calculation', '/api/o/plan', '/api/o/revise'].includes(path)) return false;
  security.require(identity, 'ai');
  if (query) throw new RequestError(400, 'Query parameters are not supported');
  if (path === '/api/o/status') { method(request, response, ['GET']); send(response, 200, ai.status(identity.namespaceId)); return true; }
  method(request, response, ['POST']);
  const calculation = path === '/api/o/calculation';
  if (calculation) security.require(identity, 'build');
  const body = record(await readBody(request), ['question', 'dashboardId', 'calculatedFields', ...(path === '/api/o/revise' ? ['currentQuestion'] : [])]);
  requireOScope(body, identity, security, organization, sales);
  const source: GenerativeSchemaSource = {
    securitySchema: async () => { const m = sales!.securitySchema(); return { columns: m.columns, deniedColumns: resolveSecurity(security.context(identity), m.columns, m.localData.dataSetArn).deniedColumns, datasetId: 'sales' }; },
    metricLookup: async () => sales!.metricLookup ? (await sales!.metricLookup(identity)({ kind: 'dataset', id: 'sales' })).metrics : [],
    execute: query => sales!.execute(query, identity),
  };
  const answer = path === '/api/o/plan' ? planAnswer : path === '/api/o/revise' ? reviseAnswer : (body: Record<string, unknown>, ...args: Parameters<typeof planAnswer> extends [unknown, ...infer Rest] ? Rest : never) => generateAnswer(body, calculation, ...args);
  const result = await answer(body, source, async input => ({ text: await ai.complete(identity.namespaceId, input), commit: async () => {} }), async () => {
    requireOScope(body, identity, security, organization, sales); if (calculation) security.require(identity, 'build');
  }, (count = 1) => analytics.track({ tenantId: identity.namespaceId, namespaceId: identity.namespaceId }, { name: 'ask_o_asked', props: { count } }));
  send(response, 200, result); return true;
}
/** Both planes share the guard, prompt, grammar and calculation validation. */
export async function generateAnswer(body: Record<string, unknown>, calculation: boolean, source: GenerativeSchemaSource,
  complete: (input: Completion) => Promise<DeliveredCompletion>, recheck: () => Promise<void>, onAsked: (count: number) => void = () => {}, checkCancelled: () => void = () => {}, receipt?: AnswerReceiptHooks) {
  if (typeof body.question !== 'string' || !body.question.trim() || body.question.length > 2000) invalid('$.question', 'expected 1–2000 characters');
  const before = await schema(body, source);
  if (hasFieldNamePII(before.fields)) throw new AIError(400, 'AI_FIELD_NAME_PII', 'A field name matches a sensitive-data pattern. Rename the field before using generative AI.');
  if (!calculation) onAsked(1);
  // Prompts are the one place user-influenced content meets the provider:
  // the question is PII-redacted, field names pass the shared PII guard,
  // and JSON strings plus system instructions pin content as data, never rules.
  const instructions = generativeInstructions(calculation);
  const completion = await complete( { system: instructions, prompt: JSON.stringify({ question: redactPII(body.question), fields: before.fields }) });
  // Authorization and policy changes during provider I/O must not release stale answers.
  await recheck(); checkCancelled();
  const current = await schema(body, source);
  if (calculation) {
    const result = providerObject(completion.text, ['name', 'expression', 'role', 'explanation']);
    if (typeof result.name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_ ]{0,127}$/.test(result.name) || current.fields.some(f => f.name.toLowerCase() === String(result.name).toLowerCase()) || typeof result.expression !== 'string' || typeof result.explanation !== 'string' || result.explanation.length > 2000 || !['measure', 'dimension'].includes(String(result.role))) throw new AIError(502, 'O_INVALID_PROVIDER_RESPONSE', 'Provider returned an invalid calculated field');
    const parsed = parseExpression(result.expression, '$.expression', { bind: (name, path) => current.binder.bind(name, path) });
    if (result.role === 'measure' && parsed.scalarType !== 'number') throw new AIError(502, 'O_INVALID_PROVIDER_RESPONSE', 'Measure expression must return a number');
    const answer = { suggestion: result };
    await receipt?.pending(answer, 1, completion);
    checkCancelled();
    await completion.commit();
    await receipt?.committed();
    return answer;
  } else {
    const value = providerObject(completion.text, ['question']);
    if (typeof value.question !== 'string' || !value.question.trim() || value.question.length > 2000) throw new AIError(422, 'O_UNSUPPORTED_QUESTION', 'Provider could not express this question in the supported O grammar');
    const result = interpretQuestion(value.question, current.fields);
    if (!result.interpretations.length || result.errors.some(e => e.code !== 'AMBIGUOUS_QUESTION')) throw new AIError(422, 'O_UNSUPPORTED_QUESTION', 'Provider returned an unsupported interpretation');
    const answer = { ...result, question: value.question };
    await receipt?.pending(answer, 1, completion);
    checkCancelled();
    await completion.commit();
    await receipt?.committed();
    return answer;
  }
}

export interface PlanTile { question: string; status: 'ok' | 'failed' | 'credit-limited'; result?: InterpretationResult; code?: string; message?: string }
export interface PlanAnswer { sheetTitle: string; tiles: PlanTile[]; delivered: number }
type Complete = (input: Completion) => Promise<DeliveredCompletion>;
function prompt(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000) invalid(path, 'expected 1–2000 characters');
}
function diagnostic(result: InterpretationResult) {
  return result.errors.find(e => e.code !== 'AMBIGUOUS_QUESTION') ?? (!result.interpretations.length ? { code: 'O_UNSUPPORTED_QUESTION', message: 'This question cannot be expressed in the supported O grammar.' } : undefined);
}
async function guardedSchema(body: Record<string, unknown>, source: GenerativeSchemaSource) {
  const value = await schema(body, source);
  if (hasFieldNamePII(value.fields)) throw new AIError(400, 'AI_FIELD_NAME_PII', 'A field name matches a sensitive-data pattern. Rename the field before using generative AI.');
  return value;
}
export async function planAnswer(body: Record<string, unknown>, source: GenerativeSchemaSource, complete: Complete, recheck: () => Promise<void>, onAsked: (count: number) => void = () => {}, checkCancelled: () => void = () => {}, receipt?: AnswerReceiptHooks): Promise<PlanAnswer> {
  prompt(body.question, '$.question');
  const before = await guardedSchema(body, source);
  const completion = await complete({ system: planInstructions(), prompt: JSON.stringify({ question: redactPII(body.question), fields: before.fields }) });
  await recheck(); checkCancelled();
  const current = await schema(body, source);
  const value = providerObject(completion.text, ['sheetTitle', 'questions']);
  if (!Array.isArray(value.questions) || !value.questions.every(q => typeof q === 'string')) throw new AIError(502, 'O_INVALID_PROVIDER_RESPONSE', 'Provider did not return a supported O response');
  const sheetTitle = typeof value.sheetTitle === 'string' && value.sheetTitle.trim() && value.sheetTitle.length <= 80 && !/[{}\p{Cc}]/u.test(value.sheetTitle) ? value.sheetTitle.trim() : 'Ask O dashboard';
  const remaining = completion.remaining ? await completion.remaining() : Infinity;
  let delivered = 0;
  const tiles: PlanTile[] = [...new Set<string>(value.questions)].slice(0, 8).map(question => {
    const result = interpretQuestion(question, current.fields), error = diagnostic(result);
    if (error) return { question, status: 'failed', ...error };
    if (delivered >= remaining) return { question, status: 'credit-limited', code: 'AI_CREDITS_EXHAUSTED', message: 'No monthly credits remain for this tile.' };
    delivered++;
    return { question, status: 'ok', result: { ...result, interpretations: result.interpretations.slice(0, 1) } };
  });
  const answer = { sheetTitle, tiles, delivered };
  await receipt?.pending(answer, delivered, completion);
  checkCancelled();
  await completion.commit(delivered);
  await receipt?.committed();
  onAsked(delivered);
  return answer;
}
export async function reviseAnswer(body: Record<string, unknown>, source: GenerativeSchemaSource, complete: Complete, recheck: () => Promise<void>, onAsked: (count: number) => void = () => {}, checkCancelled: () => void = () => {}, receipt?: AnswerReceiptHooks) {
  prompt(body.question, '$.question'); prompt(body.currentQuestion, '$.currentQuestion');
  const before = await guardedSchema(body, source);
  const validate = (question: string, fields: SchemaField[]) => {
    const result = interpretQuestion(question, fields), error = diagnostic(result);
    if (error) throw new AIError(422, error.code, error.message);
    return result;
  };
  validate(body.currentQuestion, before.fields);
  const completion = await complete({ system: reviseInstructions(), prompt: JSON.stringify({ question: redactPII(body.question), currentQuestion: redactPII(body.currentQuestion), fields: before.fields }) });
  await recheck(); checkCancelled();
  const current = await schema(body, source);
  validate(body.currentQuestion, current.fields);
  const value = providerObject(completion.text, ['question']);
  if (typeof value.question !== 'string' || !value.question.trim() || value.question.length > 2000) throw new AIError(422, 'O_UNSUPPORTED_QUESTION', 'Provider could not express this question in the supported O grammar');
  const result = validate(value.question, current.fields);
  const answer = { ...result, question: value.question };
  await receipt?.pending(answer, 1, completion);
  checkCancelled();
  await completion.commit();
  await receipt?.committed();
  onAsked(1);
  return answer;
}
