import type { BundleResourceType } from './bundle-types.js';

/** D-97: reports contain structural metadata only. Definitions stay in the bundle. */
export const MIGRATION_VERSION = 1 as const;
export const MIGRATION_PRODUCER = 'opensight-migration/1' as const;
export const MIGRATION_LIMITS = [
  { code: 'SOURCE_CREDENTIALS_NOT_RETURNED', message: 'Re-create source connections during remapping; credentials are never extracted.' },
  { code: 'SPICE_REINGEST_REQUIRED', message: 'Definitions travel, data does not. Re-ingest SPICE datasets from their sources.' },
  { code: 'NAMESPACE_ACCESS_REMAP_REQUIRED', message: 'QuickSight namespaces and groups do not map one-to-one to tenants and members. Re-grant access explicitly.' },
  { code: 'ASSET_EXPORT_FALLBACK_MANUAL', message: 'Definitions unavailable through Describe require a customer-run asset export with customer S3. This tool does not start that job.' },
] as const;
export type MigrationOutcome = 'clean' | 'converted-differently' | 'failed-closed';
export type FindingLocation = 'asset' | 'visual' | 'field-well';
export interface MigrationFinding {
  /** Construct type plus location, independent of asset IDs, array indexes and values. */
  kind: string;
  construct: string;
  location: FindingLocation;
  /** Ordinals locate a construct without copying its customer-provided name. */
  sheet?: number;
  visual?: number;
  item: number;
  outcome: MigrationOutcome;
  code: 'CONVERTED' | 'DELIBERATE_PROJECTION' | 'UNSUPPORTED_RETAINED' | 'REMAP_REQUIRED';
}
export interface MigrationCoverage {
  total: number;
  clean: { count: number; share: number };
  convertedDifferently: { count: number; share: number };
  failedClosed: { count: number; share: number };
}
/** The existing per-asset ImportResult, extended with portable structured fields.
 * name/path/messages are session-local diagnostics and MUST use serializeImportReport
 * before persistence or transfer to another surface. */
export interface ImportResult {
  path: string;
  name: string;
  messages: string[];
  asset: number;
  resourceType: BundleResourceType;
  findings: MigrationFinding[];
  coverage: MigrationCoverage;
}
export type SharedImportResult = Pick<ImportResult, 'asset' | 'resourceType' | 'findings' | 'coverage'>;
export interface ExtractionAsset {
  /** SHA-256 of resource type + source identity. No account ID, ARN or name. */
  key: string;
  resourceType: BundleResourceType;
  state: 'extracted' | 'failed-closed';
  code?: 'DESCRIBE_FAILED' | 'DEFINITION_INVALID' | 'CREDENTIAL_MATERIAL_REFUSED';
  /** Canonical definition digest detects value-only changes without revealing values. */
  digest?: string;
  bytes: number;
  constructs: Record<string, number>;
}
export interface ExtractionDiff {
  baseline: boolean;
  added: string[];
  changed: string[];
  unchanged: string[];
  removed: string[];
}
export interface ExtractionManifest {
  schemaVersion: typeof MIGRATION_VERSION;
  producer: typeof MIGRATION_PRODUCER;
  artifact: 'extraction-manifest';
  generatedAt: string;
  assets: ExtractionAsset[];
  knownLimits: typeof MIGRATION_LIMITS;
  diff: ExtractionDiff;
}
export interface MigrationImportReport {
  schemaVersion: typeof MIGRATION_VERSION;
  producer: typeof MIGRATION_PRODUCER;
  artifact: 'import-report';
  generatedAt: string;
  assets: SharedImportResult[];
  knownLimits: typeof MIGRATION_LIMITS;
  groups: { kind: string; count: number; assets: number[]; newKind: boolean }[];
  /** Exact validated extraction snapshot supports reruns against an import report. */
  manifest?: ExtractionManifest;
}

// Only fixed schema vocabulary can enter a report. Unknown keys may themselves
// contain customer content, so never echo an arbitrary JSON key as a kind.
const vocabulary = new Set(`analysis dashboard dataset datasource dataSetIdentifierDeclarations calculatedFields parameterDeclarations filterGroups layouts parameterControls textBoxes images analysisDefaults options queryExecutionOptions opensightTheme opensightDescription sheet connection physicalTableMap logicalTableMap importMode rowLevelPermissionDataSet columnLevelPermissionRules barChartVisual lineChartVisual pieChartVisual tableVisual pivotTableVisual kpiVisual comboChartVisual scatterPlotVisual treeMapVisual heatMapVisual gaugeChartVisual funnelChartVisual radarChartVisual sankeyDiagramVisual waterfallVisual boxPlotVisual histogramVisual wordCloudVisual geospatialMapVisual filledMapVisual insightVisual customContentVisual emptyVisual title subtitle actions columnHierarchies chartConfiguration insightConfiguration computations customNarrative anomaly totalAggregation maximumMinimum topBottomRanked growthRate periodOverPeriod metricComparison forecast periodToDate topBottomMovers uniqueValues categoricalDimensionField dateDimensionField numericalDimensionField numericalMeasureField categoricalMeasureField dateMeasureField calculatedMeasureField unknown`.split(' '));
export function safeConstruct(value: string): string {
  if (vocabulary.has(value) || /^unknown-[a-f0-9]{16}$/.test(value)) return value;
  // FNV-1a is a shape fingerprint, never an authentication/content digest.
  // Hash unknown schema keys so new construct kinds remain distinguishable
  // without echoing a customer-controlled key into a portable report.
  let hash = 14695981039346656037n;
  for (const byte of new TextEncoder().encode(value)) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 1099511628211n);
  return `unknown-${hash.toString(16).padStart(16, '0')}`;
}
export function migrationFinding(construct: string, location: FindingLocation, outcome: MigrationOutcome,
  position: Pick<MigrationFinding, 'item' | 'sheet' | 'visual'>, code?: MigrationFinding['code']): MigrationFinding {
  const safe = safeConstruct(construct);
  return { kind: `${location}:${safe}`, construct: safe, location, ...position, outcome,
    code: code ?? (outcome === 'clean' ? 'CONVERTED' : outcome === 'converted-differently' ? 'DELIBERATE_PROJECTION' : 'UNSUPPORTED_RETAINED') };
}
export function migrationCoverage(findings: readonly MigrationFinding[]): MigrationCoverage {
  const total = findings.length;
  const bucket = (outcome: MigrationOutcome) => {
    const count = findings.filter(f => f.outcome === outcome).length;
    return { count, share: total ? count / total : 0 };
  };
  return { total, clean: bucket('clean'), convertedDifferently: bucket('converted-differently'), failedClosed: bucket('failed-closed') };
}
export function serializeImportReport(results: readonly ImportResult[], options: {
  generatedAt?: string; manifest?: ExtractionManifest; previous?: MigrationImportReport;
} = {}): MigrationImportReport {
  const assets = results.map(r => ({ asset: r.asset, resourceType: r.resourceType,
    findings: r.findings.map(f => migrationFinding(f.construct, f.location, f.outcome,
      { item: f.item, ...(f.sheet === undefined ? {} : { sheet: f.sheet }), ...(f.visual === undefined ? {} : { visual: f.visual }) }, f.code)),
    coverage: migrationCoverage(r.findings) }));
  const groups = new Map<string, { kind: string; count: number; assets: number[]; newKind: boolean }>();
  const known = new Set(options.previous?.groups.map(g => g.kind));
  for (const a of assets) for (const f of a.findings) {
    const group = groups.get(f.kind) ?? { kind: f.kind, count: 0, assets: [], newKind: !!options.previous && !known.has(f.kind) };
    group.count++; if (!group.assets.includes(a.asset)) group.assets.push(a.asset);
    groups.set(f.kind, group);
  }
  return { schemaVersion: MIGRATION_VERSION, producer: MIGRATION_PRODUCER, artifact: 'import-report',
    generatedAt: options.generatedAt ?? new Date().toISOString(), assets, knownLimits: MIGRATION_LIMITS,
    groups: [...groups.values()].sort((a, b) => a.kind.localeCompare(b.kind)),
    ...(options.manifest ? { manifest: parseExtractionManifest(options.manifest) } : {}) };
}

export function diffExtraction(assets: readonly ExtractionAsset[], previous?: ExtractionManifest): ExtractionDiff {
  const before = new Map(previous?.assets.map(a => [a.key, a]));
  const diff: ExtractionDiff = { baseline: !!previous, added: [], changed: [], unchanged: [], removed: [] };
  for (const a of assets) {
    const old = before.get(a.key);
    diff[!old ? 'added' : old.digest === a.digest && old.state === a.state && old.code === a.code ? 'unchanged' : 'changed'].push(a.key);
    before.delete(a.key);
  }
  diff.removed = [...before.keys()];
  for (const values of [diff.added, diff.changed, diff.unchanged, diff.removed]) values.sort();
  return diff;
}

/** Strict allowlist at the file boundary; reject unversioned or content-bearing
 * prior artifacts instead of copying them into the next report. */
export function parseExtractionManifest(raw: unknown): ExtractionManifest {
  const fail = (): never => { throw new Error('MIGRATION_MANIFEST_INVALID'); };
  const obj = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : fail();
  const keys = (o: Record<string, unknown>, allowed: string[]) => { if (Object.keys(o).some(k => !allowed.includes(k))) fail(); };
  let r = obj(raw);
  if (r.artifact === 'import-report') {
    if (r.schemaVersion !== MIGRATION_VERSION || r.producer !== MIGRATION_PRODUCER) fail();
    r = obj(r.manifest);
  }
  keys(r, ['schemaVersion', 'producer', 'artifact', 'generatedAt', 'assets', 'knownLimits', 'diff']);
  if (r.schemaVersion !== MIGRATION_VERSION || r.producer !== MIGRATION_PRODUCER || r.artifact !== 'extraction-manifest'
    || typeof r.generatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(r.generatedAt)
    || !Number.isFinite(Date.parse(r.generatedAt)) || !Array.isArray(r.assets) || r.assets.length > 10000
    || JSON.stringify(r.knownLimits) !== JSON.stringify(MIGRATION_LIMITS)) fail();
  const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
  const seen = new Set<string>();
  for (const value of r.assets as unknown[]) {
    const a = obj(value); keys(a, ['key', 'resourceType', 'state', 'code', 'digest', 'bytes', 'constructs']);
    if (!hash(a.key) || seen.has(a.key) || !['analysis', 'dashboard', 'dataset', 'datasource'].includes(String(a.resourceType))
      || !['extracted', 'failed-closed'].includes(String(a.state)) || !Number.isSafeInteger(a.bytes) || Number(a.bytes) < 0
      || (a.state === 'extracted' ? !hash(a.digest) || a.code !== undefined : a.digest !== undefined || !['DESCRIBE_FAILED', 'DEFINITION_INVALID', 'CREDENTIAL_MATERIAL_REFUSED'].includes(String(a.code)))) fail();
    seen.add(a.key as string);
    for (const [k, n] of Object.entries(obj(a.constructs))) if (safeConstruct(k) !== k || !Number.isSafeInteger(n) || Number(n) < 0) fail();
  }
  const d = obj(r.diff); keys(d, ['baseline', 'added', 'changed', 'unchanged', 'removed']);
  if (typeof d.baseline !== 'boolean') fail();
  const diffKeys = new Set<string>();
  for (const key of ['added', 'changed', 'unchanged', 'removed']) {
    if (!Array.isArray(d[key])) fail();
    for (const v of d[key] as unknown[]) { if (!hash(v) || diffKeys.has(v)) fail(); diffKeys.add(v as string); }
  }
  return structuredClone(r) as unknown as ExtractionManifest;
}
