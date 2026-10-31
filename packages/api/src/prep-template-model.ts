import { validatePrepPipeline, type PrepPipeline, type PrepInput } from '@opensight/bundle-parser/prep';
import { AssetCatalog, assetFail, assetName } from './asset-model.js';
import { identifier, object, type MetadataResource } from './metadata-resources.js';
export interface TemplateDefinition { name: string; pipeline: PrepPipeline }
export interface TemplateVersion { version: number; state: 'draft' | 'published'; definition: TemplateDefinition; actor: string; at: string }
export interface TemplateRecord {
  owner: string; createdBy: string; source: { id: string; ownerId: string; version: number }; publishedVersion: number | null;
  versions: TemplateVersion[]; audit: { action: 'propose' | 'edit' | 'publish'; version: number; actor: string; at: string }[];
}
export const templateRecord = (r: MetadataResource) => r.body as unknown as TemplateRecord;
/** Each distinct external input becomes a required slot. Internal graph edges stay intact. */
function mapInputs(pipeline: PrepPipeline, bind: (input: PrepInput) => PrepInput): PrepPipeline {
  const p = structuredClone(pipeline); p.input = bind(p.input);
  for (const s of p.steps) if (s.kind === 'append' || s.kind === 'join' && !(typeof s.config.source !== 'string' && 'step' in s.config.source)) s.config.source = bind(s.config.source as PrepInput);
  return p;
}
export function templateSlots(p: PrepPipeline): string[] {
  const slots = new Set<string>(); mapInputs(p, input => { if (typeof input !== 'string') assetFail('TEMPLATE_INVALID_INPUT'); slots.add(input); return input; }); return [...slots];
}
export function templateDefinition(raw: unknown): TemplateDefinition {
  const d = object(raw, ['name', 'pipeline']), pipeline = validatePrepPipeline(d.pipeline), name = assetName(d.name);
  if (name !== name.trim() || name.length > 128) assetFail('TEMPLATE_INVALID_NAME');
  if (templateSlots(pipeline).some(s => !/^input(?:-[1-9][0-9]*)?$/.test(s))) assetFail('TEMPLATE_INVALID_INPUT');
  return { name, pipeline };
}
export function validateTemplateRecord(raw: unknown): TemplateRecord {
  const b = object(raw, ['owner', 'createdBy', 'source', 'publishedVersion', 'versions', 'audit']); identifier(b.owner); identifier(b.createdBy);
  const source = object(b.source, ['id', 'ownerId', 'version']); identifier(source.id); identifier(source.ownerId);
  if (b.owner !== source.ownerId || !Number.isSafeInteger(source.version) || Number(source.version) < 1 || !Array.isArray(b.versions) || !b.versions.length || !Array.isArray(b.audit) || b.audit.length !== b.versions.length) assetFail('TEMPLATE_INVALID_HISTORY');
  let published: number | null = null;
  b.versions.forEach((raw, i) => {
    const v = object(raw, ['version', 'state', 'definition', 'actor', 'at']), a = object((b.audit as unknown[])[i], ['action', 'version', 'actor', 'at']);
    identifier(v.actor); templateDefinition(v.definition);
    if (v.version !== i + 1 || !['draft', 'published'].includes(String(v.state)) || typeof v.at !== 'string' || !Number.isFinite(Date.parse(v.at)) || a.version !== v.version || a.actor !== v.actor || a.at !== v.at || a.action !== (v.state === 'published' ? 'publish' : i ? 'edit' : 'propose')) assetFail('TEMPLATE_INVALID_HISTORY');
    if (v.state === 'published') published = i + 1;
  });
  if (b.publishedVersion !== published || (b.versions[0] as TemplateVersion).actor !== b.createdBy) assetFail('TEMPLATE_INVALID_HISTORY');
  return b as unknown as TemplateRecord;
}
export class PrepTemplateCatalog {
  constructor(readonly assets: AssetCatalog) {}
  canPublish(r: MetadataResource) { return this.assets.user().body.role === 'administrator' || templateRecord(r).owner === this.assets.scope.userId; }
  canEdit(r: MetadataResource) { const b = templateRecord(r); return this.canPublish(r) || b.publishedVersion === null && b.createdBy === this.assets.scope.userId; }
  get(id: string) {
    this.assets.build(); const r = this.assets.find('prep-template', id) ?? assetFail('TEMPLATE_NOT_FOUND', 404);
    if (templateRecord(r).publishedVersion === null && !this.canEdit(r)) assetFail('TEMPLATE_NOT_FOUND', 404); return r;
  }
  list() { this.assets.build(); return this.assets.resources.filter(r => r.kind === 'prep-template' && (templateRecord(r).publishedVersion !== null || this.canEdit(r))); }
  propose(id: string, sourceId: string, name: unknown) {
    this.assets.build(); identifier(id);
    if (this.assets.find('prep-template', id)) assetFail('TEMPLATE_ID_CONFLICT', 409);
    const source = this.assets.asset('datasets', identifier(sourceId));
    const original = validatePrepPipeline(object(source.body.resource).opensightPrep), slots = new Map<string, string>();
    const pipeline = mapInputs(original, ref => { const key = JSON.stringify(ref); if (!slots.has(key)) slots.set(key, slots.size ? `input-${slots.size}` : 'input'); return slots.get(key)!; });
    const b: TemplateRecord = { owner: source.ownerId!, createdBy: this.assets.scope.userId, source: { id: source.id, ownerId: source.ownerId!, version: source.version }, publishedVersion: null, versions: [], audit: [] };
    const r: MetadataResource = { kind: 'prep-template', id, version: 0, body: b as unknown as Record<string, unknown> };
    this.append(r, 'propose', templateDefinition({ name, pipeline })); this.assets.resources.push(r); return r;
  }
  edit(id: string, expected: number, raw: unknown) { const r = this.get(id); if (!this.canEdit(r)) assetFail('TEMPLATE_EDIT_FORBIDDEN', 403); this.assets.match(r, expected); this.append(r, 'edit', templateDefinition(raw)); return r; }
  publish(id: string, expected: number) {
    const r = this.get(id); if (!this.canPublish(r)) assetFail('TEMPLATE_PUBLISH_FORBIDDEN', 403); this.assets.match(r, expected);
    const latest = templateRecord(r).versions.at(-1)!; if (latest.state !== 'draft') assetFail('TEMPLATE_NO_DRAFT', 409);
    this.append(r, 'publish', templateDefinition(latest.definition)); return r;
  }
  bind(id: string, expected: number, raw: unknown) {
    const r = this.get(id); this.assets.match(r, expected);
    const b = templateRecord(r), published = b.versions.find(v => v.version === b.publishedVersion) ?? assetFail('TEMPLATE_NOT_PUBLISHED', 409);
    const slots = templateSlots(published.definition.pipeline), bindings = object(raw);
    if (Object.keys(bindings).length !== slots.length || slots.some(s => !Object.hasOwn(bindings, s))) assetFail('TEMPLATE_INPUT_UNBOUND', 422);
    try { return validatePrepPipeline(mapInputs(published.definition.pipeline, input => bindings[String(input)] as PrepInput)); }
    catch { assetFail('TEMPLATE_INPUT_UNBOUND', 422); }
  }
  private append(r: MetadataResource, action: 'propose' | 'edit' | 'publish', definition: TemplateDefinition) {
    const b = templateRecord(r), version = ++r.version, actor = this.assets.scope.userId, at = new Date().toISOString();
    b.versions.push({ version, state: action === 'publish' ? 'published' : 'draft', definition: structuredClone(definition), actor, at }); b.audit.push({ action, version, actor, at });
    if (action === 'publish') b.publishedVersion = version;
  }
}
