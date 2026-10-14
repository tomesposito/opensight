import { lstat, open, readdir } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { loadQsBundle, parseBundleResource } from '@opensight/bundle-parser';
import { fromArchive, isObject, type JsonObject } from './mapping.js';
import { assertLegacyWritable, legacyWrite } from './metadata-maintenance.js';

import { AutomationStore } from './automation-store.js';
import { MetadataError } from './metadata-db.js';
import type { AnalysisRecord } from './analysis-model.js';
import { projectDefinition } from '@opensight/web/analysis';

interface AnalysisOverlay { version: 1; records: Record<string, AnalysisRecord | null> }

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
        Object.defineProperty(state.records, id, { value: record, enumerable: true, configurable: true, writable: true });
      });
      if (record) this.resources.get('analysis')!.set(id, { AnalysisId: id, Name: record.name, Definition: projectDefinition(record.definition) });
      else this.resources.get('analysis')!.delete(id);
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
      return raw as unknown as AnalysisOverlay;
    });
    for (const [id, record] of Object.entries(store.overlay.read().records)) {
      if (record === null) store.resources.get('analysis')!.delete(id);
      else store.resources.get('analysis')!.set(id, { AnalysisId: id, Name: record.name, Definition: projectDefinition(record.definition) });
    }
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
