import { convertDefinition, parseBundleResource, safeConstruct, type BundleResource } from '@opensight/bundle-parser';
export type AssetKind = BundleResource['resourceType'];
export type Obj = Record<string, unknown>;
export function object(value: unknown): Obj {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('DEFINITION_INVALID');
  return value as Obj;
}
export function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('DEFINITION_INVALID');
  return value;
}
export { assertNoCredentials } from '@opensight/bundle-parser';
import { assertNoCredentials } from '@opensight/bundle-parser';
// Named contexts only. Maps retain literal customer table/column IDs; unknown
// API subtrees remain verbatim and unexecuted, just like definition conversion.
interface Rule { target: string; children?: Schema; dictionary?: boolean }
interface Schema { [key: string]: Rule }
const members = (names: string): Schema => Object.fromEntries(names.split(' ').map(name => [name, { target: name[0]!.toLowerCase() + name.slice(1) }]));
const columns = members('Name Type Id SubType');
const table: Schema = {
  RelationalTable: { target: 'relationalTable', children: { ...members('DataSourceArn Catalog Schema Name'), InputColumns: { target: 'inputColumns', children: columns } } },
  CustomSql: { target: 'customSql', children: { ...members('DataSourceArn Name SqlQuery'), Columns: { target: 'columns', children: columns } } },
  S3Source: { target: 's3Source', children: { ...members('DataSourceArn UploadSettings'), InputColumns: { target: 'inputColumns', children: columns } } },
};
const dataset: Schema = {
  ...members('DataSetId Name ImportMode RowLevelPermissionDataSet RowLevelPermissionTagConfiguration ColumnLevelPermissionRules DataSetUsageConfiguration DataSetRefreshProperties DataPrepConfiguration SemanticModelConfiguration'),
  PhysicalTableMap: { target: 'physicalTableMap', dictionary: true, children: table },
  LogicalTableMap: { target: 'logicalTableMap', dictionary: true, children: { ...members('Alias DataTransforms'), Source: { target: 'source', children: members('PhysicalTableId DataSetArn JoinInstruction') } } },
  OutputColumns: { target: 'outputColumns', children: columns },
};
const source: Schema = { ...members('DataSourceId Name Type'),
  DataSourceParameters: { target: 'dataSourceParameters', children: { AthenaParameters: { target: 'athenaParameters', children: members('WorkGroup RoleArn') } } },
  SslProperties: { target: 'sslProperties', children: members('DisableSsl') },
};
function map(value: unknown, schema: Schema): unknown {
  if (Array.isArray(value)) return value.map(v => map(v, schema));
  if (!value || typeof value !== 'object') return value;
  const seen = new Set<string>();
  return Object.fromEntries(Object.entries(value).map(([key, child]) => {
    const rule = Object.hasOwn(schema, key) ? schema[key] : undefined, target = rule?.target ?? key;
    if (seen.has(target)) throw new Error('DEFINITION_INVALID');
    seen.add(target);
    const result = rule?.children ? rule.dictionary
      ? Object.fromEntries(Object.entries(object(child)).map(([id, v]) => [id, map(v, rule.children!)]))
      : map(child, rule.children) : child;
    return [target, result];
  }));
}
export function assembleResource(kind: AssetKind, id: string, raw: unknown): BundleResource {
  const response = object(raw);
  assertNoCredentials(response);
  if (Array.isArray(response.Errors) && response.Errors.length || typeof response.Status === 'number' && response.Status >= 400
    || typeof response.ResourceStatus === 'string' && /FAILED|DELETED|IN_PROGRESS/.test(response.ResourceStatus)) throw new Error('DEFINITION_INVALID');
  let resource: unknown;
  if (kind === 'analysis' || kind === 'dashboard') {
    if (response[kind === 'analysis' ? 'AnalysisId' : 'DashboardId'] !== id) throw new Error('DEFINITION_INVALID');
    assertNoCredentials(response.Definition);
    resource = { resourceType: kind, [kind === 'analysis' ? 'analysisId' : 'dashboardId']: id,
      name: text(response.Name), definition: convertDefinition(response.Definition) };
  } else {
    const data = object(response[kind === 'dataset' ? 'DataSet' : 'DataSource']);
    if (data[kind === 'dataset' ? 'DataSetId' : 'DataSourceId'] !== id) throw new Error('DEFINITION_INVALID');
    // SDK metadata, creation timestamps and ARNs are not bundle properties.
    const { Arn, CreatedTime, LastUpdatedTime, Status, ErrorInfo, ...definition } = data;
    if (typeof Status === 'string' && /FAILED|DELETED/.test(Status) || ErrorInfo !== undefined) throw new Error('DEFINITION_INVALID');
    assertNoCredentials(definition);
    resource = { ...object(map(definition, kind === 'dataset' ? dataset : source)), resourceType: kind };
  }
  assertNoCredentials(resource);
  return parseBundleResource(resource);
}
export function constructInventory(resource: BundleResource): Record<string, number> {
  const counts: Record<string, number> = { [resource.resourceType]: 1 };
  const add = (key: string) => { const safe = safeConstruct(key); counts[safe] = (counts[safe] ?? 0) + 1; };
  if (resource.resourceType === 'analysis' || resource.resourceType === 'dashboard') {
    for (const [key, value] of Object.entries(resource.definition)) {
      if (key !== 'sheets') { const count = Array.isArray(value) ? value.length : 1; for (let i = 0; i < count; i++) add(key); }
    }
    for (const sheet of resource.definition.sheets ?? []) {
      add('sheet');
      for (const visual of sheet.visuals ?? []) for (const kind of Object.keys(visual)) add(kind);
    }
  } else for (const key of Object.keys(resource)) if (!['resourceType', 'dataSetId', 'dataSourceId', 'name'].includes(key)) add(key);
  return counts;
}
export function referencedAssets(resource: BundleResource): { kind: 'dataset' | 'datasource'; arn: string }[] {
  const refs: { kind: 'dataset' | 'datasource'; arn: string }[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v && typeof v === 'object') for (const [key, child] of Object.entries(v)) {
      if (['dataSetArn', 'DataSetArn', 'dataSourceArn', 'DataSourceArn'].includes(key) && typeof child === 'string') refs.push({ kind: /[sS]ource/.test(key) ? 'datasource' : 'dataset', arn: child });
      else walk(child);
    }
  };
  walk(resource); return refs;
}
