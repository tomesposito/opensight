import { hasCapability, planPreparedVisual, resolveSecurity, type RowPredicate, type SecurityContext, type InteractiveQuery, type Role } from '@opensight/query-engine';
import { compileVisual } from '@opensight/web/compiler';
import { containedWork, wireTable, type QueryResult } from './contained-work.js';
import { EmbedSources } from './embed-sources.js';
import { HostedData } from './hosted-data.js';
import { embedFailure, resourceArn, type SessionGrant } from './embed-sessions.js';
import { identifier, object, type MetadataResource } from './metadata-resources.js';
import type { TenantContext } from './metadata.js';
import { boundColumns } from './source-schema.js';
import type { JsonObject } from './mapping.js';

export function embedVisuals(raw: unknown) {
  const definition = object(raw);
  if (!Array.isArray(definition.Sheets) || definition.Sheets.length > 256) embedFailure('EMBED_DEFINITION_INVALID', 422);
  const visuals: { id: string; definition: JsonObject; path: string; sheetId: string; sheet: string }[] = [];
  for (const [si, value] of definition.Sheets.entries()) {
    const sheet = object(value);
    if (!Array.isArray(sheet.Visuals)) embedFailure('EMBED_DEFINITION_INVALID', 422);
    for (const [vi, value] of sheet.Visuals.entries()) {
      const visual = object(value);
      if (Object.keys(visual).length !== 1 || visuals.length >= 256) embedFailure('EMBED_DEFINITION_INVALID', 422);
      const id = identifier(object(Object.values(visual)[0]).VisualId);
      if (visuals.some(v => v.id === id)) embedFailure('EMBED_DEFINITION_INVALID', 422);
      visuals.push({ id, definition: visual, sheetId: identifier(sheet.SheetId), sheet: String(sheet.Name ?? sheet.SheetId), path: `Definition.Sheets[${si}].Visuals[${vi}]` });
    }
  }
  return visuals;
}
export function grantAllows(grants: unknown, userId: string, groupIds: string[], administrator: boolean, write = false): boolean {
  if (administrator || grants === undefined) return true;
  if (!Array.isArray(grants)) return false;
  return grants.some(value => {
    const g = object(value), p = object(g.principal);
    return (!write || g.role === 'co-owner') && (p.type === 'user' ? p.id === userId : p.type === 'group' && groupIds.includes(String(p.id)));
  });
}
/** Anonymous tags are immutable server-validated predicates, never interactive filters. */
export function tagSecurity(base: SecurityContext, dataset: JsonObject, tags: Record<string, string>): SecurityContext {
  const definition = object(dataset.DataSet ?? dataset), raw = definition.RowLevelPermissionTagConfiguration;
  const required = base.policy.rowLevel || Object.keys(tags).length > 0 || raw !== undefined;
  let predicate: RowPredicate | undefined;
  if (required) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) embedFailure('EMBED_TAG_CONFIGURATION_REQUIRED', 403);
    const config = object(raw, ['Status', 'TagRules', 'TagRuleConfigurations']);
    if (config.Status !== 'ENABLED' || !Array.isArray(config.TagRules) || !config.TagRules.length || config.TagRules.length > 50) embedFailure('EMBED_TAG_CONFIGURATION_REQUIRED', 403);
    const rules = new Map<string, RowPredicate>(), declared = new Set<string>();
    for (const value of config.TagRules) {
      const r = object(value, ['TagKey', 'ColumnName', 'TagMultiValueDelimiter', 'MatchAllValue']);
      if (typeof r.TagKey !== 'string' || !r.TagKey || r.TagKey.length > 128 || /[\x00-\x1f]/.test(r.TagKey) || declared.has(r.TagKey) || typeof r.ColumnName !== 'string' || !r.ColumnName) embedFailure('EMBED_TAG_CONFIGURATION_REQUIRED', 403);
      const name = r.TagKey, tag = Object.hasOwn(tags, name) ? tags[name] : undefined; declared.add(name);
      if (r.MatchAllValue !== undefined && typeof r.MatchAllValue !== 'string' || r.TagMultiValueDelimiter !== undefined && (typeof r.TagMultiValueDelimiter !== 'string' || !r.TagMultiValueDelimiter || r.TagMultiValueDelimiter.length > 10)) embedFailure('EMBED_TAG_CONFIGURATION_REQUIRED', 403);
      if (tag === undefined) continue;
      const column = r.ColumnName;
      rules.set(name, tag === r.MatchAllValue ? { any: [{ column, operator: 'is-null' }, { column, operator: 'is-not-null' }] }
        : r.TagMultiValueDelimiter ? { column, operator: 'in', values: tag.split(String(r.TagMultiValueDelimiter)) } : { column, operator: 'eq', value: tag });
    }
    if (Object.keys(tags).some(name => !rules.has(name))) embedFailure('EMBED_TAG_CONFIGURATION_REQUIRED', 403);
    const combinations = config.TagRuleConfigurations ?? [config.TagRules.map(v => String(object(v).TagKey))];
    if (!Array.isArray(combinations) || !combinations.length || combinations.length > 50) embedFailure('EMBED_TAG_CONFIGURATION_REQUIRED', 403);
    const matches: RowPredicate[] = [];
    for (const group of combinations) {
      if (!Array.isArray(group) || !group.length || group.length > 50 || group.some(k => typeof k !== 'string' || !declared.has(k))) embedFailure('EMBED_TAG_CONFIGURATION_REQUIRED', 403);
      if (group.every(k => rules.has(String(k)))) matches.push({ all: group.map(k => rules.get(String(k))!) });
    }
    if (!matches.length) embedFailure('ROW_ACCESS_DENIED', 403);
    predicate = { any: matches };
  }
  const userId = 'anonymous';
  return { namespaceId: base.namespaceId, userId, users: [{ id: userId, namespaceId: base.namespaceId }], groups: [],
    policy: { ...base.policy, rowLevel: !!predicate, rowRules: predicate ? [{ id: 'session-tags', principals: [{ type: 'user', id: userId }], predicate }] : [], columnGrants: [] } };
}
export class EmbedContent {
  constructor(readonly data: HostedData) {}
  get metadata() { return this.data.sources.metadata; }
  async access(context: TenantContext, resource: MetadataResource, write = false): Promise<void> {
    const user = await this.metadata.get(context, { kind: 'user', id: context.userId });
    if (resource.kind === 'analysis' && !hasCapability(user.body.role as Role, 'build')) embedFailure('EMBED_AUTHOR_REQUIRED', 403);
    const groups = (await this.metadata.list(context, 'group')).filter(g => Array.isArray(g.body.userIds) && g.body.userIds.includes(context.userId)).map(g => g.id);
    const allowed = (grants: unknown) => grantAllows(grants, context.userId, groups, user.body.role === 'administrator', write);
    if (!allowed(resource.body.grants)) embedFailure('RESOURCE_NOT_FOUND', 404);
    if (resource.body.folderId !== null && resource.body.folderId !== undefined) {
      const folder = await this.metadata.get(context, { kind: 'folder', id: identifier(resource.body.folderId) });
      if (!allowed(folder.body.grants)) embedFailure('RESOURCE_NOT_FOUND', 404);
    }
  }
  async asset(context: TenantContext, kind: 'dashboard' | 'analysis', id: string) {
    const asset = await this.metadata.get(context, { kind, id }); await this.access(context, asset); return asset;
  }
  async dataset(context: TenantContext, id: string) {
    const dataset = await this.metadata.get(context, { kind: 'dataset', id });
    if (!Array.isArray(dataset.body.sources) || dataset.body.sources.length !== 1) embedFailure('EMBED_DATASET_UNSUPPORTED', 422);
    const source = object(dataset.body.sources[0], ['kind', 'id', 'ownerId']);
    if (source.kind !== 'source' || typeof source.ownerId !== 'string') embedFailure('EMBED_SOURCE_UNRESOLVED', 403);
    if (!(this.data.sources instanceof EmbedSources)) embedFailure('EMBED_SOURCE_UNRESOLVED', 403);
    return { dataset, sourceId: await this.data.sources.bindDataset(context, id) };
  }
  async authorize(context: TenantContext, g: SessionGrant): Promise<void> {
    const e = g.experience;
    if (e.kind === 'console') {
      const user = await this.metadata.get(context, { kind: 'user', id: context.userId });
      if (g.anonymous || !hasCapability(user.body.role as Role, 'build')) embedFailure('EMBED_AUTHOR_REQUIRED', 403);
      if (e.analysisId) await this.asset(context, 'analysis', e.analysisId);
    } else if (e.kind === 'q') await this.dataset(context, e.datasetId);
    else {
      const asset = await this.asset(context, 'dashboard', e.dashboardId), definition = object(asset.body.definition);
      if (e.kind === 'visual' && !embedVisuals(definition.Definition).some(v => v.id === e.visualId && v.sheetId === e.sheetId)) embedFailure('RESOURCE_NOT_FOUND', 404);
      if (g.anonymous && !g.authorizedResources.includes(resourceArn(g.namespaceId, 'dashboard', e.dashboardId))) embedFailure('EMBED_SCOPE_DENIED', 403);
    }
  }
  async admission(context: TenantContext, g: SessionGrant, datasetId: string) {
    const { dataset, sourceId } = await this.dataset(context, datasetId);
    const policies = (await this.metadata.list(context, 'policy')).filter(p => p.body.datasetId === datasetId);
    if (policies.length > 1) embedFailure('EMBED_DATASET_UNSUPPORTED', 422);
    const policy = policies[0]?.body;
    const definition = object(dataset.body.definition), d = object(definition.DataSet ?? definition);
    if ((d.RowLevelPermissionDataSet || d.ColumnLevelPermissionRules) && !policy) embedFailure('SOURCE_POLICY_REQUIRED', 403);
    const source = await this.data.sources.get(context, sourceId);
    return this.data.admit(context, sourceId, 'query', base => {
      if (g.anonymous) {
        const protectedColumns = [...new Set([...base.policy.protectedColumns ?? [], ...(policy?.protectedColumns as string[] | undefined) ?? []])];
        return tagSecurity({ ...base, policy: { ...base.policy, rowLevel: base.policy.rowLevel || policy?.rowLevel === true, protectedColumns } }, definition, g.tags);
      }
      if (!policy) return base;
      const { datasetId: _datasetId, ...datasetPolicy } = policy;
      const scoped = { ...base, policy: { ...datasetPolicy, namespaceId: context.namespaceId, dataSetArn: base.policy.dataSetArn } } as SecurityContext;
      const first = resolveSecurity(base, boundColumns(source.binding.columns), base.policy.dataSetArn), second = resolveSecurity(scoped, boundColumns(source.binding.columns), base.policy.dataSetArn);
      const predicates = [first.rowPredicate, second.rowPredicate].filter((p): p is RowPredicate => p !== undefined);
      return { ...base, policy: { namespaceId: context.namespaceId, dataSetArn: base.policy.dataSetArn, rowLevel: !!predicates.length,
        rowRules: predicates.length ? [{ id: 'embed-intersection', principals: [{ type: 'user', id: context.userId }], predicate: { all: predicates } }] : [],
        protectedColumns: [...new Set([...first.deniedColumns, ...second.deniedColumns])], columnGrants: [] } };
    });
  }
  async visuals(context: TenantContext, g: SessionGrant, asset: MetadataResource) {
    const stored = object(asset.body.definition), definition = object(stored.Definition), e = g.experience;
    const analysis = { ResourceType: 'Analysis', AnalysisId: asset.id, Name: String(stored.Name ?? asset.id), Definition: definition };
    const visuals = embedVisuals(definition).filter(v => e.kind !== 'visual' || v.id === e.visualId && v.sheetId === e.sheetId);
    if (!visuals.length) return [];
    if (!Array.isArray(definition.DataSetIdentifierDeclarations) || definition.DataSetIdentifierDeclarations.length !== 1 || !Array.isArray(asset.body.datasets) || asset.body.datasets.length !== 1) embedFailure('EMBED_DATASET_UNSUPPORTED', 422);
    const datasetId = identifier(object(asset.body.datasets[0]).id), dataSetArn = String(object(definition.DataSetIdentifierDeclarations[0]).DataSetArn);
    const a = await this.admission(context, g, datasetId);
    const plans = visuals.map(v => planPreparedVisual(a.physical.columns, analysis, v.id, dataSetArn, a.security));
    return this.data.work(context, false, [a], async () => {
      const table = await this.data.table(context, a, this.data.read(a).columns);
      const wire = await wireTable(this.data.scope(context), table, { ...a.physical, columns: table.columns });
      const result = [];
      for (const [index, v] of visuals.entries()) {
        const computed = await containedWork<QueryResult>(this.data.scope(context), { kind: 'visual', table: wire, analysis, visualId: v.id, dataSetArn }, this.data.limits(context));
        const plan = plans[index]!;
        const input = { source: 'api' as const, definition: v.definition, rows: computed.rows, bindings: Object.fromEntries([...plan.dimensions, ...plan.measures].map(f => [f.fieldId, f.outputName])), path: v.path };
        compileVisual(input);
        result.push({ ...input, id: v.id, sheet: v.sheet, placement: { column: 0, columns: 36, row: index * 6, rows: 6 } });
      }
      return result;
    });
  }
  async content(context: TenantContext, g: SessionGrant) {
    const e = g.experience;
    if (e.kind === 'console') {
      const analyses = [];
      for (const asset of await this.metadata.list(context, 'analysis')) {
        try { await this.access(context, asset); analyses.push({ id: asset.id, name: String(object(asset.body.definition).Name ?? asset.id) }); }
        catch (err) { if (!(err instanceof Error && 'code' in err && err.code === 'RESOURCE_NOT_FOUND')) throw err; }
      }
      const datasets = [];
      for (const d of await this.metadata.list(context, 'dataset')) {
        const refs = d.body.sources;
        if (!Array.isArray(refs) || refs.length !== 1) continue;
        const a = await this.admission(context, g, d.id);
        datasets.push({ id: d.id, columns: a.physical.columns.filter(c => !a.deniedColumns.includes(c.name)) });
      }
      const asset = e.analysisId ? await this.asset(context, 'analysis', e.analysisId) : undefined;
      return { kind: 'console', title: 'Analysis editor', analyses, datasets, ...(asset ? { analysis: asset.body.definition, version: asset.version, datasetId: identifier(object((asset.body.datasets as unknown[])[0]).id), visuals: await this.visuals(context, g, asset) } : {}) };
    }
    if (e.kind === 'q') {
      const a = await this.admission(context, g, e.datasetId);
      return { kind: 'q', title: 'Ask about your data', columns: a.physical.columns.filter(c => !a.deniedColumns.includes(c.name)) };
    }
    const asset = await this.asset(context, 'dashboard', e.dashboardId);
    return { kind: e.kind, title: String(object(asset.body.definition).Name ?? asset.id), visuals: await this.visuals(context, g, asset) };
  }
  async question(context: TenantContext, g: SessionGrant, raw: unknown) {
    if (g.experience.kind !== 'q') embedFailure('EMBED_SCOPE_DENIED', 403);
    const r = object(raw, ['Question']);
    if (typeof r.Question !== 'string' || r.Question.length > 1000) embedFailure();
    // Deterministic local Q grammar. No provider calls or invented answers.
    const match = /^(sum|total|average|avg|min|max|count) (.+?)(?: by (.+))?$/i.exec(r.Question.trim());
    if (!match) embedFailure('EMBED_QUESTION_UNSUPPORTED', 422);
    const a = await this.admission(context, g, g.experience.datasetId), column = (name: string) => {
      const found = a.physical.columns.find(c => c.name.toLowerCase() === name.toLowerCase());
      if (!found || a.deniedColumns.includes(found.name)) embedFailure('COLUMN_ACCESS_DENIED', 403);
      return found.name;
    };
    const query: InteractiveQuery = { dimensions: match[3] ? [{ fieldId: 'category', columnName: column(match[3]) }] : [], measures: [{ fieldId: 'value', columnName: column(match[2]!), aggregation: ({ total: 'SUM', average: 'AVG' } as Record<string, string>)[match[1]!.toLowerCase()] ?? match[1]!.toUpperCase() }], filters: [] };
    return this.data.work(context, false, [a], async () => {
      const table = await this.data.table(context, a, this.data.read(a).columns);
      return this.data.computeQuery(context, table, query);
    });
  }
  async save(context: TenantContext, g: SessionGrant, raw: unknown) {
    if (g.anonymous || g.experience.kind !== 'console') embedFailure('EMBED_SCOPE_DENIED', 403);
    const r = object(raw, ['analysisId', 'definition', 'datasetId', 'expectedVersion']), id = identifier(r.analysisId);
    if (g.experience.analysisId && g.experience.analysisId !== id) embedFailure('EMBED_SCOPE_DENIED', 403);
    const revisions = await this.metadata.revisions(context), datasetId = identifier(r.datasetId), definition = object(r.definition);
    if (definition.AnalysisId !== id || typeof definition.Name !== 'string' || !definition.Name.trim() || definition.Name.length > 512) embedFailure('EMBED_DEFINITION_INVALID', 422);
    const d = object(definition.Definition), declarations = d.DataSetIdentifierDeclarations;
    if (!Array.isArray(declarations) || declarations.length !== 1) embedFailure('EMBED_DATASET_UNSUPPORTED', 422);
    const expectedVersion = r.expectedVersion;
    if (!Number.isSafeInteger(expectedVersion) || Number(expectedVersion) < 0) embedFailure();
    const previous = expectedVersion ? await this.asset(context, 'analysis', id) : undefined;
    if (previous) await this.access(context, previous, true);
    const asset: MetadataResource = { kind: 'analysis', id, version: Number(expectedVersion), body: { ...(previous?.body ?? { folderId: null }), definition, datasets: [{ kind: 'dataset', id: datasetId }] } };
    await this.admission(context, g, datasetId); await this.visuals(context, g, asset);
    await this.metadata.saveEmbeddedAnalysis(context, asset, revisions);
    return { saved: true, analysisId: id, version: Number(expectedVersion) + 1, requiresRenewal: true };
  }
}
