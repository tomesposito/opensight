export interface EmbedRequest { dashboardId: string; visualId?: string; parentOrigin: string; expiresInSeconds?: number }
export interface EmbedUrl { url: string; expiresAt: string }
export interface EmbeddingClientOptions {
  apiOrigin: string;
  /** Host-owned credentials, verified by the API's Phase 3b authenticate callback. */
  getAuthorization?: () => string | undefined | Promise<string | undefined>;
  /** SSO stub: sign in using your host's provider, then let getAuthorization return its credential.
   * No identity, namespace or group assertion from this browser hook is trusted by the API. */
  onAuthenticationRequired?: () => Promise<void>;
  fetch?: typeof fetch;
}
export interface EmbedCallbacks { onReady?: () => void; onExpired?: () => void; onError?: (error: Error) => void }
export interface EmbeddedContent { iframe: HTMLIFrameElement; refresh(): Promise<void>; destroy(): void }
export class EmbeddingError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'EmbeddingError'; }
}
/** Deliberate documented stub. The SDK does not implement OIDC, SAML or credential exchange. */
export async function ssoNotConfigured(): Promise<never> { throw new EmbeddingError('SSO_NOT_CONFIGURED', 'Configure a host sign-in hook and the API credential verifier'); }
function origin(value: string): string {
  const url = new URL(value);
  if (url.origin !== value || url.username || url.password || (!/^[a-z0-9.-]+$/i.test(url.hostname) && !/^\[[a-f0-9:]+\]$/i.test(url.hostname)) || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) throw new EmbeddingError('INVALID_ORIGIN', 'Expected an exact HTTPS origin or loopback HTTP');
  return value;
}
function resourceId(value: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/.test(value)) throw new EmbeddingError('INVALID_RESOURCE_ID', 'Invalid resource ID');
  return value;
}
export function createEmbeddingClient(options: EmbeddingClientOptions) {
  const apiOrigin = origin(options.apiOrigin), fetcher = options.fetch ?? globalThis.fetch;
  async function generateEmbedUrl(request: EmbedRequest, signal?: AbortSignal): Promise<EmbedUrl> {
    const dashboardId = resourceId(request.dashboardId), parentOrigin = origin(request.parentOrigin);
    const visualId = request.visualId === undefined ? undefined : resourceId(request.visualId);
    if (request.expiresInSeconds !== undefined && (!Number.isSafeInteger(request.expiresInSeconds) || request.expiresInSeconds < 60 || request.expiresInSeconds > 900)) throw new EmbeddingError('INVALID_EXPIRY', 'Expiry must be 60–900 whole seconds');
    const send = async () => {
      const authorization = await options.getAuthorization?.();
      return fetcher(`${apiOrigin}/dashboards/${dashboardId}/embed-url`, { method: 'POST', credentials: 'include', cache: 'no-store', redirect: 'error', signal,
        headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) },
        body: JSON.stringify({ parentOrigin, ...(visualId === undefined ? {} : { visualId }), ...(request.expiresInSeconds === undefined ? {} : { expiresInSeconds: request.expiresInSeconds }) }) });
    };
    let response = await send();
    if (response.status === 401 && options.onAuthenticationRequired) { await options.onAuthenticationRequired(); response = await send(); }
    if (!response.ok) throw new EmbeddingError(`HTTP_${response.status}`, 'The hosted API could not generate an embed URL');
    const result = await response.json() as Partial<EmbedUrl>;
    if (typeof result.url !== 'string' || typeof result.expiresAt !== 'string' || !Number.isFinite(Date.parse(result.expiresAt)) || Date.parse(result.expiresAt) <= Date.now()) throw new EmbeddingError('INVALID_RESPONSE', 'The API returned an invalid embed URL');
    const url = new URL(result.url);
    if (url.origin !== apiOrigin || url.username || url.password || url.pathname !== `/embed/dashboards/${dashboardId}` || url.hash || [...url.searchParams.keys()].length !== 1 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('token') ?? '')) throw new EmbeddingError('INVALID_RESPONSE', 'The API returned an invalid embed URL');
    return { url: url.href, expiresAt: result.expiresAt };
  }
  async function mount(container: HTMLElement, request: EmbedRequest, callbacks: EmbedCallbacks): Promise<EmbeddedContent> {
    const view = container.ownerDocument.defaultView;
    if (!view || origin(view.location.origin) !== request.parentOrigin) throw new EmbeddingError('PARENT_ORIGIN_MISMATCH', 'The parent origin must match the embedding page');
    const iframe = container.ownerDocument.createElement('iframe');
    iframe.title = request.visualId ? 'OpenSight visual' : 'OpenSight dashboard';
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    iframe.referrerPolicy = 'no-referrer';
    iframe.style.width = '100%'; iframe.style.height = '100%'; iframe.style.border = '0';
    let destroyed = false, generation = 0, controller: AbortController | undefined, timer: ReturnType<typeof setTimeout> | undefined;
    const clearTimer = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
    const message = (event: MessageEvent<unknown>) => {
      if (destroyed || event.source !== iframe.contentWindow || event.origin !== apiOrigin || !event.data || typeof event.data !== 'object') return;
      const data = event.data as Record<string, unknown>;
      if (data.dashboardId !== request.dashboardId || data.visualId !== request.visualId) return;
      if (data.type === 'opensight:ready') { clearTimer(); callbacks.onReady?.(); }
      else if (data.type === 'opensight:expired') callbacks.onExpired?.();
    };
    const error = () => { clearTimer(); callbacks.onError?.(new EmbeddingError('FRAME_LOAD_FAILED', 'Unable to load the hosted embed')); };
    const destroy = () => { if (destroyed) return; destroyed = true; generation++; controller?.abort(); clearTimer(); view.removeEventListener('message', message); iframe.removeEventListener('error', error); iframe.remove(); };
    const refresh = async () => {
      if (destroyed) throw new EmbeddingError('EMBED_DESTROYED', 'The embed has been destroyed');
      const current = ++generation; controller?.abort(); controller = new AbortController();
      const signed = await generateEmbedUrl(request, controller.signal);
      if (destroyed || current !== generation) return;
      clearTimer(); iframe.src = signed.url;
      timer = setTimeout(() => callbacks.onError?.(new EmbeddingError('FRAME_NOT_READY', 'The hosted embed did not become ready')), 30000);
    };
    view.addEventListener('message', message); iframe.addEventListener('error', error);
    try { await refresh(); container.appendChild(iframe); } catch (error) { destroy(); throw error; }
    return { iframe, refresh, destroy };
  }
  return {
    generateEmbedUrl,
    embedDashboard(container: HTMLElement, request: Omit<EmbedRequest, 'visualId'>, callbacks: EmbedCallbacks = {}): Promise<EmbeddedContent> { return mount(container, { ...request, visualId: undefined }, callbacks); },
    embedVisual(container: HTMLElement, request: EmbedRequest & { visualId: string }, callbacks: EmbedCallbacks = {}): Promise<EmbeddedContent> { return mount(container, request, callbacks); },
  };
}
