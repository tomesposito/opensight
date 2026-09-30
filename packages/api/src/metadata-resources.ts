import { parseBundleResource } from '@opensight/bundle-parser';
import { isRole } from '@opensight/query-engine';
import { executionSettings } from './blaze.js';
import { isObject, type JsonObject } from './mapping.js';
import { MetadataError, type SqlConnection } from './metadata-db.js';

export const resourceKinds = ['user', 'group', 'folder', 'analysis', 'dashboard', 'dataset', 'prepared-dataset', 'policy', 'source', 'secret', 'ai-config', 'invitation', 'job'] as const;
export type MetadataKind = typeof resourceKinds[number];
export interface ResourceKey { kind: MetadataKind; id: string; ownerId?: string }
export interface MetadataResource extends ResourceKey { body: JsonObject; version: number }
export interface Scope { tenantId: string; namespaceId: string }
export function invalidMetadata(): never { throw new MetadataError('METADATA_INVALID', 400); }
export function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/.test(value)) invalidMetadata();
  return value;
}
export function object(value: unknown, fields?: readonly string[]): JsonObject {
  if (!isObject(value) || fields && Object.keys(value).some(k => !fields.includes(k))) invalidMetadata();
  return value;
}
function list(value: unknown): unknown[] { if (!Array.isArray(value) || value.length > 10000) invalidMetadata(); return value; }
function label(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048 || /[\x00-\x1f]/.test(value)) invalidMetadata();
  return value;
}
export function resourceKey(value: ResourceKey): ResourceKey {
  const key = object(value, ['kind', 'id', 'ownerId']);
  if (!resourceKinds.includes(key.kind as MetadataKind)) invalidMetadata();
  const kind = key.kind as MetadataKind, ownerId = key.ownerId === undefined ? undefined : identifier(key.ownerId);
  if (ownerId && !['prepared-dataset', 'source', 'secret'].includes(kind) || kind === 'prepared-dataset' && !ownerId) invalidMetadata();
  return { kind, id: identifier(key.id), ...(ownerId ? { ownerId } : {}) };
}
function reference(value: unknown): ResourceKey { return resourceKey(object(value) as unknown as ResourceKey); }

/** Extract every relational reference; caller-supplied tenant/namespace fields are rejected. */
export function resourceLinks(key: ResourceKey, raw: JsonObject): ResourceKey[] {
  resourceKey(key);
  const body = object(raw), links: ResourceKey[] = [];
  const add = (kind: MetadataKind, id: unknown, ownerId?: string) => links.push({ kind, id: identifier(id), ...(ownerId ? { ownerId } : {}) });
  const grants = (value: unknown) => {
    if (value === undefined) return;
    const seen = new Set<string>();
    for (const g of list(value)) {
      const grant = object(g, ['principal', 'role']), p = object(grant.principal, ['type', 'id']);
      if (!['viewer', 'co-owner'].includes(String(grant.role)) || p.type !== 'user' && p.type !== 'group') invalidMetadata();
      const k = JSON.stringify([p.type, p.id]); if (seen.has(k)) invalidMetadata(); seen.add(k);
      add(p.type, p.id);
    }
  };
  if (key.ownerId) add('user', key.ownerId);
  switch (key.kind) {
    case 'user': object(body, ['name', 'role']); label(body.name); if (!isRole(body.role)) invalidMetadata(); break;
    case 'group': {
      object(body, ['name', 'userIds']); label(body.name);
      const users = list(body.userIds); if (new Set(users).size !== users.length) invalidMetadata();
      for (const id of users) add('user', id);
      break;
    }
    case 'folder': object(body, ['name', 'grants']); label(body.name); grants(body.grants); break;
    case 'analysis': case 'dashboard': {
      object(body, ['definition', 'folderId', 'grants', 'datasets']);
      const d = object(body.definition), definition = object(d.Definition);
      if (d[key.kind === 'analysis' ? 'AnalysisId' : 'DashboardId'] !== key.id) invalidMetadata();
      const declarations = list(definition.DataSetIdentifierDeclarations);
      const bindings = list(body.datasets);
      if (bindings.length !== declarations.length) invalidMetadata();
      for (let i = 0; i < bindings.length; i++) {
        const decl = object(declarations[i]); label(decl.Identifier); label(decl.DataSetArn);
        const ref = reference(bindings[i]); if (ref.kind !== 'dataset') invalidMetadata(); links.push(ref);
      }
      if (body.folderId !== null) add('folder', body.folderId);
      grants(body.grants); break;
    }
    case 'dataset': {
      object(body, ['definition', 'sources']); object(body.definition);
      for (const value of list(body.sources)) { const ref = reference(value); if (ref.kind !== 'source' || ref.ownerId) invalidMetadata(); links.push(ref); }
      break;
    }
    case 'prepared-dataset': {
      object(body, ['resource', 'execution']);
      const r = parseBundleResource(body.resource);
      if (r.resourceType !== 'dataset' || r.dataSetId !== key.id || !r.opensightPrep) invalidMetadata();
      if (body.execution !== undefined) executionSettings(body.execution);
      const p = r.opensightPrep;
      for (const input of [p.input, ...p.steps.flatMap(s => s.kind === 'join' && !(typeof s.config.source !== 'string' && 'step' in s.config.source) ? [s.config.source] : [])]) {
        if (typeof input === 'string') add('source', input, key.ownerId);
        else if ('dataset' in input) add('prepared-dataset', input.dataset, key.ownerId);
      }
      break;
    }
    case 'policy': {
      object(body, ['datasetId', 'dataSetArn', 'rowLevel', 'rowRules', 'columnGrants', 'protectedColumns']);
      add('dataset', body.datasetId); label(body.dataSetArn);
      if (typeof body.rowLevel !== 'boolean') invalidMetadata();
      for (const rule of [...list(body.rowRules), ...list(body.columnGrants ?? [])]) {
        const r = object(rule); identifier(r.id);
        for (const principal of list(r.principals)) {
          const p = object(principal, ['type', 'id']); if (p.type !== 'user' && p.type !== 'group') invalidMetadata(); add(p.type, p.id);
        }
      }
      break;
    }
    case 'source': {
      object(body, ['binding', 'secretId']); object(body.binding);
      if (body.secretId !== undefined) add('secret', body.secretId, key.ownerId);
      break;
    }
    case 'secret': {
      object(body, ['ciphertext', 'aadVersion']);
      if (body.aadVersion !== 2 || typeof body.ciphertext !== 'string') invalidMetadata();
      const parts = body.ciphertext.split('.');
      if (parts.length !== 3 || parts.some(p => !p || Buffer.from(p, 'base64').toString('base64') !== p) || Buffer.from(parts[0]!, 'base64').length !== 12 || Buffer.from(parts[1]!, 'base64').length !== 16) invalidMetadata();
      break;
    }
    case 'ai-config': {
      object(body, ['provider', 'model', 'baseUrl', 'secretId']);
      if (!['openai', 'anthropic', 'openai-compatible', 'bedrock'].includes(String(body.provider))) invalidMetadata(); label(body.model);
      if (body.baseUrl !== undefined) {
        const u = new URL(label(body.baseUrl)); if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) invalidMetadata();
      }
      if (body.secretId !== undefined) add('secret', body.secretId);
      break;
    }
    case 'invitation': {
      object(body, ['name', 'role', 'invitedBy', 'expiresAt', 'tokenHash']); label(body.name); add('user', body.invitedBy);
      if (!isRole(body.role) || typeof body.tokenHash !== 'string' || !/^[a-f0-9]{64}$/.test(body.tokenHash) || typeof body.expiresAt !== 'string' || !Number.isFinite(Date.parse(body.expiresAt))) invalidMetadata();
      break;
    }
    case 'job': {
      // H1 preserves legacy execution records only. H7 assigns owners and enables execution.
      object(body, ['collection', 'record', 'references', 'executionDisabled']);
      label(body.collection); object(body.record); if (body.executionDisabled !== true) invalidMetadata();
      for (const ref of list(body.references)) links.push(reference(ref));
      break;
    }
  }
  return [...new Map(links.map(l => [JSON.stringify([l.kind, l.ownerId ?? '', l.id]), l])).values()];
}

export async function insertResource(c: SqlConnection, scope: Scope, key: ResourceKey, body: JsonObject, version = 1): Promise<void> {
  const links = resourceLinks(key, body);
  await c.query('INSERT INTO h1_resources (tenant_id, namespace_id, kind, owner_id, resource_id, body, version) VALUES (?,?,?,?,?,?,?)',
    [scope.tenantId, scope.namespaceId, key.kind, key.ownerId ?? '', key.id, JSON.stringify(body), version]);
  await insertLinks(c, scope, key, links);
}
export async function insertLinks(c: SqlConnection, scope: Scope, key: ResourceKey, links: ResourceKey[]): Promise<void> {
  for (const ref of links) await c.query('INSERT INTO h1_links VALUES (?,?,?,?,?,?,?,?)',
    [scope.tenantId, scope.namespaceId, key.kind, key.ownerId ?? '', key.id, ref.kind, ref.ownerId ?? '', ref.id]);
}
