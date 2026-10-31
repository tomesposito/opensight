import { PrepTemplateRoutes, type TemplateBackend } from './prep-template-routes.js';
import { disabledAnalytics, type Analytics } from './analytics.js';
import { MetricRoutes, type MetricBackend } from './metric-routes.js';
import { AssetRoutes } from './asset-routes.js';
import type { AssetBackend } from './asset-model.js';
import { DashboardRoutes } from './dashboard-routes.js';
import { HostedDashboards } from './hosted-dashboards.js';
import type { DashboardBackend } from './dashboard-model.js';
import { AnalysisRoutes } from './analysis-routes.js';
import { HostedAnalyses } from './hosted-analyses.js';
import type { AnalysisBackend } from './analysis-model.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { planPreparedQuery, QueryEngineError, UploadError } from '@opensight/query-engine';
import { PrepError } from '@opensight/bundle-parser/prep';
import { MetadataError } from './metadata-db.js';
import { identifier, object } from './metadata-resources.js';
import { method, send } from './automation-routes.js';
import { readBody, RequestError, SecurityError, validateQuery } from './query.js';
import { BlazeError } from './blaze.js';
import type { HostedDataRoutes } from './hosted-data-routes.js';
import type { TenantContext } from './metadata.js';
import { RetryStore, RETRY_TTL_MS, v1RateLimit, type RetryAdapter } from './retry-store.js';
import { serverlessV1Methods } from './v1-route-contract.js';

export type DurableV1Factory = (context: TenantContext) => RetryAdapter & { take(): Promise<{ allowed: boolean; retryAfter: number }> };

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
interface Receipt { fingerprint: string; status: number; body: unknown }

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, child]) => `${JSON.stringify(k)}:${canonical(child)}`).join(',')}}`;
  return JSON.stringify(v) ?? 'null';
}

function v1Fail(code: string, status: number, detail: string): never {
  const error = new MetadataError(code, status) as MetadataError & { detail: string };
  error.detail = detail; throw error;
}

class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; resetAt: number }>();
  readonly perMinute: number;
  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.perMinute = v1RateLimit(env);
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
  private readonly retries: RetryStore;
  private readonly tails = new Map<string, Promise<unknown>>();
  private readonly analyses: AnalysisRoutes;
  private readonly assets: AssetRoutes;
  private readonly templates: PrepTemplateRoutes;
  private readonly metrics: MetricRoutes;
  private readonly dashboards: DashboardRoutes;
  constructor(private readonly hostedRoutes?: HostedDataRoutes, private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly options: { invocation?: boolean; analytics?: Analytics; durable?: DurableV1Factory } = {}) {
    this.limiter = new RateLimiter(env);
    this.templates = new PrepTemplateRoutes({ paging: r => this.paging(r), ifMatch: r => this.ifMatch(r) });
    this.metrics = new MetricRoutes({ paging: r => this.paging(r), ifMatch: r => this.ifMatch(r) });
    this.assets = new AssetRoutes({ paging: r => this.paging(r), ifMatch: r => this.ifMatch(r) }, options.analytics ?? disabledAnalytics);
    this.dashboards = new DashboardRoutes({ paging: r => this.paging(r) }, env, options.analytics ?? disabledAnalytics);
    // Lambda invocations start no timers (SR1): their store prunes on access.
    this.retries = new RetryStore({ env, periodicPrune: !options.invocation });
    this.analyses = new AnalysisRoutes({ paging: r => this.paging(r), ifMatch: r => this.ifMatch(r) }, this.retries, options.analytics ?? disabledAnalytics);
  }
  close(): void { this.retries.close(); }
  private get routes(): HostedDataRoutes { if (!this.hostedRoutes) throw new MetadataError('HOSTED_API_REQUIRED', 503); return this.hostedRoutes; }
  async local(request: IncomingMessage, response: ServerResponse, path: string, backend: AnalysisBackend, dashboards: DashboardBackend, assets: MetricBackend & TemplateBackend): Promise<void> {
    try {
      const gate = this.limiter.take(backend.scope.tenantId);
      if (!gate.allowed) { response.setHeader('Retry-After', String(gate.retryAfter)); v1Fail('RATE_LIMIT_EXCEEDED', 429, 'Rate limit exceeded'); }
      if (this.templates.matches(path)) await this.templates.route(request, response, path, assets);
      else if (this.metrics.matches(path)) await this.metrics.route(request, response, path, assets);
      else if (this.assets.matches(path, request.method)) await this.assets.route(request, response, path, assets);
      else if (/^\/api\/v1\/dashboards(?:\/|$)/.test(path) || path.endsWith('/publish')) await this.dashboards.route(request, response, path, dashboards);
      else await this.analyses.route(request, response, path, backend);
    } catch (error) { request.resume(); this.sendError(response, error); }
  }

  async route(request: IncomingMessage, response: ServerResponse, path: string, context: TenantContext, recheck: () => Promise<void>): Promise<boolean> {
    if (!path.startsWith('/api/v1/')) return false;
    try {
      if (this.options.invocation && (!this.options.durable || !serverlessV1Methods(path)?.includes(request.method ?? ''))) throw new MetadataError('SERVERLESS_STORAGE_REQUIRED', 503);
      const durable = this.options.durable?.(context);
      const gate = durable ? await durable.take() : this.limiter.take(context.tenantId);
      if (!gate.allowed) { response.setHeader('Retry-After', String(gate.retryAfter)); v1Fail('RATE_LIMIT_EXCEEDED', 429, `Rate limit exceeded; retry after ${gate.retryAfter}s`); }
      this.routes.data.begin(context, undefined, recheck);
      const protocol = { paging: (r: IncomingMessage) => this.paging(r), ifMatch: (r: IncomingMessage) => this.ifMatch(r),
        publishData: async (r: IncomingMessage, res: ServerResponse, status: number, body: unknown, validate: () => Promise<void>) => {
          const output = await this.routes.output(r, context, status, body, async () => { await recheck(); await validate(); });
          send(res, output.status, output.body);
        } };
      const assets = durable ? new AssetRoutes(protocol, this.options.analytics, durable) : this.assets;
      const analyses = durable ? new AnalysisRoutes(protocol, durable, this.options.analytics) : this.analyses;
      const dashboards = durable ? new DashboardRoutes(protocol, this.env, this.options.analytics, durable) : this.dashboards;
      const metrics = durable ? new MetricRoutes(protocol, durable) : this.metrics;
      if (this.templates.matches(path)) {
        await this.templates.route(request, response, path, { scope: context, transaction: async (write, work) => { await recheck(); return this.routes.data.sources.metadata.assetTransaction(context, write, work); },
          createTemplateDataset: async (id, name, pipeline) => { await recheck(); return this.routes.prep.save(context, id, { name, pipeline, expectedVersion: 0 }); } }); return true;
      }
      if (metrics.matches(path)) {
        await metrics.route(request, response, path, { scope: context, transaction: async (write, work, receipt) => {
          await recheck(); return this.routes.data.sources.metadata.assetTransaction(context, write, work, receipt);
        } }); return true;
      }
      if (assets.matches(path, request.method)) {
        await assets.route(request, response, path, { scope: context, transaction: async (write, work, receipt) => {
          await recheck(); return this.routes.data.sources.metadata.assetTransaction(context, write, work, receipt);
        } }); return true;
      }
      if (/^\/api\/v1\/dashboards(?:\/|$)/.test(path) || /^\/api\/v1\/analyses\/[^/]+\/publish$/.test(path)) {
        await dashboards.route(request, response, path, new HostedDashboards(this.routes, context, recheck)); return true;
      }
      if (/^\/api\/v1\/analyses(?:\/|$)/.test(path)) {
        await analyses.route(request, response, path, new HostedAnalyses(this.routes, context, recheck)); return true;
      }
      const revisions = await this.routes.data.sources.metadata.revisions(context);
      const read = request.method === 'GET' || path.endsWith('/query');
      const input = async () => { const body = await readBody(request); if (!read) await recheck(); return body; };
      const publish = async (status: number, body: unknown) => {
        if (read) { await recheck(); await this.routes.data.publication(context, revisions); }
        else await this.routes.data.sources.metadata.revisions(context);
        send(response, status, body);
      };
      await this.dispatch(request, response, path, context, input, publish);
    } catch (error) { request.resume(); this.sendError(response, error); }
    return true;
  }

  sendError(response: ServerResponse, error: unknown): void {
    const dataError = error instanceof QueryEngineError || error instanceof PrepError || error instanceof UploadError || error instanceof BlazeError;
    const status = dataError ? 422 : error instanceof MetadataError || error instanceof RequestError || error instanceof SecurityError ? error.status : 500;
    const errorCode = dataError ? error.code : error instanceof MetadataError || error instanceof SecurityError ? error.code
      : error instanceof RequestError ? (status === 405 ? 'METHOD_NOT_ALLOWED' : status === 404 ? 'RESOURCE_NOT_FOUND' : 'HOSTED_REQUEST_INVALID') : 'HOSTED_INTERNAL_ERROR';
    if (errorCode === 'IDEMPOTENCY_CAPACITY_EXCEEDED') response.setHeader('Retry-After', '60');
    if (errorCode === 'IDEMPOTENCY_IN_PROGRESS') response.setHeader('Retry-After', '1');
    const rawDetail = (error as { detail?: unknown })?.detail;
    const summary = rawDetail !== null && typeof rawDetail === 'object' && 'summary' in rawDetail
      && typeof (rawDetail as { summary: unknown }).summary === 'string' ? (rawDetail as { summary: string }).summary : undefined;
    const message = status === 500 ? 'Internal error' : typeof rawDetail === 'string' ? rawDetail : summary ?? String((error as Error)?.message ?? errorCode);
    const path = error instanceof QueryEngineError ? error.path : error instanceof RequestError
      ? /^(\$[^:]*|parameterDeclarations[^:]*|parameterBindings[^:]*):/.exec(error.message)?.[1] : error instanceof MetadataError && 'path' in error ? error.path : undefined;
    send(response, status, { errorCode, message, ...(path === undefined ? {} : { path }),
      ...(rawDetail === undefined ? {} : { detail: rawDetail }),
      ...(error instanceof Error && 'diagnostics' in error ? { Errors: error.diagnostics } : {}) });
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

  private async serial<T>(key: string, work: () => Promise<T>): Promise<T> {
    const result = (this.tails.get(key) ?? Promise.resolve()).then(work), tail = result.catch(() => {});
    this.tails.set(key, tail);
    try { return await result; } finally { if (this.tails.get(key) === tail) this.tails.delete(key); }
  }

  /** Replay or record a response bound to the request's Idempotency-Key and contents. */
  private async idempotent(request: IncomingMessage, response: ServerResponse, context: TenantContext, path: string,
    contents: unknown, run: () => Promise<{ status: number; body: unknown }>,
    publish: (status: number, body: unknown) => void | Promise<void> = (status, body) => send(response, status, body),
    revisionScope = ''): Promise<void> {
    const key = this.header(request, 'idempotency-key');
    if (key === undefined) { const r = await run(); await publish(r.status, r.body); return; }
    const storeKey = `${context.tenantId}:${context.namespaceId}:${context.userId}:${request.method}:${path}:${identifier(key)}:${revisionScope}`;
    const fingerprint = createHash('sha256').update(canonical(contents)).digest('hex');
    await this.serial(storeKey, async () => {
      const now = Date.now();
      const receiptKey = `v1:${storeKey}`, seen = this.retries.get<Receipt>(receiptKey);
      if (seen) {
        if (seen.fingerprint !== fingerprint) v1Fail('IDEMPOTENCY_CONFLICT', 409, 'Idempotency-Key was already used with different request contents');
        response.setHeader('Idempotent-Replayed', 'true'); await publish(seen.status, seen.body); return;
      }
      const reservation = this.retries.reserve<Receipt>(context.tenantId, receiptKey);
      try {
        const result = await run();
        // Result size is only known after execution. An oversized result returns
        // capacity failure after work completed, with no receipt retained.
        reservation.prepare({ fingerprint, status: result.status, body: result.body });
        await publish(result.status, result.body);
        reservation.commit(now + RETRY_TTL_MS);
      } finally { reservation.release(); }
    });
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

  /** All prep datasets whose stored pipeline references the source, directly
   * or through nested `{ dataset }` refs. Stored references are the authority
   * for the deletion guard; admission state is irrelevant to it, so available
   * and unavailable datasets alike are walked, including references that only
   * appear in join/append step sources and references through an unavailable
   * intermediate dataset. A nested dataset ref that no longer exists
   * contributes no references; any other unreadable stored record fails
   * closed (its parse error propagates). */
  private async datasetsReferencingSource(context: TenantContext, sourceId: string): Promise<string[]> {
    const blocking: string[] = [];
    const touches = async (datasetId: string, seen: Set<string>): Promise<boolean> => {
      if (seen.has(datasetId)) return false; seen.add(datasetId);
      const inputs = await this.routes.prep.storedInputs(context, datasetId);
      if (inputs === null) return false;
      for (const input of inputs) {
        if (input.kind === 'source' && input.id === sourceId) return true;
        if (input.kind === 'dataset' && await touches(input.id, seen)) return true;
      }
      return false;
    };
    for (const id of await this.routes.prep.storedDatasetIds(context)) if (await touches(id, new Set())) blocking.push(id);
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
      // HostedPrep resolves current governed references before normal planning.
      await this.idempotent(request, response, context, path, body, async () => {
        const result = await this.routes.prep.execute(context, id, 'query', body);
        return { status: 200, body: { ...result, ...(dataset.execution.mode === 'BLAZE'
          ? { execution: { mode: 'BLAZE', cached: true } } : {}) } };
      }, publish, JSON.stringify(revisions));
      return;
    }
    if (path === '/api/v1/datasets') {
      method(request, response, ['GET']);
      const { limit, offset } = this.paging(request);
      await publish(200, this.page((await this.routes.prep.list(context)).datasets.map(d => this.summarizeDataset(d)), offset, limit));
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
          response.setHeader('ETag', `"${d.version}"`);
          await publish(200, { id, name: d.resource.name, version: d.version, execution: { mode: d.execution.mode, intervalMinutes: d.execution.intervalMinutes },
            schema: { columns: d.columns },
            lineage: { sources, datasets, steps: d.steps.length },
            refresh: { supported: d.execution.mode === 'BLAZE', mode: d.execution.mode, intervalMinutes: d.execution.intervalMinutes } });
          return;
        }
        if (verb === 'PUT') {
          const raw = object(structuredClone(await input()), ['name', 'pipeline', 'expectedVersion']);
          await this.idempotent(request, response, context, path, raw, async () => {
            const saved = await this.routes.prep.save(context, id, raw);
            await this.routes.data.sources.metadata.revisions(context);
            return { status: 200, body: { id, name: saved.resource.name, version: saved.version, execution: { mode: saved.execution.mode, intervalMinutes: saved.execution.intervalMinutes } } };
          });
        } else {
          const expectedVersion = this.ifMatch(request);
          await this.idempotent(request, response, context, path, expectedVersion, async () => {
            await this.routes.prep.remove(context, id, expectedVersion);
            await this.routes.data.sources.metadata.revisions(context);
            return { status: 200, body: { id, removed: true } };
          });
        }
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
      const body = object(await input(), []);
      await this.idempotent(request, response, context, path, body, async () => {
        const result = await this.routes.prep.execute(context, id, 'refresh', body) as { mode: string; state: string };
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
      const expectedVersion = this.ifMatch(request);
      await this.idempotent(request, response, context, path, expectedVersion, async () => {
        const revisions = await this.routes.data.sources.metadata.revisions(context);
        const blocking = await this.datasetsReferencingSource(context, id);
        if (blocking.length) v1Fail('SOURCE_DELETE_BLOCKED_BY_DATASET', 409,
          `Source is referenced by ${blocking.length} prepared dataset(s): ${blocking.join(', ')}`);
        await this.routes.data.sources.metadata.assertRevisions(context, revisions);
        await this.routes.data.sources.retire(context, id, expectedVersion);
        await this.routes.data.sources.metadata.revisions(context);
        return { status: 200, body: { id, retired: true, version: expectedVersion + 1 } };
      });
      return;
    }
    v1Fail('RESOURCE_NOT_FOUND', 404, `No v1 route for ${request.method} ${path}`);
  }
}
