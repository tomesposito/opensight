import type { BoundColumn, ColumnType, LocalDataBinding, ScalarType } from './types.js';
import { array, emptyArray, equals, fail, keys, object, string, unique, variant } from './validation.js';

const scalarTypes: Record<ColumnType, ScalarType> = {
  INTEGER: 'number', DECIMAL: 'number', STRING: 'string', DATETIME: 'datetime',
};

function columns(raw: unknown, path: string): BoundColumn[] {
  const names = new Set<string>();
  const result = array(raw, path).map((value, index) => {
    const p = `${path}[${index}]`;
    const c = object(value, p);
    keys(c, ['Name', 'Type'], p);
    const name = string(c.Name, `${p}.Name`);
    unique(names, name, `${p}.Name`);
    const type = string(c.Type, `${p}.Type`);
    if (!Object.hasOwn(scalarTypes, type)) fail('UNSUPPORTED_FEATURE', `${p}.Type`, `unsupported column type: ${type}`);
    const columnType = type as ColumnType;
    return { name, type: columnType, scalarType: scalarTypes[columnType], nullable: true };
  });
  if (!result.length) fail('INVALID_INPUT', path, 'at least one column is required');
  return result;
}

export function bindMetadata(dataSet: unknown, dataSource: unknown, localData: unknown, hasSecurity = false): {
  columns: BoundColumn[]; tableName: string; tableSchema: string; localData: LocalDataBinding;
} {
  const response = object(dataSet, '$.dataSet');
  keys(response, ['DataSet', 'RequestId', 'Status'], '$.dataSet');
  const path = '$.dataSet.DataSet';
  const ds = object(response.DataSet, path);
  for (const key of Object.keys(ds)) {
    if (/security|permission|restriction/i.test(key)) {
      fail('SECURITY_REJECTED', `${path}.${key}`, 'protected or unresolved datasets cannot execute');
    }
  }
  keys(ds, ['Arn', 'DataSetId', 'Name', 'ImportMode', 'PhysicalTableMap', 'LogicalTableMap', 'OutputColumns'], path);
  const arn = string(ds.Arn, `${path}.Arn`);
  string(ds.DataSetId, `${path}.DataSetId`);
  string(ds.Name, `${path}.Name`);
  equals(ds.ImportMode, 'DIRECT_QUERY', `${path}.ImportMode`);
  const [physicalId, physical] = variant(ds.PhysicalTableMap, `${path}.PhysicalTableMap`);
  keys(physical, ['RelationalTable'], `${path}.PhysicalTableMap.${physicalId}`);
  const pp = `${path}.PhysicalTableMap.${physicalId}.RelationalTable`;
  const table = object(physical.RelationalTable, pp);
  keys(table, ['DataSourceArn', 'Schema', 'Name', 'InputColumns'], pp);
  const sourceArn = string(table.DataSourceArn, `${pp}.DataSourceArn`);
  const tableSchema = string(table.Schema, `${pp}.Schema`);
  const tableName = string(table.Name, `${pp}.Name`);
  const inputColumns = columns(table.InputColumns, `${pp}.InputColumns`);
  const outputColumns = columns(ds.OutputColumns, `${path}.OutputColumns`);
  if (JSON.stringify(inputColumns) !== JSON.stringify(outputColumns)) {
    fail('UNSUPPORTED_FEATURE', `${path}.OutputColumns`, 'output columns must match the untransformed physical schema');
  }
  const [logicalId, logical] = variant(ds.LogicalTableMap, `${path}.LogicalTableMap`);
  const lp = `${path}.LogicalTableMap.${logicalId}`;
  keys(logical, ['Alias', 'Source', 'DataTransforms'], lp);
  string(logical.Alias, `${lp}.Alias`);
  emptyArray(logical.DataTransforms, `${lp}.DataTransforms`);
  const source = object(logical.Source, `${lp}.Source`);
  keys(source, ['PhysicalTableId'], `${lp}.Source`);
  if (source.PhysicalTableId !== physicalId) fail('UNRESOLVED_BINDING', `${lp}.Source.PhysicalTableId`, 'physical table does not resolve');

  const sr = object(dataSource, '$.dataSource');
  keys(sr, ['DataSource', 'RequestId', 'Status'], '$.dataSource');
  const sp = '$.dataSource.DataSource';
  const src = object(sr.DataSource, sp);
  for (const key of Object.keys(src)) {
    if (/security|permission|restriction|vpc|ssl/i.test(key)) {
      fail('SECURITY_REJECTED', `${sp}.${key}`, 'source restrictions are not supported');
    }
  }
  keys(src, ['Arn', 'DataSourceId', 'Name', 'Type', 'Status', 'DataSourceParameters'], sp);
  if (src.Arn !== sourceArn) fail('UNRESOLVED_BINDING', `${sp}.Arn`, 'data source does not match physical table');
  string(src.DataSourceId, `${sp}.DataSourceId`);
  string(src.Name, `${sp}.Name`);
  if (src.Type !== 'POSTGRESQL' && src.Type !== 'MYSQL') fail('UNSUPPORTED_FEATURE', `${sp}.Type`, 'expected POSTGRESQL or MYSQL');
  equals(src.Status, 'CREATION_SUCCESSFUL', `${sp}.Status`);
  const [parameterKind, parameters] = variant(src.DataSourceParameters, `${sp}.DataSourceParameters`);
  equals(parameterKind, src.Type === 'MYSQL' ? 'MySqlParameters' : 'PostgreSqlParameters', `${sp}.DataSourceParameters`);
  keys(parameters, ['Host', 'Port', 'Database'], `${sp}.DataSourceParameters.${parameterKind}`);
  string(parameters.Host, `${sp}.DataSourceParameters.${parameterKind}.Host`);
  string(parameters.Database, `${sp}.DataSourceParameters.${parameterKind}.Database`);
  if (!Number.isInteger(parameters.Port) || Number(parameters.Port) < 1 || Number(parameters.Port) > 65535) {
    fail('INVALID_INPUT', `${sp}.DataSourceParameters.${parameterKind}.Port`, 'expected a valid port');
  }

  const bp = '$.localData';
  const binding = object(localData, bp);
  keys(binding, ['provenance', 'dataSetArn', 'physicalTableId', 'csv', 'nullEncoding', 'timezone', 'security'], bp);
  const provenance = string(binding.provenance, `${bp}.provenance`);
  if (binding.dataSetArn !== arn || binding.physicalTableId !== physicalId) {
    fail('UNRESOLVED_BINDING', bp, 'CSV binding does not match dataset and physical table');
  }
  const security = binding.security;
  if (typeof security !== 'object' || security === null || Array.isArray(security)) {
    fail('SECURITY_REJECTED', `${bp}.security`, 'explicit local dataset and source security declarations are required');
  }
  const policy = object(security, `${bp}.security`);
  if (Object.keys(policy).length !== 2 || (policy.dataset !== 'unrestricted' && !(policy.dataset === 'protected' && hasSecurity)) || policy.source !== 'unrestricted') {
    fail('SECURITY_REJECTED', `${bp}.security`, 'only explicitly unrestricted local fixtures can execute');
  }
  const csv = string(binding.csv, `${bp}.csv`);
  // Restrict to a relative single-file binding; executor additionally checks real paths.
  if (/[:\\*?\[\]{}]/.test(csv) || csv.startsWith('/') || csv.split('/').some((part) => part === '..' || part === '' || part === '.')) {
    fail('LOCAL_DATA_ERROR', `${bp}.csv`, 'expected a relative file path without traversal, URI or glob syntax');
  }
  equals(binding.nullEncoding, 'empty cell', `${bp}.nullEncoding`);
  equals(binding.timezone, 'UTC', `${bp}.timezone`);
  return { columns: outputColumns, tableName, tableSchema, localData: { provenance, dataSetArn: arn, physicalTableId: physicalId,
    csv, nullEncoding: 'empty cell', timezone: 'UTC', security: { dataset: policy.dataset as 'unrestricted' | 'protected', source: 'unrestricted' } } };
}
