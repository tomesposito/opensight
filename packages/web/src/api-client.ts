import type { PrepPipeline } from '@opensight/bundle-parser/prep';
import type { BundleDataSet } from '@opensight/bundle-parser';
import type { PrepPreview } from '@opensight/query-engine';
import type { PrepSourceSummary } from './data-prep.js';
import type { ConnectorState } from '@opensight/query-engine/browser';
import type { UploadSummary } from '@opensight/query-engine';
import type { InterpretationResult, CalculationResult } from '@opensight/o-interpreter';
import type { CalculatedField } from './authoring.js';
import { isRole, type Role } from '@opensight/query-engine/browser';
import type { Session } from './access.js';
import type { BundleDefinition } from '@opensight/bundle-parser';
import { convertDefinition, object } from './definition-converter.js';
import type { Row } from './model.js';

/** OpenSight HTTP projection; the API supplies the engine's trusted metadata. */
export type { InteractiveQuery as QueryRequest } from '@opensight/query-engine/browser';
import type { InteractiveQuery as QueryRequest } from '@opensight/query-engine/browser';
export interface QueryResponse {
  columns: { name: string; type: 'string' | 'number' }[];
  rows: Row[];
  execution?: ExecutionProvenance;
}
export interface ExecutionSettings { mode: 'DIRECT_QUERY' | 'BLAZE'; intervalMinutes: number | null }
export interface ExecutionStatus extends ExecutionSettings {
  materializationReason?: string | null;
  state: 'direct' | 'empty' | 'running' | 'ready' | 'error' | 'evicted' | 'invalidated';
  lastRefreshedAt: string | null; rowCount: number | null; bytes: number; nextRefreshAt: string | null;
  error: { code: string; message: string; causeCode?: string } | null;
}
export interface ExecutionProvenance {
  mode: ExecutionSettings['mode']; cached: boolean; refreshedAt: string | null;
  cachedInputs: { datasetId: string; refreshedAt: string }[];
}
export interface PreparedRows {
  columns: import('@opensight/bundle-parser/prep').PrepColumn[];
  rows: Record<string, string | number | boolean | null>[];
  rowCount: number; truncated: boolean; execution: ExecutionProvenance;
}
export interface DatasetRefreshStatus {
  lastGood: string | null;
  state: 'never' | 'running' | 'ready' | 'error';
  error: { code: string; message: string } | null;
}

export type ResourceKind = 'analysis' | 'dashboard';
export interface DefinitionResponse {
  id: string;
  name?: string;
  definition: BundleDefinition;
}
export const DEFAULT_API_URL = '/api';

export interface Invitation { id: string; namespaceId: string; name: string; role: Role; invitedBy: string; expiresAt: string }
export interface TenantJob { id: string; ownerId: string; version: number; spec: { kind: 'refresh' | 'report' | 'alert'; enabled: boolean }; stopped: boolean; nextRun: string | null }
export interface JobHistory { id: string; state: string; errorCode: string | null; createdAt: string; finishedAt: string | null }
export interface JobDelivery { delivery_id: string; recipient_id: string; state: string; attempts: number; error_code: string | null }
export interface AIStatus { configured: boolean; state: 'configured' | 'not-configured' | 'needs-approval' }
export interface ORequest { question: string; dashboardId?: string; calculatedFields?: readonly CalculatedField[] }
export interface AIConfig {
  provider: 'openai' | 'anthropic' | 'openai-compatible' | 'bedrock' | null;
  model: string; baseUrl?: string; hasKey: boolean; configured: boolean;
  state: 'configured' | 'not-configured' | 'needs-approval';
  keyStorage: 'ephemeral' | 'encrypted-file'; canSaveKey: boolean; compatibleBaseUrls: string[];
}

export interface LoginInput { email: string; password: string; code: string; tenantId: string }
export interface SignedIn { session: Session; expiresAt: number }
export const SHORT_SESSION_MS = 15 * 60_000;
export const MAX_SESSION_MS = 600 * 60_000;

export class ApiError extends Error {
  constructor(message: string, readonly status?: number, readonly errorCode?: string) { super(message); this.name = 'ApiError'; }
}

export class QueryError extends ApiError {
  constructor(message: string, readonly errorCode: string, readonly path: string) {
    super(message, 422); this.name = 'QueryError';
  }
}

export function createApiClient(baseUrl = DEFAULT_API_URL, fetcher: typeof fetch = globalThis.fetch) {
  const base = (baseUrl.trim() || DEFAULT_API_URL).replace(/\/+$/, '');
  // This closure is the only bearer store. Never persist it in browser storage.
  let credential: { token: string; expiresAt: number } | undefined;
  let generation = 0;
  function clearSession() { credential = undefined; generation++; }
  async function authenticatedFetch(url: string, options: RequestInit): Promise<Response> {
    const current = generation;
    if (credential && credential.expiresAt <= Date.now()) {
      clearSession();
      throw new ApiError('Your session has expired.', 401, 'SESSION_EXPIRED');
    }
    const response = await fetcher(url, credential ? { ...options, credentials: 'omit', headers: { ...options.headers, Authorization: `Bearer ${credential.token}` } } : options);
    if (current !== generation) throw new ApiError('Session changed during request.', 401, 'AUTH_REQUEST_SUPERSEDED');
    return response;
  }
  async function authResponse(response: Response): Promise<Record<string, unknown>> {
    const value: unknown = await response.json().catch(() => undefined);
    const body = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
    if (!response.ok) throw new ApiError('Authentication request failed.', response.status, typeof body?.errorCode === 'string' ? body.errorCode : undefined);
    if (!body) throw new ApiError('Invalid authentication response.', response.status, 'AUTH_RESPONSE_INVALID');
    return body;
  }
  async function login(input: LoginInput, remember: boolean, signal?: AbortSignal): Promise<SignedIn> {
    clearSession();
    const current = generation, started = Date.now();
    try {
      // The login boundary rejects BOTH cookies and Authorization, even stale ones.
      const body = await authResponse(await fetcher(`${base}/api/auth/login`, {
        method: 'POST', credentials: 'omit', signal,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: input.email, password: input.password, code: input.code, tenantId: input.tenantId }),
      }));
      if (current !== generation || signal?.aborted) throw new ApiError('Sign-in cancelled.', undefined, 'AUTH_REQUEST_SUPERSEDED');
      if (typeof body.token !== 'string' || !/^[A-Za-z0-9_.-]{1,1017}$/.test(body.token) ||
          typeof body.expiresAt !== 'number' || !Number.isSafeInteger(body.expiresAt) || body.expiresAt <= Date.now() || body.tenantId !== input.tenantId) {
        throw new ApiError('Invalid authentication response.', undefined, 'AUTH_RESPONSE_INVALID');
      }
      const expiresAt = Math.min(body.expiresAt, started + (remember ? MAX_SESSION_MS : SHORT_SESSION_MS));
      credential = { token: body.token, expiresAt };
      const session = await getSession(signal);
      if (current !== generation || signal?.aborted) throw new ApiError('Sign-in cancelled.', undefined, 'AUTH_REQUEST_SUPERSEDED');
      if (session.tenantId !== input.tenantId) throw new ApiError('Invalid authentication response.', undefined, 'AUTH_RESPONSE_INVALID');
      if (expiresAt <= Date.now()) throw new ApiError('Your session has expired.', 401, 'SESSION_EXPIRED');
      return { session, expiresAt };
    } catch (error) {
      if (current === generation) clearSession();
      throw error;
    }
  }
  async function logout(signal?: AbortSignal): Promise<void> {
    const current = generation;
    try {
      const body = await authResponse(await authenticatedFetch(`${base}/api/auth/logout`, {
        method: 'POST', credentials: 'omit', signal,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: '{}',
      }));
      if (body.loggedOut !== true) throw new ApiError('Invalid sign-out response.', undefined, 'AUTH_RESPONSE_INVALID');
    } finally { if (current === generation) clearSession(); }
  }
  async function resource<T>(route: string, method = 'GET', body?: unknown): Promise<T> {
    const response = await authenticatedFetch(`${base}${route}`, { method, credentials: 'same-origin', headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value: unknown = await response.json();
    if (!response.ok) {
      const error = object(value, 'API error');
      throw new ApiError(`${typeof error.errorCode === 'string' ? `${error.errorCode}: ` : ''}${typeof error.Message === 'string' ? error.Message : 'Request failed'}`, response.status, typeof error.errorCode === 'string' ? error.errorCode : undefined);
    }
    return value as T;
  }
  const getDatasetExecution = (id: string) => resource<ExecutionStatus>(`/api/datasets/${encodeURIComponent(id)}/execution`);
  async function getLocalData(signal?: AbortSignal): Promise<boolean> {
    const response = await authenticatedFetch(`${base}/api/local-data`, { signal, credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (!response.ok) return false;
    const value = object(await response.json(), 'Local data capability');
    return value.mode === 'local' && value.maxUploadBytes === 8388608 && value.uploadTtlSeconds === 86400;
  }
  const setDatasetExecution = (id: string, settings: ExecutionSettings) => resource<ExecutionStatus>(`/api/datasets/${encodeURIComponent(id)}/execution`, 'PUT', settings);
  const refreshBlaze = (id: string) => resource<ExecutionStatus>(`/api/datasets/${encodeURIComponent(id)}/refresh`, 'POST', {});
  const getPreparedRows = (id: string) => resource<PreparedRows>(`/api/datasets/${encodeURIComponent(id)}/rows`);
  const listPrepSources = () => resource<PrepSourceSummary[]>('/api/prep-sources');
  const listPrepDatasets = () => resource<{ datasets: BundleDataSet[]; persistence: 'file' | 'ephemeral' }>('/api/prep-datasets');
  const savePrep = (id: string, name: string, pipeline: PrepPipeline) => resource<{ resource: BundleDataSet; persistence: 'file' | 'ephemeral' }>(`/api/datasets/${encodeURIComponent(id)}/prep`, 'PUT', { name, pipeline });
  const deletePrep = (id: string) => resource<{ deleted: true }>(`/api/datasets/${encodeURIComponent(id)}/prep`, 'DELETE');
  const previewPrep = (id: string, pipeline: PrepPipeline, through: string | null, limit = 100) => resource<PrepPreview>(`/api/datasets/${encodeURIComponent(id)}/prep/preview`, 'POST', { pipeline, through, limit });
  const uploadFile = (body: { config: Readonly<Record<string, string>>; base64: string }) => resource<UploadSummary>('/api/uploads', 'POST', body);
  const validateConnector = (id: string, config: Readonly<Record<string, string>>) => resource<ConnectorState>(`/api/connectors/${encodeURIComponent(id)}/connect`, 'POST', { config });
  const listUsers = () => resource<Session[]>('/api/users');
  const listJobs = () => resource<TenantJob[]>('/api/jobs');
  const jobRecipients = () => resource<{ id: string; name: string; email: string }[]>('/api/job-recipients');
  const jobHistory = (id: string) => resource<JobHistory[]>(`/api/jobs/${encodeURIComponent(id)}/runs`);
  const jobDeliveries = (id: string) => resource<JobDelivery[]>(`/api/jobs/${encodeURIComponent(id)}/deliveries`);
  const runJob = (id: string) => resource<JobHistory>(`/api/jobs/${encodeURIComponent(id)}/runs`, 'POST', {});
  const saveUser = (id: string, body: { name: string; role: Role }) => resource<Session>(`/api/users/${encodeURIComponent(id)}`, 'PUT', body);
  const deleteUser = (id: string) => resource<{ deleted: true }>(`/api/users/${encodeURIComponent(id)}`, 'DELETE');
  const listInvitations = () => resource<Invitation[]>('/api/invitations');
  const inviteUser = (body: { id: string; name: string; role: Role }) => resource<{ invitation: Invitation; token: string }>('/api/invitations', 'POST', body);
  const revokeInvitation = (id: string) => resource<{ deleted: true }>(`/api/invitations/${encodeURIComponent(id)}`, 'DELETE');
  const acceptInvitation = (token: string) => resource<Session>('/api/invitations/accept', 'POST', { token });
  const getAIStatus = () => resource<AIStatus>('/api/o/status');
  const generateO = (request: ORequest) => resource<InterpretationResult>('/api/o/generate', 'POST', request);
  const generateCalculation = (request: ORequest) => resource<CalculationResult>('/api/o/calculation', 'POST', request);
  const getAIConfig = () => resource<AIConfig>('/api/admin/ai');
  const saveAIConfig = (config: Pick<AIConfig, 'provider' | 'model' | 'baseUrl'>) => resource<AIConfig>('/api/admin/ai', 'POST', config);
  const saveAIKey = (key: string) => resource<AIConfig>('/api/admin/ai/key', 'POST', { key });
  const testAIConnection = () => resource<{ ok: true }>('/api/admin/ai/test', 'POST', {});
  async function getSession(signal?: AbortSignal): Promise<Session> {
    const response = await authenticatedFetch(`${base}/api/session`, { signal, credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (!response.ok) {
      // Keep the machine-readable reason without exposing backend messages or
      // proxy HTML in startup guidance. Some outages do not return JSON at all.
      const body: unknown = await response.json().catch(() => undefined);
      const code = body !== null && typeof body === 'object' && 'errorCode' in body && typeof body.errorCode === 'string' ? body.errorCode : undefined;
      throw new ApiError('Session request failed.', response.status, code);
    }
    const body = object(await response.json(), 'Session');
    if (!isRole(body.role) || typeof body.id !== 'string' || typeof body.namespaceId !== 'string' || typeof body.name !== 'string') throw new ApiError('Invalid session.');
    return { id: body.id, namespaceId: body.namespaceId, name: body.name, role: body.role, ...(typeof body.tenantId === 'string' ? { tenantId: body.tenantId } : {}) };
  }
  async function getDatasetRefreshStatus(id: string, signal?: AbortSignal): Promise<DatasetRefreshStatus> {
    if (!/^[A-Za-z0-9_-]{1,512}$/.test(id)) throw new ApiError('Invalid dataset ID.');
    const response = await authenticatedFetch(`${base}/api/datasets/${encodeURIComponent(id)}/refresh-status`, { signal, headers: { Accept: 'application/json' } });
    let raw: unknown;
    try { raw = await response.json(); }
    catch { throw new ApiError(`Refresh status returned invalid JSON (HTTP ${response.status}).`, response.status); }
    if (!response.ok) throw new ApiError(`Refresh status unavailable (HTTP ${response.status}).`, response.status);
    const body = object(raw, 'Refresh status');
    const validDate = body.lastGood === null || typeof body.lastGood === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(body.lastGood) && Number.isFinite(Date.parse(body.lastGood)) && new Date(body.lastGood).toISOString() === body.lastGood;
    if (body.datasetId !== id || !validDate || !['never', 'running', 'ready', 'error'].includes(String(body.state))) throw new ApiError('Invalid refresh status.');
    const error = body.error === null ? null : object(body.error, 'Refresh error');
    if (error && (typeof error.code !== 'string' || typeof error.message !== 'string')) throw new ApiError('Invalid refresh error.');
    if ((body.state !== 'running' && (body.state === 'error') !== (error !== null)) ||
      (body.state === 'ready' && body.lastGood === null) || (body.state === 'never' && body.lastGood !== null)) throw new ApiError('Inconsistent refresh status.');
    return { lastGood: body.lastGood as string | null, state: body.state as DatasetRefreshStatus['state'], error: error ? { code: error.code as string, message: error.message as string } : null };
  }
  async function queryDataset(id: string, query: QueryRequest, signal?: AbortSignal): Promise<QueryResponse> {
    if (!/^[A-Za-z0-9_-]{1,512}$/.test(id)) throw new ApiError('Invalid dataset ID.');
    return runQuery(`/api/datasets/${encodeURIComponent(id)}/query`, query, signal);
  }
  async function queryO(query: QueryRequest, dashboardId?: string, signal?: AbortSignal): Promise<QueryResponse> {
    return runQuery('/api/o/query', query, signal, { query, ...(dashboardId ? { dashboardId } : {}) });
  }
  async function runQuery(route: string, query: QueryRequest, signal?: AbortSignal, payload: unknown = query): Promise<QueryResponse> {
    const response = await authenticatedFetch(`${base}${route}`, {
      method: 'POST', signal, headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    let raw: unknown;
    try { raw = await response.json(); }
    catch { throw new ApiError(`Query returned invalid JSON (HTTP ${response.status}).`, response.status); }
    const body = object(raw, 'Query response');
    if (response.status === 422 && typeof body.errorCode === 'string' && typeof body.message === 'string' && typeof body.path === 'string') {
      throw new QueryError(body.message, body.errorCode, body.path);
    }
    if (!response.ok) throw new ApiError(`${typeof body.errorCode === 'string' ? body.errorCode + ': ' : ''}Query failed (HTTP ${response.status})${typeof body.Message === 'string' ? `: ${body.Message}` : '.'}`, response.status);
    if (!Array.isArray(body.columns) || !Array.isArray(body.rows)) throw new ApiError('Invalid query result: expected columns and rows.');
    const columns: QueryResponse['columns'] = body.columns.map((raw, i) => {
      const column = object(raw, `columns[${i}]`);
      if (typeof column.name !== 'string' || !column.name || (column.type !== 'string' && column.type !== 'number')) throw new ApiError('Invalid query result column.');
      return { name: column.name, type: column.type };
    });
    const expected = [...query.dimensions.map(field => field.granularity ? field.granularity.toLowerCase() : field.fieldId), ...query.measures.map(field => field.fieldId)];
    if (new Set(expected).size !== expected.length || JSON.stringify(columns.map(column => column.name)) !== JSON.stringify(expected)) {
      throw new ApiError('Invalid query result: columns do not match assigned fields.');
    }
    const rows = body.rows.map((raw, i) => {
      const row = object(raw, `rows[${i}]`);
      return Object.fromEntries(columns.map(column => {
        const value = row[column.name];
        if (!Object.hasOwn(row, column.name) || (value !== null && !(column.type === 'number' ? typeof value === 'number' && Number.isFinite(value) : typeof value === 'string'))) {
          throw new ApiError(`Invalid query result cell: ${column.name}.`);
        }
        return [column.name, value as string | number | null];
      }));
    });
    return { columns, rows, ...(body.execution ? { execution: body.execution as ExecutionProvenance } : {}) };
  }
  async function getDefinition(kind: ResourceKind, id: string, signal?: AbortSignal): Promise<DefinitionResponse> {
    if (!/^[A-Za-z0-9_-]{1,512}$/.test(id)) throw new ApiError('Resource ID must contain 1–512 letters, digits, underscores or hyphens.');
    const route = kind === 'analysis' ? 'analyses' : 'dashboards';
    // Network failures and AbortError retain their original cause/name.
    const response = await authenticatedFetch(`${base}/${route}/${encodeURIComponent(id)}/definition`, { signal, headers: { Accept: 'application/json' } });
    let raw: unknown;
    try { raw = await response.json(); }
    catch { throw new ApiError(response.ok ? 'API returned invalid JSON.' : `API request failed (HTTP ${response.status}).`, response.status); }
    if (!response.ok) {
      const message = raw && typeof raw === 'object' && 'Message' in raw && typeof raw.Message === 'string' ? raw.Message : response.statusText;
      throw new ApiError(`API request failed (HTTP ${response.status})${message ? `: ${message}` : '.'}`, response.status);
    }
    try {
      const body = object(raw, 'Response');
      const idKey = kind === 'analysis' ? 'AnalysisId' : 'DashboardId';
      if (body[idKey] !== id) throw new Error(`Response.${idKey}: does not match requested resource`);
      if (body.Name !== undefined && typeof body.Name !== 'string') throw new Error('Response.Name: expected a string');
      if (body.Errors !== undefined && (!Array.isArray(body.Errors) || body.Errors.length)) throw new Error('Response.Errors: definition contains errors');
      return { id, ...(typeof body.Name === 'string' ? { name: body.Name } : {}), definition: convertDefinition(body.Definition) };
    } catch (error) {
      throw new ApiError(`Invalid definition response: ${error instanceof Error ? error.message : String(error)}`, response.status);
    }
  }
  return {
    login, logout, clearSession,
    listJobs, jobRecipients, jobHistory, jobDeliveries, runJob,
    getLocalData, getDatasetExecution, setDatasetExecution, refreshBlaze, getPreparedRows, listPrepSources, listPrepDatasets, savePrep, deletePrep, previewPrep, uploadFile, validateConnector, listUsers, saveUser, deleteUser, listInvitations, inviteUser, revokeInvitation, acceptInvitation, getAIStatus, generateO, generateCalculation, getAIConfig, saveAIConfig, saveAIKey, testAIConnection, getSession, queryO, getDatasetRefreshStatus,
    queryDataset,
    getAnalysisDefinition: (id: string, signal?: AbortSignal) => getDefinition('analysis', id, signal),
    getDashboardDefinition: (id: string, signal?: AbortSignal) => getDefinition('dashboard', id, signal),
  };
}
