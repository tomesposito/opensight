import { OpenSightClient, type AnalysisMutationOptions, type AssetPrincipal, type TransferAssetKind } from '@opensight/headless-sdk';
import type { Invocation } from './parse.js';
import { CliError } from './errors.js';

type Handler = (client: OpenSightClient, input: Invocation) => Promise<unknown>;
type ClientMethod = (...args: never[]) => Promise<unknown>;
// The parser validates against the generated OpenAPI schema before this boundary.
// These casts bridge JSON to the SDK's richer, hand-authored domain types.
const body = <F extends ClientMethod, N extends number>(i: Invocation, _method: F, _position: N): Parameters<F>[N] => i.body as Parameters<F>[N];
const id = (i: Invocation, name = 'id'): string => i.path[name] as string;
const version = (i: Invocation): number => i.path.version as number;
const edit = (i: Invocation): AnalysisMutationOptions => i.options as AnalysisMutationOptions;
const principal = (i: Invocation): AssetPrincipal => ({ type: id(i, 'principalType') as AssetPrincipal['type'], id: id(i, 'principalId') });
const kind = (i: Invocation): TransferAssetKind => id(i, 'kind') as TransferAssetKind;
export class VersionedResponse {
  constructor(readonly value: unknown, readonly etag: string | null) {}
}
const value = async (result: Promise<{ value: unknown; etag: string | null }>): Promise<VersionedResponse> => {
  const response = await result;
  return new VersionedResponse(response.value, response.etag);
};

/** Explicit SDK adapters only: this module never constructs HTTP requests or paths. */
export const handlers: Record<string, Handler> = {
  list_datasets: (c, i) => c.listDatasets(i.options),
  describe_dataset: (c, i) => c.getDataset(id(i)),
  update_dataset: (c, i) => c.saveDataset(id(i), body(i, c.saveDataset, 1), i.options),
  delete_dataset: (c, i) => c.deleteDataset(id(i), edit(i).ifMatch, i.options),
  run_dataset_query: (c, i) => c.queryDataset(id(i), body(i, c.queryDataset, 1), i.options),
  describe_dataset_lineage: (c, i) => c.getDatasetLineage(id(i)),
  refresh_dataset: (c, i) => c.refreshDataset(id(i), i.options),
  get_dataset_refresh_status: (c, i) => c.getRefreshStatus(id(i)),
  list_sources: (c, i) => c.listSources(i.options),
  describe_source: (c, i) => c.getSource(id(i)),
  delete_source: (c, i) => c.deleteSource(id(i), edit(i).ifMatch, i.options),
  list_analyses: (c, i) => c.listAnalyses(i.options),
  describe_analysis: (c, i) => value(c.getAnalysis(id(i))),
  create_analysis: (c, i) => value(c.createAnalysis(body(i, c.createAnalysis, 0), i.options)),
  update_analysis: (c, i) => value(c.updateAnalysis(id(i), body(i, c.updateAnalysis, 1), edit(i))),
  delete_analysis: (c, i) => c.deleteAnalysis(id(i), edit(i)),
  add_visual: (c, i) => value(c.addVisual(id(i), id(i, 'sheetId'), body(i, c.addVisual, 2), edit(i))),
  update_visual: (c, i) => value(c.updateVisual(id(i), id(i, 'sheetId'), id(i, 'visualId'), body(i, c.updateVisual, 3), edit(i))),
  remove_visual: (c, i) => value(c.removeVisual(id(i), id(i, 'sheetId'), id(i, 'visualId'), edit(i))),
  set_layouts: (c, i) => value(c.setLayouts(id(i), id(i, 'sheetId'), body(i, c.setLayouts, 2), edit(i))),
  add_filter_group: (c, i) => value(c.addFilterGroup(id(i), body(i, c.addFilterGroup, 1), edit(i))),
  update_filter_group: (c, i) => value(c.updateFilterGroup(id(i), id(i, 'filterGroupId'), body(i, c.updateFilterGroup, 2), edit(i))),
  remove_filter_group: (c, i) => value(c.removeFilterGroup(id(i), id(i, 'filterGroupId'), edit(i))),
  set_calculated_fields: (c, i) => value(c.setCalculatedFields(id(i), body(i, c.setCalculatedFields, 1), edit(i))),
  publish_analysis: (c, i) => value(c.publishAnalysis(id(i), body(i, c.publishAnalysis, 1), i.options)),
  list_dashboards: (c, i) => c.listDashboards(i.options),
  describe_dashboard: (c, i) => value(c.getDashboard(id(i))),
  list_dashboard_versions: (c, i) => c.listDashboardVersions(id(i), i.options),
  describe_dashboard_version: (c, i) => value(c.getDashboardVersion(id(i), version(i))),
  delete_dashboard: (c, i) => c.deleteDashboard(id(i), edit(i)),
  delete_dashboard_version: (c, i) => c.deleteDashboardVersion(id(i), version(i), edit(i)),
  get_dashboard_share: (c, i) => c.getDashboardShare(id(i), principal(i)),
  set_dashboard_share: (c, i) => c.setDashboardShare(id(i), principal(i), body(i, c.setDashboardShare, 2), edit(i)),
  delete_dashboard_share: (c, i) => c.deleteDashboardShare(id(i), principal(i), i.options),
  query_dashboard_visual: (c, i) => value(c.queryDashboardVisual(id(i), version(i), id(i, 'visualId'), body(i, c.queryDashboardVisual, 3), i.options)),
  create_dashboard_export: async (c, i) => {
    const { bytes, ...metadata } = await c.createDashboardExport(id(i), body(i, c.createDashboardExport, 1), i.options);
    return { base64: Buffer.from(bytes).toString('base64'), ...metadata };
  },
  list_assets: (c, i) => c.listAssets(i.options),
  list_analyses_summary: (c, i) => c.listAnalysesSummary(i.options),
  list_dashboards_summary: (c, i) => c.listDashboardsSummary(i.options),
  list_datasets_summary: (c, i) => c.listDatasetsSummary(i.options),
  search_assets: (c, i) => c.searchAssets(body(i, c.searchAssets, 0), i.options),
  move_asset: (c, i) => value(c.moveAsset(kind(i), id(i), body(i, c.moveAsset, 2), i.options)),
  copy_asset: (c, i) => value(c.copyAsset(kind(i), id(i), body(i, c.copyAsset, 2), i.options)),
  get_asset_share: (c, i) => value(c.getAssetShare('analyses', id(i), principal(i))),
  set_asset_share: (c, i) => value(c.setAssetShare('analyses', id(i), principal(i), body(i, c.setAssetShare, 3), edit(i))),
  delete_asset_share: (c, i) => value(c.deleteAssetShare('analyses', id(i), principal(i), i.options)),
  list_folders: (c, i) => c.listFolders(i.options),
  describe_folder: (c, i) => value(c.getFolder(id(i))),
  list_folder_assets: (c, i) => c.listFolderAssets(id(i), i.options),
  rename_folder: (c, i) => value(c.renameFolder(id(i), body(i, c.renameFolder, 1), edit(i))),
  delete_folder: (c, i) => c.deleteFolder(id(i), i.options),
  get_folder_permissions: (c, i) => value(c.getFolderPermissions(id(i))),
  set_folder_permissions: (c, i) => value(c.setFolderPermissions(id(i), body(i, c.setFolderPermissions, 1), edit(i))),
};

export function dispatch(client: OpenSightClient, input: Invocation): Promise<unknown> {
  const handler = handlers[input.operation.operationId];
  if (!handler) throw new CliError('CLI_OPERATION_UNAVAILABLE', 'The generated operation has no SDK adapter.');
  return handler(client, input);
}
