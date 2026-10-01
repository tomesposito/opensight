import { validateParameters } from '@opensight/query-engine/parameters';
import type { IncomingMessage } from 'node:http';
import { lstat, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { bindMetadata, executeLocal, refreshLocal, planVisual, interactiveRequest, type InteractiveQuery, type PlanRequest } from '@opensight/query-engine';
import type { Identity, SecurityService } from './security.js';
import { isObject } from './mapping.js';
import { readJson } from './store.js';

const BODY_BYTES = 1024 * 1024;
const SALES_ARN = 'arn:aws:quicksight:us-east-1:123456789012:dataset/renderable-sales';

export class RequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export class SecurityError extends RequestError {
  constructor(status: number, readonly code: string, message: string) { super(status, message); this.name = 'SecurityError'; }
}

type QueryBody = InteractiveQuery;

function invalid(path: string): never { throw new RequestError(400, `${path}: invalid query body`); }
function record(value: unknown, allowed: string[], path: string): Record<string, unknown> {
  if (!isObject(value) || Object.keys(value).some(key => !allowed.includes(key))) invalid(path);
  return value;
}
function text(value: unknown, path: string, empty = false): string {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.includes('\0')) invalid(path);
  return value;
}
function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) invalid(path);
  return value;
}

/** Validate the transport shape; unsupported semantic values belong to the engine (422). */
export function validateQuery(raw: unknown): QueryBody {
  if (isObject(raw) && ['principal', 'principals', 'user', 'userId', 'groups', 'groupIds', 'namespace', 'namespaceId', 'security', 'policy', 'role', 'roles', 'capabilities'].some(k => Object.hasOwn(raw, k))) throw new SecurityError(403, 'FORGED_PRINCIPAL', 'Query bodies cannot assert identity or policy');
  const body = record(raw, ['dimensions', 'measures', 'filters', 'calculatedFields', 'parameterDeclarations', 'parameterBindings'], '$');
  let parameters: ReturnType<typeof validateParameters>;
  try { parameters = validateParameters(body.parameterDeclarations, body.parameterBindings); }
  catch (error) { throw new RequestError(400, error instanceof Error ? error.message : String(error)); }
  const dimensions = array(body.dimensions, '$.dimensions').map((raw, i) => {
    const path = `$.dimensions[${i}]`;
    const field = record(raw, ['fieldId', 'columnName', 'granularity'], path);
    return { fieldId: text(field.fieldId, `${path}.fieldId`), columnName: text(field.columnName, `${path}.columnName`),
      ...(field.granularity === undefined ? {} : { granularity: text(field.granularity, `${path}.granularity`) }) };
  });
  const measures = array(body.measures, '$.measures').map((raw, i) => {
    const path = `$.measures[${i}]`;
    const field = record(raw, ['fieldId', 'columnName', 'aggregation'], path);
    return { fieldId: text(field.fieldId, `${path}.fieldId`), columnName: text(field.columnName, `${path}.columnName`),
      aggregation: text(field.aggregation, `${path}.aggregation`) };
  });
  if (!measures.length) invalid('$.measures');
  const filters: QueryBody['filters'] = array(body.filters, '$.filters').map((raw, i) => {
    const path = `$.filters[${i}]`;
    const filter = record(raw, ['columnName', 'value', 'values', 'parameterName', 'operator'], path);
    const columnName = text(filter.columnName, `${path}.columnName`);
    if (['value', 'values', 'parameterName'].filter(k => Object.hasOwn(filter, k)).length !== 1) invalid(path);
    if (Object.hasOwn(filter, 'parameterName')) {
      const parameterName = text(filter.parameterName, `${path}.parameterName`);
      const parameter = parameters.declarations.find(p => p.name === parameterName);
      if (!parameter) throw new RequestError(400, `${path}.parameterName: undeclared parameter ${parameterName}`);
      const operator = filter.operator ?? 'EQUALS';
      if (!['EQUALS', 'GREATER_THAN_OR_EQUAL_TO', 'LESS_THAN_OR_EQUAL_TO'].includes(String(operator)) || operator !== 'EQUALS' && (parameter.multiple || parameter.type === 'string')) throw new RequestError(400, `${path}.operator: expected equality, or a range comparison with a single number/datetime parameter`);
      return { columnName, parameterName, operator: operator as 'EQUALS' | 'GREATER_THAN_OR_EQUAL_TO' | 'LESS_THAN_OR_EQUAL_TO' };
    }
    if (Object.hasOwn(filter, 'operator')) invalid(`${path}.operator`);
    return Object.hasOwn(filter, 'values')
      ? { columnName, values: array(filter.values, `${path}.values`).map((v, j) => text(v, `${path}.values[${j}]`, true)) }
      : { columnName, value: text(filter.value, `${path}.value`, true) };
  });
  const calculatedFields = body.calculatedFields === undefined ? undefined : array(body.calculatedFields, '$.calculatedFields').map((raw, i) => {
    const path = `$.calculatedFields[${i}]`;
    const field = record(raw, ['name', 'expression'], path);
    return { name: text(field.name, `${path}.name`), expression: text(field.expression, `${path}.expression`) };
  });
  return { dimensions, measures, filters, ...(calculatedFields ? { calculatedFields } : {}), ...(body.parameterDeclarations !== undefined || body.parameterBindings !== undefined ? { parameterDeclarations: parameters.declarations, parameterBindings: parameters.bindings } : {}) };
}

export async function readQuery(request: IncomingMessage): Promise<QueryBody> {
  return validateQuery(await readBody(request));
}

export async function readBody(request: IncomingMessage, maxBytes = BODY_BYTES): Promise<unknown> {
  if (request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
    request.resume();
    throw new RequestError(400, 'Expected application/json');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    // Retain the socket on early exit so an oversized request receives a JSON error.
    for await (const chunk of request.iterator({ destroyOnReturn: false })) {
      const bytes = chunk as Buffer;
      size += bytes.length;
      if (size > maxBytes) throw new RequestError(413, `Request body exceeds ${maxBytes / (1024 * 1024)} MiB limit`);
      chunks.push(bytes);
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size))) as unknown;
  } catch (error) {
    request.resume();
    if (error instanceof RequestError) throw error;
    throw new RequestError(400, 'Expected a valid UTF-8 JSON query body');
  }
}

/** Only the caller-selected sales fixture binding is eligible; request IDs never form paths. */
export class SalesQuery {
  security?: SecurityService;
  securitySchema() { return bindMetadata(this.metadata.dataSet, this.metadata.dataSource, this.metadata.localData, true); }
  private secured(request: PlanRequest, identity?: Identity): PlanRequest {
    return this.security ? { ...request, security: this.security.context(identity) } : request;
  }
  private constructor(private readonly metadata: Pick<PlanRequest, 'dataSet' | 'dataSource' | 'localData'>,
    private readonly dataRoot: string) {}

  static async load(dataRoot: string): Promise<SalesQuery | undefined> {
    const root = resolve(dataRoot);
    const directory = (await lstat(root)).isDirectory() ? root : dirname(root);
    for (const candidate of [join(directory, 'renderable-sales'), directory]) {
      try {
        if (!(await lstat(candidate)).isDirectory()) continue;
        const localData = await readJson(join(candidate, 'local-data.json'));
        if (!isObject(localData) || localData.dataSetArn !== SALES_ARN || localData.physicalTableId !== 'sales' || localData.csv !== 'sales.csv') continue;
        const csv = join(candidate, 'sales.csv');
        if (!(await lstat(csv)).isFile() || await realpath(csv) !== join(await realpath(candidate), 'sales.csv')) continue;
        const dataSet = await readJson(join(candidate, 'describe-data-set.response.json'));
        const dataSource = await readJson(join(candidate, 'describe-data-source.response.json'));
        return new SalesQuery({ dataSet, dataSource, localData }, candidate);
      } catch (error) {
        if (isObject(error) && error.code === 'ENOENT') continue;
        throw error;
      }
    }
    return undefined;
  }

  async execute(body: QueryBody, identity?: Identity) {
    const { plan, rows } = await executeLocal(this.secured(interactiveRequest(body, this.metadata), identity), { dataRoot: this.dataRoot });
    return {
      columns: [...plan.dimensions.map(field => ({ name: field.outputName, type: 'string' as const })),
        ...plan.measures.map(field => ({ name: field.outputName, type: 'number' as const }))],
      rows,
    };
  }

  private visualRequest(definition: unknown, visualId: string, window?: { columnName: string; start: string; end: string }): PlanRequest {
    return { ...this.metadata, visualId, analysis: { ResourceType: 'Analysis', AnalysisId: 'snapshot', Name: 'Dashboard snapshot', Definition: definition },
      ...(window ? { parameterDeclarations: [{ name: 'OSPeriodStart', type: 'datetime' as const, multiple: false }, { name: 'OSPeriodEnd', type: 'datetime' as const, multiple: false }],
        parameterBindings: { OSPeriodStart: [window.start], OSPeriodEnd: [window.end] }, parameterFilters: [
          { columnName: window.columnName, parameterName: 'OSPeriodStart', operator: 'GREATER_THAN_OR_EQUAL_TO' as const },
          { columnName: window.columnName, parameterName: 'OSPeriodEnd', operator: 'LESS_THAN_OR_EQUAL_TO' as const },
        ] } : {}) };
  }
  planDefinition(definition: unknown, visualId: string, window?: { columnName: string; start: string; end: string }) {
    return planVisual(this.secured(this.visualRequest(definition, visualId, window)));
  }
  async executeVisual(definition: unknown, visualId: string, window?: { columnName: string; start: string; end: string }, identity?: Identity) {
    return executeLocal(this.secured(this.visualRequest(definition, visualId, window), identity), { dataRoot: this.dataRoot });
  }

  async refresh(): Promise<number> {
    return refreshLocal(this.secured(interactiveRequest({ dimensions: [], measures: [{ fieldId: 'rows', columnName: 'revenue', aggregation: 'COUNT' }], filters: [] }, this.metadata)), { dataRoot: this.dataRoot });
  }
}
