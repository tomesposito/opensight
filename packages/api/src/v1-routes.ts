import type { IncomingMessage, ServerResponse } from 'node:http';
import { planPreparedQuery, QueryEngineError, UploadError } from '@opensight/query-engine';
import { PrepError } from '@opensight/bundle-parser/prep';
import { MetadataError } from './metadata-db.js';
import { identifier, object } from './metadata-resources.js';
import { method, send } from './automation-routes.js';
import { readBody, RequestError, SecurityError, validateQuery } from './query.js';
import { BlazeError } from './blaze.js';
import type { HostedDataRoutes } from './hosted-data-routes.js';
import type { TenantContext } from './metadata.js';

/**
 * Headless v1 surface (issue #95, IDD D-37, frozen contract
 * `docs/api-contract-v1-draft.md`).
 *
 * Versioned, tenant-scoped, machine-first REST under `/api/v1/...`.
 * Existing unversioned routes are untouched — the web app keeps consuming
 * the same API (D-37). Conventions honored on every v1 route:
 *
 * - Bearer auth, already verified before this router runs; the credential
 *   is user-level and tenant-scoped (D-37 decision 4).
 * - Named `errorCode` in every error body.
 * - Pagination via `Limit` / `Cursor` request headers; list responses are
 *   `{ items, nextCursor }`. (The hosted plane rejects query strings at the
 *   request boundary — `HOSTED_REQUEST_INVALID` — so the frozen
 *   `limit`/`cursor`/`nextCursor` convention rides headers, not `?limit=`.)
 * - `Idempotency-Key` honored on every v1 mutation (10-minute dedupe
 *   window, single node; the durable dispatch machinery stays the path for
 *   upload/artifact writes).
 * - Per-tenant rate limiting: 429 `RATE_LIMIT_EXCEEDED` with `Retry-After`
 *   (D-37 addendum; composes with HQ-14 usage metering, which already counts
 *   these calls via `apiCalls`).
 *
 * The datasets slice ships: dataset list/describe/lineage/refresh,
 * source list/describe, and the fail-closed source-deletion pin-down.
 * Upload durability primitives stay unversioned until #91's protocol work
 * lands — this router deliberately does not version them.
 */
const DEFAULT_LIMIT = 100, MAX_LIMIT = 1000;
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;

function v1Fail(code: string, status: number, detail: string): never {
  const error = new MetadataError(code, status) as MetadataError & { detail: string };
  error.detail = detail; throw error;
}

class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; resetAt: number }>();
  readonly perMinute: number;
  constructor(env: NodeJS.ProcessEnv = process.env) {
    const raw = env.OPENSIGHT_V1_RATE_LIMIT_PER_MINUTE;
    if (raw === undefined) this.perMinute = 600;
    else if (/^[1-9]\d*$/.test(raw) && Number(raw) <= 100000) this.perMinute = Number(raw);
    else throw new Error('OPENSIGHT_V1_RATE_LIMIT_PER_MINUTE must be a positive integer');
  }
  take(key: string): { allowed: boolean; retryAfter: number } {
    const now = Date.now(), windowMs = 60000;
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) { bucket = { tokens: this.perMinute, resetAt: now + windowMs }; this.buckets.set(key, bucket); }
    if (this.buckets.size > 10000) for (const [k, b] of this.buckets) { if (b.resetAt <= now) this.buckets.delete(k); if (this.buckets.size <= 10000) break; }
    if (bucket.tokens <= 0) return { allowed: false, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
    bucket.tokens--; return { allowed: true, retryAfter: 0 };
  }
}

export class V1Routes {
  private readonly limiter: RateLimiter;
  private readonly idempotency = new Map<string, { status: number; body: unknown; expiresAt: number }>();
  constructor(private readonly routes: HostedDataRoutes, env: NodeJS.ProcessEnv = process.env) { this.limiter = new RateLimiter(env); }

  async route(request: IncomingMessage, response: ServerResponse, path: string, context: TenantContext, recheck: () => Promise<void>): Promise<boolean> {
    if (!path.startsWith('/api/v1/')) return false;
    try {
      const gate = this.limiter.take(context.tenantId);
      if (!gate.allowed) { response.setHeader('Retry-After', String(gate.retryAfter)); v1Fail('RATE_LIMIT_EXCEEDED', 429, `Rate limit exceeded; retry after ${gate.retryAfter}s`); }
      this.routes.data.begin(context, undefined, recheck);
      const revisions = await this.routes.data.sources.metadata.revisions(context);
      const read = request.method === 'GET' || path.endsWith('/query');
      const input = async () => { const body = await readBody(request); if (!read) await recheck(); return body; };
      const publish = async (status: number, body: unknown) => {
        if (read) { await recheck(); await this.routes.data.publication(context, revisions); }
        else await this.routes.data.sources.metadata.revisions(context);
        send(response, status, body);
      };
      await this.dispatch(request, response, path, context, input, publish);
    } catch (error) { this.sendError(response, error); }
    return true;
  }

  private sendError(response: ServerResponse, error: unknown): void {
    const dataError = error instanceof QueryEngineError || error instanceof PrepError || error instanceof UploadError || error instanceof BlazeError;
    const status = dataError ? 422 : error instanceof MetadataError || error instanceof RequestError ? error.status : 500;
    const errorCode = dataError ? error.code : error instanceof MetadataError || error instanceof SecurityError ? error.code
      : error instanceof RequestError ? (status === 405 ? 'METHOD_NOT_ALLOWED' : 'HOSTED_REQUEST_INVALID') : 'HOSTED_INTERNAL_ERROR';
    const message = status === 500 ? 'Internal error' : String((error as { detail?: unknown })?.detail ?? (error as Error)?.message ?? errorCode);
    const path = error instanceof QueryEngineError ? error.path : error instanceof RequestError
      ? /^(\$[^:]*|parameterDeclarations[^:]*|parameterBindings[^:]*):/.exec(error.message)?.[1] : undefined;
    send(response, status, { errorCode, message, ...(path === undefined ? {} : { path }) });
  }

  private header(request: IncomingMessage, name: string): string | undefined {
    const raw = request.headers[name];
    if (Array.isArray(raw)) v1Fail('INVALID_HEADER', 400, `Duplicate ${name} header`);
    return raw;
  }

  private paging(request: IncomingMessage): { limit: number; offset: number } {
    const rawLimit = this.header(request, 'limit');
    let limit = DEFAULT_LIMIT;
    if (rawLimit !== undefined) {
      if (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > MAX_LIMIT) v1Fail('INVALID_PAGINATION', 400, `Limit must be an integer 1–${MAX_LIMIT}`);
      limit = Number(rawLimit);
    }
    let offset = 0;
    const rawCursor = this.header(request, 'cursor');
    if (rawCursor !== undefined) {
      try { offset = (JSON.parse(Buffer.from(rawCursor, 'base64').toString('utf8')) as { offset: unknown }).offset as number; }
      catch { v1Fail('INVALID_PAGINATION', 400, 'Cursor is not a valid opaque page token'); }
      if (!Number.isSafeInteger(offset) || offset < 0) v1Fail('INVALID_PAGINATION', 400, 'Cursor is not a valid opaque page token');
    }
    return { limit, offset };
  }

  private page<T>(items: readonly T[], offset: number, limit: number): { items: T[]; nextCursor: string | null } {
    const slice = items.slice(offset, offset + limit);
    return { items: slice, nextCursor: offset + slice.length < items.length ? Buffer.from(JSON.stringify({ offset: offset + slice.length })).toString('base64') : null };
  }

  private ifMatch(request: IncomingMessage): number {
    const raw = this.header(request, 'if-match');
    if (raw === undefined) v1Fail('V1_IF_MATCH_REQUIRED', 428, 'If-Match with the current version is required');
    if (typeof raw !== 'string' || !/^"(?:0|[1-9]\d*)"$/.test(raw) || !Number.isSafeInteger(Number(raw.slice(1, -1)))) v1Fail('V1_IF_MATCH_INVALID', 400, 'If-Match must be a quoted integer version');
    return Number((raw as string).slice(1, -1));
  }

  /** Replay or record a mutation response for the request's Idempotency-Key. */
  private async idempotent(request: IncomingMessage, response: ServerResponse, context: TenantContext, path: string,
    run: () => Promise<{ status: number; body: unknown }>,
    publish: (status: number, body: unknown) => void | Promise<void> = (status, body) => send(response, status, body),
    revisionScope = ''): Promise<void> {
    const key = this.header(request, 'idempotency-key');
    if (key === undefined) { const r = await run(); await publish(r.status, r.body); return; }
    const now = Date.now();
    for (const [k, v] of this.idempotency) if (v.expiresAt <= now) this.idempotency.delete(k);
    const storeKey = `${context.tenantId}:${context.namespaceId}:${context.userId}:${request.method}:${path}:${identifier(key)}:${revisionScope}`;
    const seen = this.idempotency.get(storeKey);
    if (seen) { response.setHeader('Idempotent-Replayed', 'true'); await publish(seen.status, seen.body); return; }
    const result = await run();
    await publish(result.status, result.body);
    this.idempotency.set(storeKey, { status: result.status, body: result.body, expiresAt: now + IDEMPOTENCY_TTL_MS });
  }

  private datasetId(raw: string): string {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(raw)) v1Fail('INVALID_DATASET_ID', 400, 'Dataset id must match [A-Za-z0-9_-]{1,128}');
    return raw;
  }

  private sourceId(raw: string): string {
    if (!/^[A-Za-z0-9_-]{1,512}$/.test(raw)) v1Fail('INVALID_SOURCE_ID', 400, 'Source id must match [A-Za-z0-9_-]{1,512}');
    return raw;
  }

  private summarizeDataset(d: { resource: { dataSetId: string; name: string }; version: number; execution: { mode: string; intervalMinutes: number | null } }) {
    return { id: d.resource.dataSetId, name: d.resource.name, version: d.version, execution: { mode: d.execution.mode, intervalMinutes: d.execution.intervalMinutes } };
  }

  /** All prep datasets whose pipeline references the source, directly or
   * through nested `{ dataset }` refs. Unresolvable refs fail closed
   * elsewhere (admission refuses them); they do not block deletion here. */
  private async datasetsReferencingSource(context: TenantContext, sourceId: string): Promise<string[]> {
    const blocking: string[] = [];
    const touches = async (datasetId: string, seen: Set<string>): Promise<boolean> => {
      if (seen.has(datasetId)) return false; seen.add(datasetId);
      let described: Awaited<ReturnType<HostedDataRoutes['prep']['describe']>>;
      try { described = await this.routes.prep.describe(context, datasetId); } catch { return false; }
      for (const input of described.inputs) {
        if (input.kind === 'source' && input.id === sourceId) return true;
        if (input.kind === 'dataset' && await touches(input.id, seen)) return true;
      }
      return false;
    };
    for (const d of await this.routes.prep.list(context)) if (await touches(d.resource.dataSetId, new Set())) blocking.push(d.resource.dataSetId);
    return blocking;
  }

  private async dispatch(request: IncomingMessage, response: ServerResponse, path: string, context: TenantContext,
    input: () => Promise<unknown>, publish: (status: number, body: unknown) => Promise<void>): Promise<void> {
    const query = /^\/api\/v1\/datasets\/([A-Za-z0-9_-]{1,128})\/query$/.exec(path);
    if (query) {
      method(request, response, ['POST']);
      const id = this.datasetId(query[1]!), body = validateQuery(await input());
      // Replays must pass current graph/policy admission and query validation.
      // Revision changes invalidate responses, including changes to leaf policies.
      const revisions = await this.routes.data.sources.metadata.revisions(context);
      const dataset = await this.routes.prep.describe(context, id);
      planPreparedQuery(dataset.columns, body);
      await this.idempotent(request, response, context, path, async () => {
        const result = await this.routes.prep.execute(context, id, 'query', body);
        return { status: 200, body: { ...result, ...(dataset.execution.mode === 'BLAZE'
          ? { execution: { mode: 'BLAZE', cached: true } } : {}) } };
      }, publish, JSON.stringify(revisions));
      return;
    }
    if (path === '/api/v1/datasets') {
      method(request, response, ['GET']);
      const { limit, offset } = this.paging(request);
      await publish(200, this.page((await this.routes.prep.list(context)).map(d => this.summarizeDataset(d)), offset, limit));
      return;
    }
    const dataset = /^\/api\/v1\/datasets\/([A-Za-z0-9_-]{1,128})(?:\/(lineage|refresh|refresh-status))?$/.exec(path);
    if (dataset) {
      const id = this.datasetId(dataset[1]!), action = dataset[2];
      if (!action) {
        const verb = method(request, response, ['GET', 'PUT', 'DELETE']);
        if (verb === 'GET') {
          const d = await this.routes.prep.describe(context, id);
          const sources: { id: string }[] = [], datasets: { id: string }[] = [];
          for (const i of d.inputs) (i.kind === 'source' ? sources : datasets).push({ id: i.id });
          await publish(200, { id, name: d.resource.name, version: d.version, execution: { mode: d.execution.mode, intervalMinutes: d.execution.intervalMinutes },
            schema: { columns: d.columns },
            lineage: { sources, datasets, steps: d.steps.length },
            refresh: { supported: d.execution.mode === 'BLAZE', mode: d.execution.mode, intervalMinutes: d.execution.intervalMinutes } });
          return;
        }
        await this.idempotent(request, response, context, path, async () => {
          if (verb === 'PUT') {
            const raw = object(structuredClone(await input()), ['name', 'pipeline', 'expectedVersion']);
            const saved = await this.routes.prep.save(context, id, raw);
            await this.routes.data.sources.metadata.revisions(context);
            return { status: 200, body: { id, name: saved.resource.name, version: saved.version, execution: { mode: saved.execution.mode, intervalMinutes: saved.execution.intervalMinutes } } };
          }
          await this.routes.prep.remove(context, id, this.ifMatch(request));
          await this.routes.data.sources.metadata.revisions(context);
          return { status: 200, body: { id, removed: true } };
        });
        return;
      }
      if (action === 'lineage') {
        method(request, response, ['GET']);
        const d = await this.routes.prep.describe(context, id);
        const sources: { id: string; connectorId?: string; version?: number; available: boolean; errorCode?: string }[] = [];
        const datasets: { id: string; name?: string; version?: number; available: boolean; errorCode?: string; inputs?: { kind: 'source' | 'dataset'; id: string }[] }[] = [];
        for (const i of d.inputs) {
          if (i.kind === 'source') {
            try { const s = await this.routes.data.sources.get(context, i.id); sources.push({ id: i.id, connectorId: s.binding.connectorId, version: s.version, available: true }); }
            catch (error) { sources.push({ id: i.id, available: false, errorCode: error instanceof MetadataError ? error.code : 'SOURCE_UNAVAILABLE' }); }
          } else {
            try { const child = await this.routes.prep.describe(context, i.id); datasets.push({ id: i.id, name: child.resource.name, version: child.version, available: true, inputs: child.inputs }); }
            catch { datasets.push({ id: i.id, available: false, errorCode: 'DATASET_UNAVAILABLE' }); }
          }
        }
        await publish(200, { dataset: { id, name: d.resource.name, version: d.version }, steps: d.steps, sources, datasets,
          refresh: { mode: d.execution.mode, intervalMinutes: d.execution.intervalMinutes, supported: d.execution.mode === 'BLAZE' } });
        return;
      }
      if (action === 'refresh-status') {
        method(request, response, ['GET']);
        const d = await this.routes.prep.describe(context, id);
        await publish(200, { datasetId: id, version: d.version, mode: d.execution.mode, intervalMinutes: d.execution.intervalMinutes, supported: d.execution.mode === 'BLAZE' });
        return;
      }
      method(request, response, ['POST']);
      await this.idempotent(request, response, context, path, async () => {
        object(await input(), []);
        const result = await this.routes.prep.execute(context, id, 'refresh') as { mode: string; state: string };
        await this.routes.data.sources.metadata.revisions(context);
        return { status: 200, body: { datasetId: id, refreshed: true, ...result } };
      });
      return;
    }
    if (path === '/api/v1/sources') {
      method(request, response, ['GET']);
      const { limit, offset } = this.paging(request);
      const discovered = await this.routes.data.discover(context) as { id: string; version?: number; connectorId?: string; available: boolean; errorCode?: string }[];
      await publish(200, this.page(discovered.map(s => ({ id: s.id, ...(s.version === undefined ? {} : { version: s.version }),
        ...(s.connectorId === undefined ? {} : { connectorId: s.connectorId }), available: s.available, ...(s.errorCode === undefined ? {} : { errorCode: s.errorCode }) })), offset, limit));
      return;
    }
    const source = /^\/api\/v1\/sources\/([A-Za-z0-9_-]{1,512})$/.exec(path);
    if (source) {
      const id = this.sourceId(source[1]!);
      const verb = method(request, response, ['GET', 'DELETE']);
      if (verb === 'GET') { await publish(200, await this.routes.data.schema(context, id)); return; }
      await this.idempotent(request, response, context, path, async () => {
        const expectedVersion = this.ifMatch(request);
        const blocking = await this.datasetsReferencingSource(context, id);
        if (blocking.length) v1Fail('SOURCE_DELETE_BLOCKED_BY_DATASET', 409,
          `Source is referenced by ${blocking.length} prepared dataset(s): ${blocking.join(', ')}`);
        await this.routes.data.sources.retire(context, id, expectedVersion);
        await this.routes.data.sources.metadata.revisions(context);
        return { status: 200, body: { id, retired: true, version: expectedVersion + 1 } };
      });
      return;
    }
    v1Fail('RESOURCE_NOT_FOUND', 404, `No v1 route for ${request.method} ${path}`);
  }
}
