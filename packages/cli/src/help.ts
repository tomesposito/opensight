import { apiVersion, operations } from './generated.js';
import type { Operation, Schema } from './types.js';

export const descriptions: Record<string, string> = {
  list_datasets: 'List the prepared datasets visible to this credential, one page at a time.',
  describe_dataset: 'Describe a prepared dataset, its columns, execution mode, lineage and refresh state.',
  update_dataset: 'Create or replace a prepared dataset. Use expectedVersion 0 for creation.',
  delete_dataset: 'Delete a prepared dataset using its current quoted version in ifMatch.',
  run_dataset_query: 'Query a prepared dataset with structured dimensions, measures and parameterized filters. Raw SQL is not accepted.',
  describe_dataset_lineage: 'Describe the sources, prepared datasets and steps on which this dataset depends.',
  refresh_dataset: 'Request a refresh of a BLAZE dataset. Other execution modes return a named API error.',
  get_dataset_refresh_status: 'Read the dataset refresh state and configured interval.',
  list_sources: 'List source availability visible to this credential.',
  describe_source: 'Describe a source and its available columns.',
  delete_source: 'Retire a source. The API refuses retirement while prepared datasets reference it.',
  list_analyses: 'List accessible analysis drafts, preserving the API pagination cursor.',
  describe_analysis: 'Read an analysis definition, dataset bindings, version and validation diagnostics.',
  create_analysis: 'Create an analysis draft from a definition and its dataset bindings.',
  update_analysis: 'Replace an analysis draft using its current quoted version in ifMatch.',
  delete_analysis: 'Delete an analysis draft using its current quoted version in ifMatch.',
  add_visual: 'Add one visual variant to the specified analysis sheet.',
  update_visual: 'Replace a visual on the specified sheet. Its visualId must match the path.',
  remove_visual: 'Remove a visual from the specified analysis sheet.',
  set_layouts: 'Replace all layouts on a sheet. Supply --body with a JSON array; [] removes layouts.',
  add_filter_group: 'Add a filter group and its scope to an analysis.',
  update_filter_group: 'Replace the specified analysis filter group.',
  remove_filter_group: 'Remove the specified analysis filter group.',
  set_calculated_fields: 'Replace the calculated fields collection. Supply --body with a JSON array; [] removes fields.',
  publish_analysis: 'Publish an analysis as an immutable dashboard version. The positional id identifies the source analysis.',
  list_dashboards: 'List the latest published versions of accessible dashboards.',
  describe_dashboard: 'Read the latest published dashboard definition and version.',
  list_dashboard_versions: 'List the retained published versions of a dashboard.',
  describe_dashboard_version: 'Read a specific immutable published dashboard version.',
  delete_dashboard: 'Delete a dashboard using its current quoted version in ifMatch.',
  delete_dashboard_version: 'Delete a retained dashboard version subject to the API retention rules.',
  get_dashboard_share: 'Read a dashboard share for the target user or group.',
  set_dashboard_share: 'Set the target user or group share role using the current quoted version.',
  delete_dashboard_share: 'Remove a dashboard share for the target user or group.',
  query_dashboard_visual: 'Query a visual from a specific published dashboard version with parameter bindings.',
  create_dashboard_export: 'Export a dashboard as CSV or PDF. Supply --body with {"format":"csv"} or {"format":"pdf"}; global --format controls CLI output. Bytes are returned as base64.',
  list_assets: 'List accessible analysis, dashboard and dataset summaries.',
  list_analyses_summary: 'List accessible analysis asset summaries.',
  list_dashboards_summary: 'List accessible dashboard asset summaries.',
  list_datasets_summary: 'List accessible dataset asset summaries.',
  search_assets: 'Search accessible assets with --query text and optional --kinds JSON. The wire field is query; there is no name search flag.',
  move_asset: 'Move an analysis or dashboard to a folder; --folderId null moves it to the root.',
  copy_asset: 'Copy an accessible analysis or dashboard to a new identifier and optional folder.',
  get_asset_share: 'Read an analysis share for the target user or group. This v1 operation covers analyses only.',
  set_asset_share: 'Set an analysis share for the target user or group using the current quoted version.',
  delete_asset_share: 'Remove an analysis share for the target user or group.',
  list_folders: 'List folders accessible to this credential.',
  describe_folder: 'Read a folder name, identifier and version.',
  list_folder_assets: 'List accessible assets in the specified folder.',
  rename_folder: 'Rename a folder using its current quoted version in ifMatch.',
  delete_folder: 'Delete a folder subject to the API ownership and content rules.',
  get_folder_permissions: 'Read the grants configured on a folder.',
  set_folder_permissions: 'Replace folder grants with --grants JSON; null restores inheritance.',
};
const groups: Record<string, string> = {
  analysis: 'Build and edit analysis drafts, visuals, filters and layouts.',
  asset: 'Browse, search, move, copy and share existing assets.',
  dashboard: 'Publish analyses and read, query, export or manage published dashboards.',
  dataset: 'Inspect, prepare, query and refresh datasets.',
  folder: 'Browse folders and manage their names, contents and permissions.',
  source: 'Inspect and retire sources used by prepared datasets.',
};
const globals = 'Global options:\n  --format json|table|yaml  Output format (default: json). Tables support list/describe commands only.\n  --help, -h               Show help without authentication or API calls.\n';
function type(schema: Schema): string {
  if (schema.enum) return schema.enum.map(v => JSON.stringify(v)).join('|');
  return (Array.isArray(schema.type) ? schema.type.join('|') : schema.type) ?? 'JSON';
}
function usage(op: Operation): string {
  return `opensight ${op.noun} ${op.command}${op.arguments.filter(a => a.positional).map(a => ` <${a.name}>`).join('')} [options]`;
}
export function help(words: string[]): string {
  const [noun, command] = words;
  if (!noun) return `OpenSight CLI — API ${apiVersion}\n\nUsage: opensight <resource> <command> [options]\n\n${Object.entries(groups).map(([group, description]) =>
    `${group}: ${description}\n  ${operations.filter(o => o.noun === group).map(o => o.command).join(', ')}`).join('\n\n')}\n\n${globals}\nEnvironment: OPENSIGHT_API_URL, OPENSIGHT_TOKEN (refresh credential), OPENSIGHT_TOKEN_URL (operator exchange).\nUse opensight <resource> <command> --help for arguments.\n`;
  if (!command) return `${groups[noun]}\n\n${operations.filter(o => o.noun === noun).map(o => `  ${usage(o)}\n    ${descriptions[o.operationId]}`).join('\n')}\n\n${globals}`;
  const op = operations.find(o => o.noun === noun && o.command === command)!;
  const args = op.arguments.map(a => `  ${a.positional ? `<${a.name}> / ` : ''}--${a.name} <${type(a.schema)}> ${a.required ? '(required)' : '(optional)'}\n    ${a.location === 'header' ? `${a.wireName} header.` : a.location === 'body' ? `Request field ${a.wireName}.` : `Path identifier ${a.wireName}.`}${a.schema.description ? ` ${a.schema.description}` : ''}`);
  if (op.body) args.push(`  --${op.body.input} <JSON>\n    Complete request body instead of individual body fields. Do not combine them.${op.body.schema.required?.length ? ` Required fields: ${op.body.schema.required.join(', ')}.` : ''}`);
  return `${usage(op)}\n\n${descriptions[op.operationId]}\n\n${op.method} /api/v1${op.path} (${op.operationId})\n\n${args.join('\n') || 'No operation arguments.'}\n\n${globals}\nQuote JSON and quoted versions for your shell, for example --ifMatch '\"3\"'.\n${op.body ? 'Objects and arrays are inline JSON; no files are read. Body-field requirements also apply inside the complete JSON body.\n' : ''}`;
}
