import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { migrationFinding, serializeImportReport, parseExtractionManifest, type ExtractionManifest } from '@opensight/bundle-parser';
import { importBundle } from '@opensight/web/import';
import { validateAnalysisDefinition } from '@opensight/web/analysis';
import { QueryEngineError } from '@opensight/query-engine';
import { analysisName, datasetBindings, type AnalysisBackend, type AnalysisRecord } from './analysis-model.js';
import { migrationBundle, type MigrationReply, type MigrationWrite, type ImportTarget } from './migration-model.js';
import { MetadataError } from './metadata-db.js';
import { identifier, object } from './metadata-resources.js';
import type { TenantContext, TenantMetadata, Revisions } from './metadata.js';
import { method, send } from './automation-routes.js';
import { readBody } from './query.js';
import type { RetryAdapter } from './retry-store.js';
import { collectColumnNames, hasFieldNamePII, FIELD_NAME_PII_MESSAGE } from './ai-guard.js';

interface Replay { fingerprint: string; reply: MigrationReply }
const canonical = (v: unknown): string => Array.isArray(v) ? `[${v.map(canonical).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`).join(',')}}` : JSON.stringify(v) ?? 'null';
export const migrationPath = (path: string) => /^\/api\/v1\/bundle-imports(?:\/[A-Za-z0-9_-]{1,128}\/report)?$/.test(path);
export class MigrationRoutes {
  constructor(private readonly retries: RetryAdapter) {}
  async route(request: IncomingMessage, response: ServerResponse, path: string, context: TenantContext,
    metadata: TenantMetadata, backend: AnalysisBackend, recheck: () => Promise<void>): Promise<void> {
    const match = /^\/api\/v1\/bundle-imports(?:\/([A-Za-z0-9_-]{1,128})\/report)?$/.exec(path);
    if (!match) throw new MetadataError('RESOURCE_NOT_FOUND', 404);
    method(request, response, match[1] ? ['GET'] : ['POST']);
    await backend.authorize();
    if (match[1]) {
      const stamp = await backend.stamp(), report = await metadata.importReport(context, match[1]);
      await backend.check(stamp); send(response, 200, report); return;
    }
    const body = object(await readBody(request, 16 * 1024 * 1024), ['importId', 'bundle', 'manifest', 'previousImportId', 'bindings']);
    const id = identifier(body.importId);
    if (id.length > 128) throw new MetadataError('MIGRATION_INPUT_INVALID', 400);
    const bundle = migrationBundle(body.bundle);
    let manifest: ExtractionManifest | undefined;
    if (body.manifest !== undefined) {
      try { manifest = parseExtractionManifest(body.manifest); } catch { throw new MetadataError('MIGRATION_MANIFEST_INVALID', 400); }
    }
    const rawBindings = body.bindings ?? [];
    if (!Array.isArray(rawBindings) || rawBindings.length > bundle.members.length) throw new MetadataError('MIGRATION_INPUT_INVALID', 400);
    const bindings = new Map<number, unknown>();
    for (const value of rawBindings) {
      const b = object(value, ['asset', 'datasetBindings']);
      if (!Number.isSafeInteger(b.asset) || Number(b.asset) < 0 || Number(b.asset) >= bundle.members.length || bindings.has(Number(b.asset))) throw new MetadataError('MIGRATION_INPUT_INVALID', 400);
      const r = bundle.members[Number(b.asset)]!.resource;
      if (r.resourceType !== 'analysis' && r.resourceType !== 'dashboard') throw new MetadataError('MIGRATION_INPUT_INVALID', 400);
      bindings.set(Number(b.asset), datasetBindings(b.datasetBindings, r.definition));
    }
    const header = request.headers['idempotency-key'];
    if (Array.isArray(header)) throw new MetadataError('INVALID_HEADER', 400);
    const key = header === undefined ? undefined : canonical(['migration', context.tenantId, context.namespaceId, context.userId, identifier(header)]);
    const fingerprint = createHash('sha256').update(canonical(body)).digest('hex');
    const seen = key === undefined ? undefined : await this.retries.get<Replay>(key);
    if (seen) {
      const stamp = await backend.stamp();
      await metadata.importReport(context, seen.reply.importId);
      if (fingerprint !== seen.fingerprint) throw new MetadataError('IDEMPOTENCY_CONFLICT', 409);
      await backend.check(stamp); response.setHeader('Idempotent-Replayed', 'true'); send(response, 201, seen.reply); return;
    }
    const reservation = key === undefined ? undefined : await this.retries.reserve<Replay>(context.tenantId, key);
    try {
      const stamp = await backend.stamp() as Revisions;
      const previous = body.previousImportId === undefined ? undefined : await metadata.importReport(context, identifier(body.previousImportId));
      let results;
      try { results = importBundle(bundle).bundle!.report; } catch { throw new MetadataError('MIGRATION_BUNDLE_INVALID', 400); }
      const analyses: AnalysisRecord[] = [], targets: ImportTarget[] = [];
      for (const [asset, member] of bundle.members.entries()) {
        const r = member.resource, result = results[asset]!;
        const target: ImportTarget = { asset, state: 'staged' }; targets.push(target);
        if (r.resourceType !== 'analysis' && r.resourceType !== 'dashboard') continue;
        const fields = [...collectColumnNames(r.definition), ...(r.definition.calculatedFields ?? []).flatMap(f => {
          const name = f && typeof f === 'object' && 'name' in f ? f.name : undefined;
          return typeof name === 'string' ? [name] : [];
        })];
        if (hasFieldNamePII(fields.map(name => ({ name })))) throw new MetadataError('AI_FIELD_NAME_PII', 400, FIELD_NAME_PII_MESSAGE);
        if (!bindings.has(asset) && r.definition.dataSetIdentifierDeclarations.length) continue;
        const bound = datasetBindings(bindings.get(asset) ?? {}, r.definition);
        // Binding security failures reject the request; unsupported definitions remain staged.
        const schemas = await backend.resolve(bound);
        try { analysisName(r.name); validateAnalysisDefinition(r.definition, schemas); }
        catch (error) {
          if (!(error instanceof QueryEngineError) || ['COLUMN_ACCESS_DENIED', 'SECURITY_REJECTED'].includes(error.code)) throw error;
          result.findings.push(migrationFinding(r.resourceType, 'asset', 'failed-closed', { item: 0 })); continue;
        }
        // An unsupported construct remains in the staged original; never promote a
        // partly supported definition just because the validator returns diagnostics.
        if (result.findings.some(f => f.outcome === 'failed-closed' && f.code !== 'REMAP_REQUIRED')) continue;
        result.findings = result.findings.map(f => f.code === 'REMAP_REQUIRED' ? migrationFinding(f.construct, f.location, 'clean', f) : f);
        if (r.resourceType === 'dashboard') result.findings.push(migrationFinding('dashboard', 'asset', 'converted-differently', { item: 0 }));
        const analysisId = `${id}-${asset}`;
        analyses.push({ id: analysisId, name: r.name, definition: r.definition, datasetBindings: bound, version: 1 });
        target.state = 'imported'; target.analysisId = analysisId;
      }
      const report = serializeImportReport(results, { manifest, previous });
      const reply: MigrationReply = { importId: id, report, targets };
      const write: MigrationWrite = { id, record: { bundle, report, targets }, analyses };
      reservation?.prepare({ fingerprint, reply });
      await backend.check(stamp); await metadata.importBundle(context, write, stamp, reservation); await reservation?.commit();
      await recheck(); await metadata.importReport(context, id); send(response, 201, reply);
    } finally { await reservation?.release(); }
  }
}
