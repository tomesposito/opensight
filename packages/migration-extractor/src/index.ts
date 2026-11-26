import { createHash } from 'node:crypto';
import { MIGRATION_VERSION, MIGRATION_PRODUCER, MIGRATION_LIMITS, diffExtraction, parseExtractionManifest, parseBundleJson, ZIP_LIMITS,
  type QsBundle, type ExtractionAsset, type ExtractionManifest } from '@opensight/bundle-parser';
import { assembleResource, constructInventory, referencedAssets, object, text, type AssetKind } from './resources.js';
export { assertNoCredentials } from './resources.js';
export { writeExtraction, readPrevious } from './files.js';
export interface QuickSightReader {
  list(kind: Exclude<AssetKind, 'datasource'>, nextToken?: string): Promise<unknown>;
  describe(kind: AssetKind, id: string): Promise<unknown>;
}
export interface ExtractionOptions {
  accountId: string;
  region: string;
  /** Omitted means all inventory; selected analyses also include their dependencies. */
  selection?: { kind: Exclude<AssetKind, 'datasource'>; id: string }[];
  previous?: unknown;
  generatedAt?: string;
}
export interface ExtractionResult { bundle: QsBundle; manifest: ExtractionManifest }
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  // Code-unit order is deterministic across customer locales and ICU versions.
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
const ids = { analysis: 'AnalysisId', dashboard: 'DashboardId', dataset: 'DataSetId' } as const;
const lists = { analysis: 'AnalysisSummaryList', dashboard: 'DashboardSummaryList', dataset: 'DataSetSummaries' } as const;
export const assetExportFallback = Object.freeze({ available: false, code: 'ASSET_EXPORT_FALLBACK_MANUAL', requires: ['customer S3', 'customer-run asset export'], executesAwsCalls: false });
export async function extractQuickSight(reader: QuickSightReader, options: ExtractionOptions): Promise<ExtractionResult> {
  if (!/^\d{12}$/.test(options.accountId) || !/^[a-z]{2}(?:-[a-z]+)+-\d$/.test(options.region)) throw new Error('EXTRACTION_CONFIGURATION_INVALID');
  const previous = options.previous === undefined ? undefined : parseExtractionManifest(options.previous);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(generatedAt) || !Number.isFinite(Date.parse(generatedAt))) throw new Error('EXTRACTION_CONFIGURATION_INVALID');
  const inventory: { kind: AssetKind; id: string }[] = [];
  const seenInventory = new Set<string>();
  for (const kind of ['analysis', 'dashboard', 'dataset'] as const) {
    let nextToken: string | undefined;
    const tokens = new Set<string>();
    do {
      let response: Record<string, unknown>;
      try { response = object(await reader.list(kind, nextToken)); } catch { throw new Error('EXTRACTION_LIST_FAILED'); }
      if (typeof response.Status === 'number' && response.Status >= 400 || !Array.isArray(response[lists[kind]])) throw new Error('EXTRACTION_LIST_INVALID');
      for (const row of response[lists[kind]] as unknown[]) {
        const id = text(object(row)[ids[kind]]);
        if (!/^[A-Za-z0-9_-]{1,512}$/.test(id)) throw new Error('EXTRACTION_ID_INVALID');
        const key = `${kind}/${id}`;
        if (seenInventory.has(key)) throw new Error('EXTRACTION_DUPLICATE_ASSET');
        seenInventory.add(key); inventory.push({ kind, id });
        if (inventory.length > ZIP_LIMITS.members) throw new Error('EXTRACTION_ASSET_LIMIT');
      }
      const token = response.NextToken;
      if (token !== undefined && (typeof token !== 'string' || !token || tokens.has(token) || tokens.size >= 1000)) throw new Error('EXTRACTION_PAGINATION_INVALID');
      nextToken = token as string | undefined;
      if (nextToken) tokens.add(nextToken);
    } while (nextToken);
  }
  if (options.selection?.some(s => !seenInventory.has(`${s.kind}/${s.id}`))) throw new Error('EXTRACTION_SELECTION_NOT_FOUND');
  const pending = inventory.filter(a => options.selection === undefined || options.selection.some(s => s.kind === a.kind && s.id === a.id));
  pending.sort((a, b) => `${a.kind}/${a.id}`.localeCompare(`${b.kind}/${b.id}`));
  const bundle: QsBundle = { members: [] }, assets: ExtractionAsset[] = [], visited = new Set<string>();
  for (let i = 0; i < pending.length; i++) {
    const { kind, id } = pending[i]!, identity = `${kind}/${id}`;
    if (visited.has(identity)) continue;
    if (visited.size >= ZIP_LIMITS.members) throw new Error('EXTRACTION_ASSET_LIMIT');
    visited.add(identity);
    const key = hash(`${options.accountId}\0${options.region}\0${identity}`);
    let response: unknown;
    try { response = await reader.describe(kind, id); }
    catch { assets.push({ key, resourceType: kind, state: 'failed-closed', code: 'DESCRIBE_FAILED', bytes: 0, constructs: {} }); continue; }
    try {
      const resource = assembleResource(kind, id, response);
      // Resolve dependency IDs only from exact same-account/region ARNs. Never
      // use a foreign ARN to expand the customer's granted extraction scope.
      const dependencies: { kind: AssetKind; id: string }[] = [];
      for (const ref of referencedAssets(resource)) {
        const arn = /^arn:(aws(?:-us-gov|-cn)?):quicksight:([^:]+):(\d{12}):(dataset|datasource)\/([A-Za-z0-9_-]{1,512})$/.exec(ref.arn);
        if (!arn || arn[2] !== options.region || arn[3] !== options.accountId || arn[4] !== ref.kind) throw new Error('DEFINITION_INVALID');
        dependencies.push({ kind: ref.kind, id: arn[5]! });
      }
      const body = canonical(resource), bytes = Buffer.byteLength(body);
      if (bytes > ZIP_LIMITS.memberBytes) throw new Error('DEFINITION_INVALID');
      bundle.members.push({ path: `${kind}/${id}.json`, resource });
      assets.push({ key, resourceType: kind, state: 'extracted', digest: hash(body), bytes, constructs: constructInventory(resource) });
      for (const dependency of dependencies) if (!pending.some(p => p.kind === dependency.kind && p.id === dependency.id)) pending.push(dependency);
    } catch (error) {
      assets.push({ key, resourceType: kind, state: 'failed-closed', code: error instanceof Error && error.message === 'CREDENTIAL_MATERIAL_REFUSED' ? 'CREDENTIAL_MATERIAL_REFUSED' : 'DEFINITION_INVALID', bytes: 0, constructs: {} });
    }
  }
  bundle.members.sort((a, b) => a.path.localeCompare(b.path));
  assets.sort((a, b) => a.key.localeCompare(b.key));
  // The importer applies the same JSON size/path/shape boundary. A wholly
  // failed extraction still writes an empty bundle plus an honest manifest.
  if (bundle.members.length) parseBundleJson(Buffer.from(JSON.stringify(bundle)));
  return { bundle, manifest: { schemaVersion: MIGRATION_VERSION, producer: MIGRATION_PRODUCER, artifact: 'extraction-manifest',
    generatedAt, assets, knownLimits: MIGRATION_LIMITS, diff: diffExtraction(assets, previous) } };
}
