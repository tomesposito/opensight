import { OpenSightApiError } from './errors.js';
import type {
  ApiErrorBody,
  AnalysisCalculatedFields, AnalysisDescribe, AnalysisFilterGroup, AnalysisLayouts,
  AnalysisSummary, BundleVisual, CreateAnalysisBody, DeleteAnalysisResult,
  UpdateAnalysisBody, VersionedResult,
  DatasetDescribe,
  DatasetLineage,
  DatasetSummary,
  DeleteDatasetResult,
  DeleteSourceResult,
  InteractiveQuery,
  Page,
  QueryResult,
  RefreshResult,
  RefreshState,
  SaveDatasetBody,
  SourceDescribe,
  SourceSummary,
} from './types.js';

export interface OpenSightClientOptions {
  /**
   * Base URL of the API root, e.g. `https://host/api` (the client appends
   * `/v1/...`). Trailing slashes are stripped.
   */
  baseUrl: string;
  /**
   * Returns the user-level, tenant-scoped bearer credential minted through
   * the operator invitation path (D-37 decision 4). May be a string or a
   * function returning one (async allowed, for refresh-token flows).
   */
  getToken: string | (() => string | Promise<string>);
  /** Injectable fetch (tests, proxies). Defaults to global fetch. */
  fetch?: typeof fetch;
}

export interface RequestOptions {
  /** Limit header (1–1000) for paginated lists */
  limit?: number;
  /** Cursor header (opaque token from a previous nextCursor) */
  cursor?: string;
  /** Idempotency-Key honored on every v1 mutation and query POST */
  idempotencyKey?: string;
  /** Quoted integer version for optimistic concurrency, e.g. `"3"` */
  ifMatch?: string;
}

/** Every edit/delete needs the current quoted ETag. */
export type AnalysisMutationOptions = Pick<RequestOptions, 'idempotencyKey'> & { ifMatch: string };

/**
 * Typed client for the OpenSight headless v1 API (issue #95).
 * Maps 1:1 onto docs/api/openapi-v1.yaml — the implemented
 * datasets, querying and analyses slices. Conventions on every call:
 * named errorCode errors, Limit/Cursor headers (the hosted plane
 * rejects query strings), Idempotency-Key on mutations, If-Match
 * on deletes and analysis edits, and per-tenant rate limiting.
 */
export class OpenSightClient {
  private readonly baseUrl: string;
  private readonly getToken: () => string | Promise<string>;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: OpenSightClientOptions) {
    if (!opts.baseUrl || typeof opts.baseUrl !== 'string') {
      throw new TypeError('baseUrl is required');
    }
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    const token = opts.getToken;
    this.getToken = typeof token === 'function' ? token : async () => token;
    this.fetchImpl = opts.fetch ?? fetch;
  }

  // ---- datasets ----

  listDatasets(opts: Pick<RequestOptions, 'limit' | 'cursor'> = {}): Promise<Page<DatasetSummary>> {
    return this.request('GET', '/v1/datasets', { headers: pageHeaders(opts) });
  }

  getDataset(id: string): Promise<DatasetDescribe> {
    return this.request('GET', `/v1/datasets/${encode(id)}`);
  }

  /** PUT creates or updates a prepared dataset. expectedVersion is 0 on create. */
  saveDataset(
    id: string,
    body: SaveDatasetBody,
    opts: Pick<RequestOptions, 'idempotencyKey'> = {},
  ): Promise<DatasetSummary> {
    return this.request('PUT', `/v1/datasets/${encode(id)}`, {
      headers: mutationHeaders(opts),
      body,
    });
  }

  /** DELETE a prepared dataset. Requires If-Match (optimistic concurrency). */
  deleteDataset(id: string, ifMatch: string): Promise<DeleteDatasetResult> {
    return this.request('DELETE', `/v1/datasets/${encode(id)}`, {
      headers: { ...mutationHeaders({}), 'If-Match': ifMatch },
    });
  }

  getDatasetLineage(id: string): Promise<DatasetLineage> {
    return this.request('GET', `/v1/datasets/${encode(id)}/lineage`);
  }

  /** Trigger a refresh (BLAZE datasets only; fail-closed 409 BLAZE_MODE_REQUIRED otherwise). */
  refreshDataset(
    id: string,
    opts: Pick<RequestOptions, 'idempotencyKey'> = {},
  ): Promise<RefreshResult> {
    return this.request('POST', `/v1/datasets/${encode(id)}/refresh`, {
      headers: mutationHeaders(opts),
      body: {},
    });
  }

  getRefreshStatus(id: string): Promise<RefreshState> {
    return this.request('GET', `/v1/datasets/${encode(id)}/refresh-status`);
  }

  // ---- querying ----

  /** Run an InteractiveQuery against a dataset. No raw SQL is ever sent. */
  queryDataset(
    id: string,
    query: InteractiveQuery,
    opts: Pick<RequestOptions, 'idempotencyKey'> = {},
  ): Promise<QueryResult> {
    return this.request('POST', `/v1/datasets/${encode(id)}/query`, {
      headers: mutationHeaders(opts),
      body: query,
    });
  }

  // ---- sources ----

  listSources(opts: Pick<RequestOptions, 'limit' | 'cursor'> = {}): Promise<Page<SourceSummary>> {
    return this.request('GET', '/v1/sources', { headers: pageHeaders(opts) });
  }

  getSource(id: string): Promise<SourceDescribe> {
    return this.request('GET', `/v1/sources/${encode(id)}`);
  }

  /**
   * Retire a source. Refused fail-closed (409 SOURCE_DELETE_BLOCKED_BY_DATASET)
   * while any prepared dataset references it. Requires If-Match.
   */
  deleteSource(id: string, ifMatch: string): Promise<DeleteSourceResult> {
    return this.request('DELETE', `/v1/sources/${encode(id)}`, {
      headers: { ...mutationHeaders({}), 'If-Match': ifMatch },
    });
  }

  // ---- analyses ----

  listAnalyses(opts: Pick<RequestOptions, 'limit' | 'cursor'> = {}): Promise<Page<AnalysisSummary>> {
    return this.request('GET', '/v1/analyses', { headers: pageHeaders(opts) });
  }

  getAnalysis(id: string): Promise<VersionedResult<AnalysisDescribe>> {
    return this.versionedRequest('GET', analysisPath(id));
  }

  createAnalysis(body: CreateAnalysisBody, opts: Pick<RequestOptions, 'idempotencyKey'> = {}): Promise<VersionedResult<AnalysisDescribe>> {
    return this.versionedRequest('POST', '/v1/analyses', { body, headers: mutationHeaders(opts) });
  }

  updateAnalysis(id: string, body: UpdateAnalysisBody, opts: AnalysisMutationOptions): Promise<VersionedResult<AnalysisDescribe>> {
    return this.versionedRequest('PUT', analysisPath(id), { body, headers: analysisHeaders(opts) });
  }

  deleteAnalysis(id: string, opts: AnalysisMutationOptions): Promise<DeleteAnalysisResult> {
    return this.request('DELETE', analysisPath(id), { headers: analysisHeaders(opts) });
  }

  addVisual(id: string, sheetId: string, body: BundleVisual, opts: AnalysisMutationOptions): Promise<VersionedResult<AnalysisDescribe>> {
    return this.versionedRequest('POST', `${sheetPath(id, sheetId)}/visuals`, { body, headers: analysisHeaders(opts) });
  }

  updateVisual(id: string, sheetId: string, visualId: string, body: BundleVisual, opts: AnalysisMutationOptions): Promise<VersionedResult<AnalysisDescribe>> {
    return this.versionedRequest('PUT', `${sheetPath(id, sheetId)}/visuals/${encode(visualId)}`, { body, headers: analysisHeaders(opts) });
  }

  removeVisual(id: string, sheetId: string, visualId: string, opts: AnalysisMutationOptions): Promise<VersionedResult<AnalysisDescribe>> {
    return this.versionedRequest('DELETE', `${sheetPath(id, sheetId)}/visuals/${encode(visualId)}`, { headers: analysisHeaders(opts) });
  }

  setLayouts(id: string, sheetId: string, body: AnalysisLayouts, opts: AnalysisMutationOptions): Promise<VersionedResult<AnalysisDescribe>> {
    return this.versionedRequest('PUT', `${sheetPath(id, sheetId)}/layouts`, { body, headers: analysisHeaders(opts) });
  }

  addFilterGroup(id: string, body: AnalysisFilterGroup, opts: AnalysisMutationOptions): Promise<VersionedResult<AnalysisDescribe>> {
    return this.versionedRequest('POST', `${analysisPath(id)}/filter-groups`, { body, headers: analysisHeaders(opts) });
  }

  updateFilterGroup(id: string, filterGroupId: string, body: AnalysisFilterGroup, opts: AnalysisMutationOptions): Promise<VersionedResult<AnalysisDescribe>> {
    return this.versionedRequest('PUT', `${analysisPath(id)}/filter-groups/${encode(filterGroupId)}`, { body, headers: analysisHeaders(opts) });
  }

  removeFilterGroup(id: string, filterGroupId: string, opts: AnalysisMutationOptions): Promise<VersionedResult<AnalysisDescribe>> {
    return this.versionedRequest('DELETE', `${analysisPath(id)}/filter-groups/${encode(filterGroupId)}`, { headers: analysisHeaders(opts) });
  }

  setCalculatedFields(id: string, body: AnalysisCalculatedFields, opts: AnalysisMutationOptions): Promise<VersionedResult<AnalysisDescribe>> {
    return this.versionedRequest('PUT', `${analysisPath(id)}/calculated-fields`, { body, headers: analysisHeaders(opts) });
  }

  // ---- transport ----

  private async request<T>(
    method: string,
    path: string,
    opts: { headers?: Record<string, string>; body?: unknown } = {},
  ): Promise<T> {
    return (await safeJson(await this.response(method, path, opts))) as T;
  }

  private async versionedRequest<T>(
    method: string, path: string, opts: { headers?: Record<string, string>; body?: unknown } = {},
  ): Promise<VersionedResult<T>> {
    const response = await this.response(method, path, opts);
    return { value: (await safeJson(response)) as T, etag: response.headers.get('ETag') };
  }

  private async response(
    method: string, path: string, opts: { headers?: Record<string, string>; body?: unknown },
  ): Promise<Response> {
    const token = await this.getToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      ...(opts.headers ?? {}),
    };
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, { method, headers, body });
    const retryAfter = parseRetryAfter(res.headers.get('Retry-After'));
    if (!res.ok) {
      const errorBody = (await safeJson(res)) as ApiErrorBody | null;
      throw new OpenSightApiError({
        errorCode: errorBody?.errorCode ?? `HTTP_${res.status}`,
        message: errorBody?.message ?? `${method} ${path} failed with status ${res.status}`,
        status: res.status,
        body: errorBody ?? { errorCode: `HTTP_${res.status}` },
        retryAfter,
      });
    }
    return res;
  }
}

function encode(id: string): string {
  return encodeURIComponent(id);
}

function pageHeaders(opts: Pick<RequestOptions, 'limit' | 'cursor'>): Record<string, string> {
  const headers: Record<string, string> = {};
  if (opts.limit !== undefined) headers['Limit'] = String(opts.limit);
  if (opts.cursor !== undefined) headers['Cursor'] = opts.cursor;
  return headers;
}

function mutationHeaders(opts: Pick<RequestOptions, 'idempotencyKey'>): Record<string, string> {
  const headers: Record<string, string> = {};
  if (opts.idempotencyKey !== undefined) headers['Idempotency-Key'] = opts.idempotencyKey;
  return headers;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function analysisPath(id: string): string { return `/v1/analyses/${encode(id)}`; }
function sheetPath(id: string, sheetId: string): string { return `${analysisPath(id)}/sheets/${encode(sheetId)}`; }
function analysisHeaders(opts: AnalysisMutationOptions): Record<string, string> {
  return { ...mutationHeaders(opts), 'If-Match': opts.ifMatch };
}
