import { AssetCatalog, assetKey, type AssetScope } from './asset-model.js';
import { localResource, organizedResource } from './local-assets.js';
import { resourceLinks, type MetadataResource } from './metadata-resources.js';
import { convertDefinition } from '@opensight/web/analysis';
import { lstat, open, readdir } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { loadQsBundle, parseBundleResource } from '@opensight/bundle-parser';
import { fromArchive, isObject, type JsonObject } from './mapping.js';
import { assertLegacyWritable, legacyWrite } from './metadata-maintenance.js';

import { AutomationStore } from './automation-store.js';
import { MetadataError } from './metadata-db.js';
import { validateDashboardRecord, changeDashboard, describeDashboard, type DashboardRecord, type DashboardChange } from './dashboard-model.js';
import type { AnalysisRecord } from './analysis-model.js';
import { projectDefinition } from '@opensight/web/analysis';

interface AnalysisOverlay { version: 1; records: Record<string, AnalysisRecord | null>; dashboards?: Record<string, DashboardRecord | null>; assets?: MetadataResource[] }

export type ResourceKind = 'analysis' | 'dashboard';
export const RESOURCE_ID = /^[A-Za-z0-9_-]{1,512}$/u;
const JSON_BYTES = 16 * 1024 * 1024;

// Keep filesystem paths out of request handling: IDs only index this snapshot.
export class DefinitionStore {
  private readonly resources = new Map<ResourceKind, Map<string, JsonObject>>([
    ['analysis', new Map()], ['dashboard', new Map()],
  ]);

  private overlay?: AutomationStore<AnalysisOverlay>;
  private root?: string;
  analysisRecord(id: string): AnalysisRecord | null | undefined { const records = this.overlay?.read().records; return records && Object.hasOwn(records, id) ? records[id] : undefined; }
  async mutateAnalysis(id: string, record: AnalysisRecord | null, expectedVersion: number, authorize: () => void): Promise<void> {
    if (!this.overlay || !this.root) throw new MetadataError('ANALYSIS_STORE_UNAVAILABLE', 503);
    await legacyWrite(this.root, async () => {
      await this.overlay!.change(state => {
        authorize();
        const previous = Object.hasOwn(state.records, id) ? state.records[id] : undefined;
        const version = previous === null ? 0 : previous?.version ?? (this.get('analysis', id) ? 1 : 0);
        if (version !== expectedVersion) throw new MetadataError('METADATA_CONFLICT');
        if (!version && record === null) throw new MetadataError('RESOURCE_NOT_FOUND', 404);
        if (!record) for (const dashboard of Object.values(state.dashboards ?? {})) if (dashboard?.sourceAnalysisId === id) dashboard.sourceActive = false;
        const asset = state.assets?.find(r => r.kind === 'analysis' && r.id === id);
        if (asset && record) {
          asset.version = record.version; asset.body.updatedAt = new Date().toISOString();
          asset.body.definition = { AnalysisId: id, Name: record.name, Definition: projectDefinition(record.definition) };
          asset.body.datasets = Object.values(record.datasetBindings).map(ref => ({ ...ref, ...(ref.kind === 'prepared-dataset' ? { ownerId: 'local' } : {}) }));
        } else if (!record) state.assets = state.assets?.filter(r => r.kind !== 'analysis' || r.id !== id);
        Object.defineProperty(state.records, id, { value: record, enumerable: true, configurable: true, writable: true });
      });
      if (record) this.resources.get('analysis')!.set(id, { AnalysisId: id, Name: record.name, Definition: projectDefinition(record.definition) });
      else this.resources.get('analysis')!.delete(id);
    });
  }
  dashboards(): DashboardRecord[] { return Object.values(this.overlay?.read().dashboards ?? {}).filter((v): v is DashboardRecord => v !== null); }
  async mutateDashboard(id: string, change: DashboardChange, userId: string): Promise<DashboardRecord | null> {
    if (!this.overlay || !this.root) throw new MetadataError('DASHBOARD_STORE_UNAVAILABLE', 503);
    return legacyWrite(this.root, async () => {
      const result = await this.overlay!.change(state => {
        if (change.kind === 'publish') {
          const source = Object.hasOwn(state.records, change.source.id) ? state.records[change.source.id] : undefined;
          if (source === null || !source && !this.get('analysis', change.source.id)) throw new MetadataError('RESOURCE_NOT_FOUND', 404);
          if ((source?.version ?? 1) !== change.source.version) throw new MetadataError('METADATA_CONFLICT', 409);
        }
        const records = state.dashboards ??= {};
        const prior = Object.hasOwn(records, id) ? records[id] ?? undefined : undefined;
        if (!prior && this.get('dashboard', id)) throw new MetadataError('DASHBOARD_SOURCE_MISMATCH', 409);
        const next = changeDashboard(prior, change, userId);
        Object.defineProperty(records, id, { value: next, enumerable: true, configurable: true, writable: true });
        const asset = state.assets?.find(r => r.kind === 'dashboard' && r.id === id);
        if (asset && next) { asset.version++; asset.body.published = next; asset.body.definition = describeDashboard(next); asset.body.updatedAt = new Date().toISOString(); }
        else if (!next) state.assets = state.assets?.filter(r => r.kind !== 'dashboard' || r.id !== id);
        return next;
      });
      if (result) this.resources.get('dashboard')!.set(id, describeDashboard(result));
      else this.resources.get('dashboard')!.delete(id);
      return result;
    });
  }
  assetResources(): MetadataResource[] {
    const overlay = this.overlay?.read(), stored = overlay?.assets ?? [];
    return [...this.list().map(a => {
      const found = stored.find(r => r.kind === a.kind && r.id === a.id);
      const record = this.analysisRecord(a.id), dashboard = this.dashboards().find(d => d.id === a.id);
      return found ?? localResource(a.id, a.kind, this.get(a.kind, a.id)!, { id: a.id, kind: a.kind, namespaceId: 'default', folderId: null,
        ...(a.kind === 'analysis' && record ? { analysisVersion: record.version, updatedAt: record.updatedAt, datasetBindings: record.datasetBindings } : {}),
        ...(a.kind === 'dashboard' && dashboard ? { dashboard } : {}) });
    }), ...stored.filter(r => r.kind === 'folder')];
  }
  async assetTransaction<T>(scope: AssetScope, write: boolean, work: (catalog: AssetCatalog) => T, datasets: MetadataResource[]): Promise<T> {
    const run = (state: AnalysisOverlay) => {
      const current = this.assetResources(), catalog = new AssetCatalog(scope, [...current, ...datasets,
        { kind: 'user', id: scope.userId, version: 1, body: { name: scope.userId, role: 'administrator' } }]);
      const result = work(catalog);
      if (write) {
        const next = catalog.resources.filter(r => ['analysis', 'dashboard', 'folder'].includes(r.kind));
        if (datasets.some(d => !catalog.resources.some(r => assetKey(r) === assetKey(d)))) throw new MetadataError('ASSET_LOCAL_DATASET_DELETE_UNAVAILABLE', 503);
        state.assets = next;
        for (const r of next) {
          if (r.kind === 'analysis') {
            const a = organizedResource(r, scope.namespaceId);
            Object.defineProperty(state.records, r.id, { value: { id: r.id, name: String(a.definition!.Name), definition: convertDefinition(a.definition!.Definition), datasetBindings: a.datasetBindings!, version: r.version }, configurable: true, enumerable: true, writable: true });
          }
          if (r.kind === 'dashboard' && r.body.published) Object.defineProperty(state.dashboards ??= {}, r.id, { value: r.body.published, configurable: true, enumerable: true, writable: true });
        }
        for (const old of current.filter(r => !next.some(n => assetKey(n) === assetKey(r)))) {
          if (old.kind === 'analysis') Object.defineProperty(state.records, old.id, { value: null, configurable: true, enumerable: true, writable: true });
          if (old.kind === 'dashboard') Object.defineProperty(state.dashboards ??= {}, old.id, { value: null, configurable: true, enumerable: true, writable: true });
        }
      }
      return result;
    };
    if (!this.overlay || !this.root) throw new MetadataError('ASSET_STORE_UNAVAILABLE', 503);
    if (!write) return run(this.overlay.read());
    return legacyWrite(this.root, async () => {
      const result = await this.overlay!.change(run);
      for (const kind of ['analysis', 'dashboard'] as const) {
        this.resources.get(kind)!.clear();
        for (const r of this.overlay!.read().assets ?? []) if (r.kind === kind) this.resources.get(kind)!.set(r.id, r.body.definition as JsonObject);
      }
      return result;
    });
  }
  list(): { kind: ResourceKind; id: string; name: string }[] {
    return [...this.resources].flatMap(([kind, resources]) => [...resources].map(([id, body]) => ({ kind, id, name: typeof body.Name === 'string' ? body.Name : id })));
  }

  get(kind: ResourceKind, id: string): JsonObject | undefined {
    return this.resources.get(kind)?.get(id);
  }

  private add(kind: ResourceKind, body: JsonObject): void {
    const id = body[kind === 'analysis' ? 'AnalysisId' : 'DashboardId'];
    if (typeof id !== 'string' || !RESOURCE_ID.test(id)) throw new Error('Invalid resource ID');
    if (!isObject(body.Definition)) throw new Error('Expected a Definition object');
    const declarations = body.Definition.DataSetIdentifierDeclarations;
    if (!Array.isArray(declarations) || declarations.some(item => !isObject(item)
      || typeof item.Identifier !== 'string' || typeof item.DataSetArn !== 'string')) {
      throw new Error('Expected Definition.DataSetIdentifierDeclarations with Identifier and DataSetArn');
    }
    const resources = this.resources.get(kind)!;
    if (resources.has(id)) throw new Error(`Duplicate ${kind} ID: ${id}`);
    // Transport/SDK fields and the synthetic marker are not wire-body members.
    const { ResourceType, Status, $metadata, RequestId, ...wireBody } = body;
    resources.set(id, wireBody);
  }

  private ingest(raw: unknown): boolean {
    if (!isObject(raw)) return false;
    if (raw.resourceType === 'analysis' || raw.resourceType === 'dashboard') {
      const resource = parseBundleResource(raw);
      if (resource.resourceType === 'analysis' || resource.resourceType === 'dashboard') {
        this.add(resource.resourceType, fromArchive(resource));
      }
      return true;
    }
    if (Object.hasOwn(raw, 'AnalysisId') || Object.hasOwn(raw, 'DashboardId')
      || Object.hasOwn(raw, 'Definition') || raw.ResourceType === 'Analysis' || raw.ResourceType === 'Dashboard') {
      const analysis = Object.hasOwn(raw, 'AnalysisId');
      const dashboard = Object.hasOwn(raw, 'DashboardId');
      if (analysis === dashboard) throw new Error('Expected exactly one AnalysisId or DashboardId');
      if (raw.ResourceType !== undefined && raw.ResourceType !== (analysis ? 'Analysis' : 'Dashboard')) {
        throw new Error('ResourceType does not match definition ID');
      }
      this.add(analysis ? 'analysis' : 'dashboard', raw);
      return true;
    }
    return false;
  }

  static async load(dataRoot: string, maintenanceRead = false): Promise<DefinitionStore> {
    const store = new DefinitionStore();
    const root = resolve(dataRoot);
    if (!maintenanceRead) await assertLegacyWritable(root);
    async function visit(path: string, explicit = false): Promise<void> {
      const info = await lstat(path);
      if (info.isSymbolicLink()) {
        if (explicit) throw new Error(`Data root must not be a symbolic link: ${path}`);
        return;
      }
      if (info.isDirectory()) {
        const entries = await readdir(path);
        for (const name of entries.sort()) {
          if (!name.startsWith('.') && name !== 'node_modules') await visit(join(path, name));
        }
        return;
      }
      if (!info.isFile()) throw new Error(`Expected a regular data file: ${path}`);
      try {
        if (extname(path) === '.qs') {
          const bundle = await loadQsBundle(path);
          for (const { resource } of bundle.members) store.ingest(resource);
        } else if (extname(path) === '.json') {
          const raw = await readJson(path);
          if (!store.ingest(raw) && explicit) throw new Error('File contains no analysis or dashboard definition');
        } else if (explicit) {
          throw new Error('Data file must have a .qs or .json extension');
        }
      } catch (cause) {
        throw new Error(`Unable to load ${path}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
      }
    }
    await visit(root, true);
    store.root = root;
    const path = (await lstat(root)).isDirectory() ? join(root, '.opensight-analyses.json') : join(dirname(root), `.${root.slice(root.lastIndexOf('/') + 1)}.analyses.json`);
    store.overlay = await AutomationStore.load<AnalysisOverlay>({ version: 1, records: {} }, path, raw => {
      if (!isObject(raw) || raw.version !== 1 || !isObject(raw.records)) throw new Error('Invalid analysis overlay');
      for (const [id, value] of Object.entries(raw.records)) {
        if (!RESOURCE_ID.test(id) || value !== null && (!isObject(value) || value.id !== id || !Number.isSafeInteger(value.version) || Number(value.version) < 1 || !isObject(value.definition) || !isObject(value.datasetBindings))) throw new Error('Invalid analysis overlay record');
      }
      if (raw.assets !== undefined) {
        if (!Array.isArray(raw.assets)) throw new Error('Invalid asset overlay');
        const seen = new Set<string>();
        for (const value of raw.assets) {
          const r = value as MetadataResource;
          if (!r || !['analysis', 'dashboard', 'folder'].includes(r.kind) || !Number.isSafeInteger(r.version) || r.version < 1 || seen.has(assetKey(r))) throw new Error('Invalid asset overlay');
          seen.add(assetKey(r)); resourceLinks({ kind: r.kind, id: r.id }, r.body);
        }
      }
      if (raw.dashboards !== undefined) {
        if (!isObject(raw.dashboards)) throw new Error('Invalid dashboard overlay');
        for (const [id, record] of Object.entries(raw.dashboards)) if (record !== null) validateDashboardRecord(record, id);
      }
      return raw as unknown as AnalysisOverlay;
    });
    for (const [id, record] of Object.entries(store.overlay.read().records)) {
      if (record === null) store.resources.get('analysis')!.delete(id);
      else store.resources.get('analysis')!.set(id, { AnalysisId: id, Name: record.name, Definition: projectDefinition(record.definition) });
    }
    for (const [id, record] of Object.entries(store.overlay.read().dashboards ?? {})) {
      if (record) store.resources.get('dashboard')!.set(id, describeDashboard(record));
      else store.resources.get('dashboard')!.delete(id);
    }
    for (const r of store.overlay.read().assets ?? []) if (r.kind === 'analysis' || r.kind === 'dashboard') store.resources.get(r.kind)!.set(r.id, r.body.definition as JsonObject);
    return store;
  }
}

export async function readJson(path: string): Promise<unknown> {
  const file = await open(path, 'r');
  try {
    if ((await file.stat()).size > JSON_BYTES) throw new Error('JSON exceeds 16 MiB limit');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of file.createReadStream({ autoClose: false })) {
      const bytes = chunk as Buffer;
      size += bytes.length;
      if (size > JSON_BYTES) throw new Error('JSON exceeds 16 MiB limit');
      chunks.push(bytes);
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size))) as unknown;
  } finally {
    await file.close();
  }
}
