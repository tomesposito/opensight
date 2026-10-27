import type { DashboardSummary, PublishedDashboard, ControlValues } from './published-dashboard.js';
import type { HostedAnalysisInput, Publication } from './hosted-publish.js';
import type { PrepPipeline } from '@opensight/bundle-parser/prep';
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
import { transportCapabilities, assembleResult, directUpload, operationStatus, reservationStatus, type TransportCapabilities, type UploadProgress } from './object-transfers.js';
import { createWorkspaceStartup } from './workspace-startup.js';
import { hostedExecution, prepSources, type HostedPrepDataset, type PrepDatasetsResponse, type PrepSaveResponse } from './prep-contracts.js';

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
  version?: number;
  materializationReason?: string | null;
  state: 'direct' | 'empty' | 'running' | 'ready' | 'error' | 'evicted' | 'invalidated' | 'unknown';
  lastRefreshedAt: string | null; rowCount: number | null; bytes: number | null; nextRefreshAt: string | null;
  error: { code: string; message: string; causeCode?: string } | null;
}
export interface ExecutionProvenance {
  mode: ExecutionSettings['mode']; cached: boolean; refreshedAt: string | null;
  cachedInputs: { datasetId: string; refreshedAt: string }[];
}
export interface PreparedRows {
  columns: import('@opensight/bundle-parser/prep').PrepColumn[];
  rows: Record<string, string | number | boolean | null>[];
  rowCount: number; truncated: boolean; execution?: ExecutionProvenance;
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

export interface Invitation { id: string; namespaceId: string; name: string; role: Role; invitedBy?: string; email?: string; expiresAt: string }
export interface TenantJob { id: string; ownerId: string; version: number; spec: { kind: 'refresh' | 'report' | 'alert'; enabled: boolean }; stopped: boolean; nextRun: string | null }
export interface JobHistory { id: string; state: string; errorCode: string | null; createdAt: string; finishedAt: string | null }
export interface JobDelivery { delivery_id: string; recipient_id: string; state: string; attempts: number; error_code: string | null }
export interface AIStatus { configured: boolean; state: 'configured' | 'not-configured' | 'needs-approval' }
export interface ORequest { question: string; dashboardId?: string; calculatedFields?: readonly CalculatedField[] }
export interface AnalyticsConfig { enabled: boolean; override: boolean | null; defaultEnabled: boolean; configured: boolean }
export interface AIConfig {
  provider: 'openai' | 'anthropic' | 'openai-compatible' | 'bedrock' | null;
  model: string; baseUrl?: string; hasKey: boolean; configured: boolean;
  state: 'configured' | 'not-configured' | 'needs-approval';
  keyStorage: 'ephemeral' | 'encrypted-file'; canSaveKey: boolean; compatibleBaseUrls: string[];
}

export interface LoginInput { email: string; password: string; code: string }
export interface SignedIn { session: Session; expiresAt: number }
export interface WorkspaceSelectionInfo { tenantId: string; name: string; slug: string | null }
export interface WorkspaceSelection {
  kind: 'selection'; email: string; workspaces: WorkspaceSelectionInfo[];
  selectionToken: string; selectionExpiresAt: number;
}
export type LoginResult = SignedIn | WorkspaceSelection;
export function isWorkspaceSelection(value: LoginResult | undefined): value is WorkspaceSelection {
  return !!value && 'kind' in value && value.kind === 'selection';
}
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

export interface AvailabilityEvent { kind: 'authentication-required' | 'connection-required'; errorCode?: string }
export function createApiClient(baseUrl = DEFAULT_API_URL, fetcher: typeof fetch = globalThis.fetch, options: { onDemand?: boolean } = {}) {
  const base = (baseUrl.trim() || DEFAULT_API_URL).replace(/\/+$/, '');
  const onDemand = options.onDemand === true, subscribers = new Set<(event: AvailabilityEvent) => void>();
  let startup: ReturnType<typeof createWorkspaceStartup> | undefined;
  const connect = (signal?: AbortSignal) => (startup ??= createWorkspaceStartup(fetcher)).connect(signal);
  const subscribeAvailability = (listener: (event: AvailabilityEvent) => void) => { subscribers.add(listener); return () => { subscribers.delete(listener); }; };
  const notifyAvailability = (event: AvailabilityEvent) => { if (onDemand) for (const listener of subscribers) listener(event); };
  // This closure is the only bearer store. Never persist it in browser storage.
  let credential: { token: string; expiresAt: number } | undefined;
  let generation = 0;
  let capabilities: TransportCapabilities | undefined;
  function clearSession() { credential = undefined; capabilities = undefined; generation++; }
  function currentSession(expected: number, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (expected !== generation) throw new ApiError('Session changed during request.', 401, 'AUTH_REQUEST_SUPERSEDED');
    if (credential && credential.expiresAt <= Date.now()) { clearSession(); notifyAvailability({ kind: 'authentication-required', errorCode: 'SESSION_EXPIRED' }); throw new ApiError('Your session has expired.', 401, 'SESSION_EXPIRED'); }
  }
  function controlBody(body: unknown): string {
    const json = JSON.stringify(body);
    if (capabilities && new TextEncoder().encode(json).length > capabilities.controlJsonBytes) throw new ApiError('This request exceeds the workspace JSON limit.', 413, 'CONTROL_PAYLOAD_TOO_LARGE');
    return json;
  }
  async function authenticatedFetch(url: string, options: RequestInit): Promise<Response> {
    const current = generation;
    if (credential && credential.expiresAt <= Date.now()) {
      clearSession();
      notifyAvailability({ kind: 'authentication-required', errorCode: 'SESSION_EXPIRED' });
      throw new ApiError('Your session has expired.', 401, 'SESSION_EXPIRED');
    }
    const response = await fetcher(url, credential ? { ...options, credentials: 'omit', headers: { ...options.headers, Authorization: `Bearer ${credential.token}` } } : options);
    if (current !== generation) throw new ApiError('Session changed during request.', 401, 'AUTH_REQUEST_SUPERSEDED');
    if (onDemand && (response.status === 401 || [502, 503, 504].includes(response.status))) {
      const body: unknown = await response.clone().json().catch(() => undefined);
      if (current !== generation) throw new ApiError('Session changed during request.', 401, 'AUTH_REQUEST_SUPERSEDED');
      const code = body && typeof body === 'object' && 'errorCode' in body && typeof body.errorCode === 'string' ? body.errorCode : undefined;
      if (response.status === 401 && credential) {
        clearSession(); notifyAvailability({ kind: 'authentication-required', errorCode: code });
        throw new ApiError('Your session is no longer valid. Sign in again.', 401, code);
      }
      if ([502, 504].includes(response.status) || ['WORKSPACE_STARTING', 'WORKSPACE_UNAVAILABLE', 'WORKSPACE_MAINTENANCE'].includes(code ?? '')) notifyAvailability({ kind: 'connection-required', errorCode: code });
    }
    return response;
  }
  async function authResponse(response: Response): Promise<Record<string, unknown>> {
    const value: unknown = await response.json().catch(() => undefined);
    const body = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
    if (!response.ok) throw new ApiError('Authentication request failed.', response.status, typeof body?.errorCode === 'string' ? body.errorCode : undefined);
    if (!body) throw new ApiError('Invalid authentication response.', response.status, 'AUTH_RESPONSE_INVALID');
    return body;
  }
  function workspaceSelection(body: Record<string, unknown>): WorkspaceSelection {
    const invalid = () => new ApiError('Invalid authentication response.', undefined, 'AUTH_RESPONSE_INVALID');
    if (body.selectionRequired !== true || typeof body.email !== 'string' || !Array.isArray(body.workspaces) || body.workspaces.length < 2
      || typeof body.selectionToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.selectionToken)
      || typeof body.selectionExpiresAt !== 'number' || !Number.isSafeInteger(body.selectionExpiresAt) || body.selectionExpiresAt <= Date.now()) throw invalid();
    const workspaces = body.workspaces.map(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw invalid();
      const workspace = item as Record<string, unknown>;
      if (typeof workspace.tenantId !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/.test(workspace.tenantId) || typeof workspace.name !== 'string' || !workspace.name
        || (workspace.slug !== null && typeof workspace.slug !== 'string')) throw invalid();
      return { tenantId: workspace.tenantId, name: workspace.name, slug: workspace.slug };
    });
    if (new Set(workspaces.map(w => w.tenantId)).size !== workspaces.length) throw invalid();
    return { kind: 'selection', email: body.email, workspaces, selectionToken: body.selectionToken, selectionExpiresAt: body.selectionExpiresAt };
  }
  async function establishSession(body: Record<string, unknown>, remember: boolean, signal: AbortSignal | undefined, current: number, started: number): Promise<SignedIn> {
    if (current !== generation || signal?.aborted) throw new ApiError('Sign-in cancelled.', undefined, 'AUTH_REQUEST_SUPERSEDED');
    if (typeof body.token !== 'string' || !/^[A-Za-z0-9_.-]{1,1017}$/.test(body.token) ||
        typeof body.expiresAt !== 'number' || !Number.isSafeInteger(body.expiresAt) || body.expiresAt <= Date.now() || (typeof body.tenantId !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/.test(body.tenantId))) {
      throw new ApiError('Invalid authentication response.', undefined, 'AUTH_RESPONSE_INVALID');
    }
    const expectedTenant = body.tenantId;
    const expiresAt = Math.min(body.expiresAt, started + (remember ? MAX_SESSION_MS : SHORT_SESSION_MS));
    credential = { token: body.token, expiresAt };
    const session = await getSession(signal);
    if (current !== generation || signal?.aborted) throw new ApiError('Sign-in cancelled.', undefined, 'AUTH_REQUEST_SUPERSEDED');
    if (session.tenantId !== expectedTenant) throw new ApiError('Invalid authentication response.', undefined, 'AUTH_RESPONSE_INVALID');
    if (expiresAt <= Date.now()) throw new ApiError('Your session has expired.', 401, 'SESSION_EXPIRED');
    return { session, expiresAt };
  }
  async function login(input: LoginInput, remember: boolean, signal?: AbortSignal): Promise<LoginResult> {
    clearSession();
    const current = generation, started = Date.now();
    try {
      // The login boundary rejects BOTH cookies and Authorization, even stale ones.
      // No workspace travels with the request: the server either issues the
      // session directly (single membership) or challenges with a picker.
      const body = await authResponse(await fetcher(`${base}/api/auth/login`, {
        method: 'POST', credentials: 'omit', signal,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: input.email, password: input.password, code: input.code }),
      }));
      if (body.selectionRequired === true) {
        if (current !== generation || signal?.aborted) throw new ApiError('Sign-in cancelled.', undefined, 'AUTH_REQUEST_SUPERSEDED');
        return workspaceSelection(body);
      }
      return await establishSession(body, remember, signal, current, started);
    } catch (error) {
      if (current === generation) clearSession();
      throw error;
    }
  }
  async function selectWorkspace(selectionToken: string, tenantId: string, remember: boolean, signal?: AbortSignal): Promise<SignedIn> {
    clearSession();
    const current = generation, started = Date.now();
    try {
      // Same login boundary as /api/auth/login: no cookies, no Authorization.
      const body = await authResponse(await fetcher(`${base}/api/auth/login/select`, {
        method: 'POST', credentials: 'omit', signal,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectionToken, tenantId }),
      }));
      if (body.tenantId !== tenantId) throw new ApiError('Invalid authentication response.', undefined, 'AUTH_RESPONSE_INVALID');
      return await establishSession(body, remember, signal, current, started);
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
  async function rawResource(route: string, method = 'GET', body?: unknown, signal?: AbortSignal, key?: string): Promise<unknown> {
    const expected = generation;
    const response = await authenticatedFetch(`${base}${route}`, { method, ...(signal ? { signal } : {}), credentials: 'same-origin', headers: { Accept: 'application/json', ...(key ? { 'Idempotency-Key': key } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: controlBody(body) }) });
    const value: unknown = await response.json();
    if (!response.ok) {
      const error = object(value, 'API error');
      throw new ApiError(`${typeof error.errorCode === 'string' ? `${error.errorCode}: ` : ''}${typeof error.Message === 'string' ? error.Message : 'Request failed'}`, response.status, typeof error.errorCode === 'string' ? error.errorCode : undefined);
    }
    currentSession(expected, signal); return value;
  }
  async function resolveResult(value: unknown, expected: number, signal?: AbortSignal): Promise<unknown> {
    if (!value || typeof value !== 'object' || !('operation' in value)) return value;
    if (!capabilities?.resultChunks) throw new ApiError('Result transfers are not available in this session.', 503, 'RESULT_TRANSPORT_REQUIRED');
    return assembleResult(value, capabilities.resultChunks.maxResultBytes, route => rawResource(route, 'GET', undefined, signal), () => currentSession(expected, signal));
  }
  async function resource<T>(route: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
    const expected = generation;
    return await resolveResult(await rawResource(route, method, body, signal), expected, signal) as T;
  }
  const getTransportCapabilities = () => capabilities ? structuredClone(capabilities) : undefined;
  const getOperation = async (id: string, signal?: AbortSignal) => operationStatus(await rawResource(`/api/operations/${encodeURIComponent(id)}`, 'GET', undefined, signal));
  const getUploadReservation = async (id: string, signal?: AbortSignal) => reservationStatus(await rawResource(`/api/uploads/reservations/${encodeURIComponent(id)}`, 'GET', undefined, signal));
  const cancelOperation = async (id: string, expectedRevision: number, signal?: AbortSignal) => operationStatus(await rawResource(`/api/operations/${encodeURIComponent(id)}`, 'DELETE', { expectedRevision }, signal));
  const cancelUploadReservation = async (id: string, expectedRevision: number, signal?: AbortSignal) => reservationStatus(await rawResource(`/api/uploads/reservations/${encodeURIComponent(id)}`, 'DELETE', { expectedRevision }, signal));
  const uploadDirectFile = (file: Blob, config: Readonly<Record<string, string>>, expiresAt: string, progress: (value: UploadProgress) => void, signal?: AbortSignal) => {
    if (!capabilities?.directUploads) throw new ApiError('Direct uploads are not available in this session.', 503, 'UPLOAD_TRANSPORT_REQUIRED');
    const expected = generation;
    return directUpload(file, config, expiresAt, rawResource, fetcher, () => currentSession(expected, signal), progress, signal);
  };
  const getDatasetExecution = async (id: string): Promise<ExecutionStatus> => {
    const status = await resource<ExecutionStatus | ExecutionSettings>(`/api/datasets/${encodeURIComponent(id)}/execution`);
    if ('state' in status) return status;
    // Read configuration and its optimistic version together; /execution alone
    // supplies no version in hosted mode.
    const saved = await resource<HostedPrepDataset>(`/api/datasets/${encodeURIComponent(id)}/prep`);
    return hostedExecution(saved.execution, saved.version);
  };
  async function getLocalData(signal?: AbortSignal): Promise<boolean> {
    const response = await authenticatedFetch(`${base}/api/local-data`, { signal, credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (!response.ok) return false;
    const value = object(await response.json(), 'Local data capability');
    return value.mode === 'local' && value.maxUploadBytes === 8388608 && value.uploadTtlSeconds === 86400;
  }
  const setDatasetExecution = async (id: string, settings: ExecutionSettings & { expectedVersion?: number }): Promise<ExecutionStatus> => {
    const result = await resource<ExecutionStatus | ExecutionSettings>(`/api/datasets/${encodeURIComponent(id)}/execution`, 'PUT', settings);
    return 'state' in result ? result : hostedExecution(result, settings.expectedVersion === undefined ? undefined : settings.expectedVersion + 1);
  };
  const refreshBlaze = async (id: string): Promise<ExecutionStatus> => {
    const result = await resource<ExecutionStatus | { mode: 'BLAZE'; state: 'ready' }>(`/api/datasets/${encodeURIComponent(id)}/refresh`, 'POST', {});
    // Hosted refresh acknowledges completion, but supplies neither configuration
    // nor cache telemetry. Do not present its partial body as a local status.
    return 'intervalMinutes' in result ? result : getDatasetExecution(id);
  };
  const getPreparedRows = (id: string) => resource<PreparedRows>(`/api/datasets/${encodeURIComponent(id)}/rows`);
  const listPrepDatasets = () => resource<PrepDatasetsResponse>('/api/prep-datasets');
  const listPrepSources = async (saved?: PrepDatasetsResponse) => {
    const [catalog, sources] = await Promise.all([saved ?? listPrepDatasets(), resource<PrepSourceSummary[]>('/api/prep-sources')]);
    return prepSources(catalog, sources);
  };
  const savePrep = (id: string, name: string, pipeline: PrepPipeline, expectedVersion?: number) => resource<PrepSaveResponse>(`/api/datasets/${encodeURIComponent(id)}/prep`, 'PUT', { name, pipeline, ...(expectedVersion === undefined ? {} : { expectedVersion }) });
  const deletePrep = (id: string, expectedVersion?: number) => resource<{ deleted: true } | { removed: true }>(`/api/datasets/${encodeURIComponent(id)}/prep`, 'DELETE', expectedVersion === undefined ? undefined : { expectedVersion });
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
  const inviteUser = (body: ({ id: string } | { email: string }) & { name: string; role: Role }) => resource<{ invitation: Invitation; token: string }>('/api/invitations', 'POST', body);
  const revokeInvitation = (id: string) => resource<{ deleted: true }>(`/api/invitations/${encodeURIComponent(id)}`, 'DELETE');
  const acceptInvitation = (token: string) => resource<Session>('/api/invitations/accept', 'POST', { token });
  const getAIStatus = () => resource<AIStatus>('/api/o/status');
  const generateO = (request: ORequest) => resource<InterpretationResult>('/api/o/generate', 'POST', request);
  const generateCalculation = (request: ORequest) => resource<CalculationResult>('/api/o/calculation', 'POST', request);
  const getAnalyticsConfig = () => resource<AnalyticsConfig>('/api/admin/analytics');
  const saveAnalyticsConfig = (enabled: boolean) => resource<AnalyticsConfig>('/api/admin/analytics', 'POST', { enabled });
  const getAIConfig = () => resource<AIConfig>('/api/admin/ai');
  const saveAIConfig = (config: Pick<AIConfig, 'provider' | 'model' | 'baseUrl'>) => resource<AIConfig>('/api/admin/ai', 'POST', config);
  const saveAIKey = (key: string) => resource<AIConfig>('/api/admin/ai/key', 'POST', { key });
  const testAIConnection = () => resource<{ ok: true }>('/api/admin/ai/test', 'POST', {});
  async function getSession(signal?: AbortSignal): Promise<Session> {
    const expected = generation;
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
    currentSession(expected, signal); capabilities = transportCapabilities(body.capabilities);
    // The workspace label rides the session; older servers omit both fields,
    // in which case the tenant ID stays the label (never a typed input).
    const tenantId = typeof body.tenantId === 'string' ? body.tenantId : undefined;
    if (body.workspaceName !== undefined && typeof body.workspaceName !== 'string'
      || body.workspaceSlug !== undefined && body.workspaceSlug !== null && typeof body.workspaceSlug !== 'string') throw new ApiError('Invalid session.');
    const workspaceName = typeof body.workspaceName === 'string' && body.workspaceName ? body.workspaceName : tenantId;
    return {
      id: body.id, namespaceId: body.namespaceId, name: body.name, role: body.role,
      ...(tenantId ? { tenantId } : {}), ...(workspaceName ? { workspaceName } : {}),
      workspaceSlug: typeof body.workspaceSlug === 'string' ? body.workspaceSlug : null,
    };
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
  async function runQuery(route: string, query: QueryRequest | undefined, signal?: AbortSignal, payload: unknown = query): Promise<QueryResponse> {
    const sessionGeneration = generation;
    const response = await authenticatedFetch(`${base}${route}`, {
      method: 'POST', signal, headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: controlBody(payload),
    });
    let raw: unknown;
    try { raw = await response.json(); }
    catch { throw new ApiError(`Query returned invalid JSON (HTTP ${response.status}).`, response.status); }
    if (response.ok) raw = await resolveResult(raw, sessionGeneration, signal);
    currentSession(sessionGeneration, signal);
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
    const expected = query ? [...query.dimensions.map(field => field.granularity ? field.granularity.toLowerCase() : field.fieldId), ...query.measures.map(field => field.fieldId)] : columns.map(column => column.name);
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
  async function listDashboards(signal?: AbortSignal): Promise<DashboardSummary[]> {
    const items: DashboardSummary[] = [], seen = new Set<string>();
    let cursor: string | null = null;
    do {
      const body = object(await rawResource(`/api/v1/dashboards${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, 'GET', undefined, signal), 'Dashboard collection');
      if (!Array.isArray(body.items) || !(body.nextCursor === null || typeof body.nextCursor === 'string')) throw new ApiError('DASHBOARD_RESPONSE_INVALID: Invalid collection.');
      for (const raw of body.items) {
        const item = object(raw, 'Dashboard');
        if (typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/.test(item.id) || typeof item.name !== 'string' || !Number.isSafeInteger(item.version)) throw new ApiError('DASHBOARD_RESPONSE_INVALID: Invalid collection item.');
        items.push(item as unknown as DashboardSummary);
      }
      cursor = body.nextCursor as string | null;
      if (cursor && seen.has(cursor)) throw new ApiError('DASHBOARD_RESPONSE_INVALID: Repeated collection cursor.');
      if (cursor) seen.add(cursor);
    } while (cursor);
    return items;
  }
  async function getPublishedDashboard(id: string, signal?: AbortSignal): Promise<PublishedDashboard> {
    const body = object(await rawResource(`/api/v1/dashboards/${encodeURIComponent(id)}`, 'GET', undefined, signal), 'Dashboard');
    if (body.DashboardId !== id || typeof body.Name !== 'string' || !Number.isSafeInteger(body.Version) || Number(body.Version) < 1 || !Array.isArray(body.Errors)) throw new ApiError('DASHBOARD_RESPONSE_INVALID: Invalid dashboard definition.');
    return { id, name: body.Name, version: Number(body.Version), definition: convertDefinition(body.Definition), errors: body.Errors as PublishedDashboard['errors'] };
  }
  const queryDashboardVisual = (id: string, version: number, visualId: string, controlValues: ControlValues, signal?: AbortSignal) =>
    runQuery(`/api/v1/dashboards/${encodeURIComponent(id)}/versions/${version}/visuals/${encodeURIComponent(visualId)}/query`, undefined, signal, { controlValues });
  async function saveHostedAnalysis(id: string, input: HostedAnalysisInput, revision?: number): Promise<number> {
    const expected = generation;
    const response = await authenticatedFetch(`${base}/api/v1/analyses${revision === undefined ? '' : `/${encodeURIComponent(id)}`}`, {
      method: revision === undefined ? 'POST' : 'PUT', credentials: 'same-origin',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(revision === undefined ? {} : { 'If-Match': `"${revision}"` }) },
      body: controlBody({ ...(revision === undefined ? { analysisId: id } : {}), ...input }),
    });
    const body = object(await response.json(), 'Analysis response'); currentSession(expected);
    if (!response.ok) throw new ApiError(`${body.errorCode ?? 'ANALYSIS_SAVE_FAILED'}: ${body.Message ?? body.message ?? 'Could not save analysis.'}`, response.status, typeof body.errorCode === 'string' ? body.errorCode : undefined);
    const etag = response.headers.get('etag');
    if (body.AnalysisId !== id || !etag || !/^"[1-9]\d*"$/.test(etag) || !Number.isSafeInteger(Number(etag.slice(1, -1)))) throw new ApiError('ANALYSIS_RESPONSE_INVALID: Missing analysis identity or revision.');
    return Number(etag.slice(1, -1));
  }
  async function publishAnalysis(id: string, dashboardId: string | undefined, key: string): Promise<Publication> {
    const body = object(await rawResource(`/api/v1/analyses/${encodeURIComponent(id)}/publish`, 'POST', dashboardId ? { dashboardId } : {}, undefined, key), 'Publish response');
    if (typeof body.DashboardId !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/.test(body.DashboardId) || !Number.isSafeInteger(body.Version) || Number(body.Version) < 1 || !Array.isArray(body.Errors)) throw new ApiError('DASHBOARD_RESPONSE_INVALID: Missing publication receipt.');
    return body as unknown as Publication;
  }
  return {
    shareDashboard: (id: string, userId: string) => resource(`/api/v1/dashboards/${encodeURIComponent(id)}/shares/user/${encodeURIComponent(userId)}`, 'PUT', { role: 'viewer' }),
    listDashboards, getPublishedDashboard, queryDashboardVisual,
    saveHostedAnalysis, publishAnalysis,
    onDemand, connect, subscribeAvailability,
    login, selectWorkspace, logout, clearSession, getTransportCapabilities, uploadDirectFile, getOperation, getUploadReservation, cancelOperation, cancelUploadReservation,
    listJobs, jobRecipients, jobHistory, jobDeliveries, runJob,
    getLocalData, getDatasetExecution, setDatasetExecution, refreshBlaze, getPreparedRows, listPrepSources, listPrepDatasets, savePrep, deletePrep, previewPrep, uploadFile, validateConnector, listUsers, saveUser, deleteUser, listInvitations, inviteUser, revokeInvitation, acceptInvitation, getAIStatus, generateO, generateCalculation, getAnalyticsConfig, saveAnalyticsConfig, getAIConfig, saveAIConfig, saveAIKey, testAIConnection, getSession, queryO, getDatasetRefreshStatus,
    queryDataset,
    getAnalysisDefinition: (id: string, signal?: AbortSignal) => getDefinition('analysis', id, signal),
    getDashboardDefinition: (id: string, signal?: AbortSignal) => getDefinition('dashboard', id, signal),
  };
}
