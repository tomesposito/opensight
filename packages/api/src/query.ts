import type { IncomingMessage } from 'node:http';
import { lstat, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { executeLocal, type PlanRequest } from '@opensight/query-engine';
import { isObject } from './mapping.js';
import { readJson } from './store.js';

const BODY_BYTES = 1024 * 1024;
const SALES_ARN = 'arn:aws:quicksight:us-east-1:123456789012:dataset/renderable-sales';

export class RequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

interface QueryBody {
  dimensions: { fieldId: string; columnName: string; granularity?: string }[];
  measures: { fieldId: string; columnName: string; aggregation: string }[];
  filters: ({ columnName: string; value: string } | { columnName: string; values: string[] })[];
  calculatedFields?: { name: string; expression: string }[];
}

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
function validateBody(raw: unknown): QueryBody {
  const body = record(raw, ['dimensions', 'measures', 'filters', 'calculatedFields'], '$');
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
  const filters = array(body.filters, '$.filters').map((raw, i) => {
    const path = `$.filters[${i}]`;
    const filter = record(raw, ['columnName', 'value', 'values'], path);
    const columnName = text(filter.columnName, `${path}.columnName`);
    if (Object.hasOwn(filter, 'value') === Object.hasOwn(filter, 'values')) invalid(path);
    return Object.hasOwn(filter, 'values')
      ? { columnName, values: array(filter.values, `${path}.values`).map((v, j) => text(v, `${path}.values[${j}]`, true)) }
      : { columnName, value: text(filter.value, `${path}.value`, true) };
  });
  const calculatedFields = body.calculatedFields === undefined ? undefined : array(body.calculatedFields, '$.calculatedFields').map((raw, i) => {
    const path = `$.calculatedFields[${i}]`;
    const field = record(raw, ['name', 'expression'], path);
    return { name: text(field.name, `${path}.name`), expression: text(field.expression, `${path}.expression`) };
  });
  return { dimensions, measures, filters, ...(calculatedFields ? { calculatedFields } : {}) };
}

export async function readQuery(request: IncomingMessage): Promise<QueryBody> {
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
      if (size > BODY_BYTES) throw new RequestError(413, 'Query body exceeds 1 MiB limit');
      chunks.push(bytes);
    }
    return validateBody(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size))) as unknown);
  } catch (error) {
    request.resume();
    if (error instanceof RequestError) throw error;
    throw new RequestError(400, 'Expected a valid UTF-8 JSON query body');
  }
}

/** Only the caller-selected sales fixture binding is eligible; request IDs never form paths. */
export class SalesQuery {
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

  async execute(body: QueryBody) {
    const column = (columnName: string) => ({ DataSetIdentifier: 'sales_data', ColumnName: columnName });
    // Adapt the small HTTP contract to the engine's full trusted-metadata PlanRequest.
    // Do not inherit the sample analysis's calculations or fixed East filter.
    const analysis = {
      ResourceType: 'Analysis', AnalysisId: 'live-query', Name: 'Local sales query',
      Definition: {
        DataSetIdentifierDeclarations: [{ Identifier: 'sales_data', DataSetArn: SALES_ARN }],
        CalculatedFields: (body.calculatedFields ?? []).map(field => ({ DataSetIdentifier: 'sales_data', Name: field.name, Expression: field.expression })),
        FilterGroups: body.filters.map((filter, i) => ({
          FilterGroupId: `filter-${i}`, Status: 'ENABLED', CrossDataset: 'SINGLE_DATASET', ScopeConfiguration: { AllSheets: {} },
          Filters: [{ CategoryFilter: { FilterId: `filter-${i}`, Column: column(filter.columnName),
            Configuration: { FilterListConfiguration: { MatchOperator: 'EQUALS', NullOption: 'NON_NULLS_ONLY', CategoryValues: 'values' in filter ? filter.values : [filter.value] } } } }],
        })),
        Sheets: [{ SheetId: 'query', Visuals: [{ TableVisual: { VisualId: 'query', ChartConfiguration: {
          FieldWells: { TableAggregatedFieldWells: {
            GroupBy: body.dimensions.map(field => ({ [field.granularity === undefined ? 'CategoricalDimensionField' : 'DateDimensionField']: {
              FieldId: field.fieldId, Column: column(field.columnName), ...(field.granularity === undefined ? {} : { DateGranularity: field.granularity }),
            } })),
            Values: body.measures.map(field => ({ NumericalMeasureField: { FieldId: field.fieldId, Column: column(field.columnName),
              AggregationFunction: { SimpleNumericalAggregation: field.aggregation } } })),
          } },
        } } }] }],
      },
    };
    const { plan, rows } = await executeLocal({ ...this.metadata, analysis, visualId: 'query' }, { dataRoot: this.dataRoot });
    return {
      columns: [...plan.dimensions.map(field => ({ name: field.outputName, type: 'string' as const })),
        ...plan.measures.map(field => ({ name: field.outputName, type: 'number' as const }))],
      rows,
    };
  }
}
