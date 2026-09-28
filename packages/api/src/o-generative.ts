import type { IncomingMessage, ServerResponse } from 'node:http';
import { interpretQuestion, type SchemaField } from '@opensight/o-interpreter';
import { resolveSecurity, ExpressionBinder, parseExpression, QueryEngineError } from '@opensight/query-engine';
import { method, send } from './automation-routes.js';
import { AIError } from './ai-providers.js';
import type { AISettings } from './ai-settings.js';
import { readBody, RequestError, type SalesQuery } from './query.js';
import { record, invalid } from './schedule.js';
import type { Identity, SecurityService } from './security.js';
import type { OrganizationService } from './organization.js';
import { requireOScope } from './o-routes.js';

function schema(body: Record<string, unknown>, sales: SalesQuery, identity: Identity, security: SecurityService) {
  const metadata = sales.securitySchema();
  const policy = resolveSecurity(security.context(identity), metadata.columns, metadata.localData.dataSetArn);
  const raw = body.calculatedFields ?? [];
  if (!Array.isArray(raw) || raw.length > 100) invalid('$.calculatedFields', 'expected at most 100 calculations');
  const declarations = raw.map(value => {
    const c = record(value, ['name', 'expression', 'role']);
    if (typeof c.name !== 'string' || typeof c.expression !== 'string' || !['dimension', 'measure'].includes(String(c.role))) invalid('$.calculatedFields', 'invalid calculation');
    return { Name: c.name, Expression: c.expression, DataSetIdentifier: 'sales' };
  });
  const binder = new ExpressionBinder('sales', metadata.columns, declarations, [], {}, (name, path) => {
    if (policy.deniedColumns.includes(name)) throw new QueryEngineError('COLUMN_ACCESS_DENIED', path, 'Column access denied');
  });
  const fields: SchemaField[] = metadata.columns.filter(c => !policy.deniedColumns.includes(c.name)).map(c => ({ name: c.name, type: c.type }));
  for (const c of declarations) {
    const bound = binder.bind(c.Name, '$.calculatedFields');
    fields.push({ name: c.Name, type: bound.scalarType === 'number' ? 'DECIMAL' : bound.scalarType === 'datetime' ? 'DATETIME' : 'STRING' });
  }
  return { fields, binder };
}
function providerObject(text: string, keys: string[]): Record<string, unknown> {
  try { return record(JSON.parse(text) as unknown, keys); }
  catch { throw new AIError(502, 'O_INVALID_PROVIDER_RESPONSE', 'Provider did not return a supported O response'); }
}
export async function generativeRoute(request: IncomingMessage, response: ServerResponse, path: string, query: string, identity: Identity, security: SecurityService, organization: OrganizationService, ai: AISettings, sales?: SalesQuery): Promise<boolean> {
  if (!['/api/o/status', '/api/o/generate', '/api/o/calculation'].includes(path)) return false;
  security.require(identity, 'ai');
  if (query) throw new RequestError(400, 'Query parameters are not supported');
  if (path === '/api/o/status') { method(request, response, ['GET']); send(response, 200, ai.status(identity.namespaceId)); return true; }
  method(request, response, ['POST']);
  const calculation = path === '/api/o/calculation';
  if (calculation) security.require(identity, 'build');
  const body = record(await readBody(request), ['question', 'dashboardId', 'calculatedFields']);
  requireOScope(body, identity, security, organization, sales);
  if (typeof body.question !== 'string' || !body.question.trim() || body.question.length > 2000) invalid('$.question', 'expected 1–2000 characters');
  const before = schema(body, sales!, identity, security);
  const instructions = calculation
    ? 'Return JSON only: {"name":"New field name","expression":"QuickSight calculated field expression","role":"measure or dimension","explanation":"Short explanation"}. Use only supplied fields. No SQL, scripts, tools, or invented functions.'
    : 'Translate the question to the supported analytical grammar. Return JSON only: {"question":"canonical question"}. Grammar: sum|avg|count|min|max FIELD [by FIELD [and FIELD]] [per month|year|quarter|day] [in YEAR] [where FIELD is VALUE] [top N] [bar|line|pie|table]. count rows is supported. Use exact supplied field names, quoting names with spaces. Do not drop requested conditions or invent data. If unsupported return {"question":""}.';
  const text = await ai.complete(identity.namespaceId, { system: instructions, prompt: JSON.stringify({ question: body.question, fields: before.fields }) });
  // Authorization and policy changes during provider I/O must not release stale answers.
  requireOScope(body, identity, security, organization, sales);
  if (calculation) security.require(identity, 'build');
  const current = schema(body, sales!, identity, security);
  if (calculation) {
    const result = providerObject(text, ['name', 'expression', 'role', 'explanation']);
    if (typeof result.name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_ ]{0,127}$/.test(result.name) || current.fields.some(f => f.name.toLowerCase() === String(result.name).toLowerCase()) || typeof result.expression !== 'string' || typeof result.explanation !== 'string' || result.explanation.length > 2000 || !['measure', 'dimension'].includes(String(result.role))) throw new AIError(502, 'O_INVALID_PROVIDER_RESPONSE', 'Provider returned an invalid calculated field');
    const parsed = parseExpression(result.expression, '$.expression', { bind: (name, path) => current.binder.bind(name, path) });
    if (result.role === 'measure' && parsed.scalarType !== 'number') throw new AIError(502, 'O_INVALID_PROVIDER_RESPONSE', 'Measure expression must return a number');
    send(response, 200, { suggestion: result });
  } else {
    const value = providerObject(text, ['question']);
    if (typeof value.question !== 'string' || !value.question.trim() || value.question.length > 2000) throw new AIError(422, 'O_UNSUPPORTED_QUESTION', 'Provider could not express this question in the supported O grammar');
    const result = interpretQuestion(value.question, current.fields);
    if (!result.interpretations.length || result.errors.some(e => e.code !== 'AMBIGUOUS_QUESTION')) throw new AIError(422, 'O_UNSUPPORTED_QUESTION', 'Provider returned an unsupported interpretation');
    send(response, 200, result);
  }
  return true;
}
