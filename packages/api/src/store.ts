import { lstat, open, readdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { loadQsBundle, parseBundleResource } from '@opensight/bundle-parser';
import { fromArchive, isObject, type JsonObject } from './mapping.js';

export type ResourceKind = 'analysis' | 'dashboard';
export const RESOURCE_ID = /^[A-Za-z0-9_-]{1,512}$/u;
const JSON_BYTES = 16 * 1024 * 1024;

// Keep filesystem paths out of request handling: IDs only index this snapshot.
export class DefinitionStore {
  private readonly resources = new Map<ResourceKind, Map<string, JsonObject>>([
    ['analysis', new Map()], ['dashboard', new Map()],
  ]);

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

  static async load(dataRoot: string): Promise<DefinitionStore> {
    const store = new DefinitionStore();
    const root = resolve(dataRoot);
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
