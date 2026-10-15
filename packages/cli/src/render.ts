import { CliError, record } from './errors.js';
import type { Format } from './types.js';

type Column = [label: string, field: string];
const assets: Column[] = [['Kind', 'kind'], ['ID', 'id'], ['Name', 'name'], ['Folder', 'folderId']];
const listColumns: Record<string, Column[]> = {
  list_datasets: [['ID', 'id'], ['Name', 'name'], ['Version', 'version'], ['Execution', 'execution']],
  list_sources: [['ID', 'id'], ['Connector', 'connectorId'], ['Available', 'available'], ['Error', 'errorCode']],
  list_analyses: [['ID', 'id'], ['Name', 'name']],
  list_dashboards: [['ID', 'id'], ['Name', 'name'], ['Version', 'version'], ['Published', 'publishedAt']],
  list_dashboard_versions: [['Version', 'version'], ['Published', 'publishedAt'], ['Publisher', 'publishedBy']],
  list_assets: assets, list_analyses_summary: assets, list_dashboards_summary: assets, list_datasets_summary: assets,
  list_folders: [['ID', 'Id'], ['Name', 'Name'], ['Version', 'Version']],
  list_folder_assets: assets,
};
const describeFields: Record<string, Column[]> = {
  describe_dataset: [['ID', 'id'], ['Name', 'name'], ['Version', 'version'], ['Execution', 'execution'], ['Schema', 'schema'], ['Lineage', 'lineage'], ['Refresh', 'refresh']],
  describe_dataset_lineage: [['Dataset', 'dataset'], ['Steps', 'steps'], ['Sources', 'sources'], ['Datasets', 'datasets'], ['Refresh', 'refresh']],
  describe_source: [['ID', 'id'], ['Version', 'version'], ['Connector', 'connectorId'], ['Columns', 'columns']],
  describe_analysis: [['ID', 'AnalysisId'], ['Name', 'Name'], ['Version', 'Version'], ['Definition', 'Definition'], ['Dataset bindings', 'DatasetBindings'], ['Errors', 'Errors']],
  describe_dashboard: [['ID', 'DashboardId'], ['Name', 'Name'], ['Version', 'Version'], ['Published', 'PublishedAt'], ['Source analysis', 'SourceAnalysisId'], ['Definition', 'Definition'], ['Errors', 'Errors']],
  describe_folder: [['ID', 'Id'], ['Name', 'Name'], ['Version', 'Version']],
};
describeFields.describe_dashboard_version = describeFields.describe_dashboard!;

export function checkFormat(operationId: string, format: Format): void {
  if (format === 'table' && !Object.hasOwn(listColumns, operationId) && !Object.hasOwn(describeFields, operationId)) {
    throw new CliError('CLI_FORMAT_UNSUPPORTED', 'Table output is available only for list and describe commands; use json or yaml.');
  }
}
const cell = (v: unknown): string => v === undefined ? '' : typeof v === 'string'
  ? JSON.stringify(v).slice(1, -1) : JSON.stringify(v);
function table(headings: string[], rows: string[][]): string {
  const widths = headings.map((h, i) => Math.max(h.length, ...rows.map(row => row[i]?.length ?? 0)));
  const line = (row: string[]) => row.map((v, i) => v.padEnd(widths[i]!)).join('  ').trimEnd();
  return [line(headings), widths.map(w => '-'.repeat(w)).join('  '), ...rows.map(line)].join('\n');
}
/** JSON-quoted keys and strings avoid YAML implicit dates, booleans, tags and aliases. */
export function yaml(value: unknown, depth = 0): string {
  const indent = '  '.repeat(depth);
  if (Array.isArray(value) && value.length) return value.map(v => `${indent}-\n${yaml(v, depth + 1)}`).join('\n');
  if (record(value) && Object.keys(value).length) return Object.entries(value).map(([key, v]) =>
    `${indent}${JSON.stringify(key)}:\n${yaml(v, depth + 1)}`).join('\n');
  return indent + JSON.stringify(value);
}
export function render(operationId: string, value: unknown, format: Format): string {
  checkFormat(operationId, format);
  if (format === 'json') return JSON.stringify(value) + '\n';
  if (format === 'yaml') return yaml(value) + '\n';
  if (!record(value)) throw new CliError('CLI_RESPONSE_INVALID', 'Expected an API object for table output.');
  const columns = listColumns[operationId];
  if (columns) {
    if (!Array.isArray(value.items) || !value.items.every(record)) throw new CliError('CLI_RESPONSE_INVALID', 'Expected an API page for table output.');
    const rows = value.items.map(item => columns.map(([, key]) => cell(item[key])));
    return table(columns.map(([label]) => label), rows) + `\n${rows.length ? '' : '(no items)\n'}nextCursor: ${cell(value.nextCursor)}\n`;
  }
  return table(['Field', 'Value'], describeFields[operationId]!.filter(([, key]) => Object.hasOwn(value, key)).map(([label, key]) => [label, cell(value[key])])) + '\n';
}
