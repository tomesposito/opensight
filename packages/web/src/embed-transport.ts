export interface EmbedShell { sessionId: string; allowedDomains: string[] }
export type SessionState = 'loading' | 'ready' | 'error' | 'expired' | 'revoked' | 'saved';
export interface EmbedTransport {
  request<T>(action: 'content' | 'question' | 'analysis' | 'save', body?: unknown): Promise<T>;
  ready(): void; saved(): void; destroy(): void;
}
/** No storage, cookies, URL credentials, or credential-bearing parent messages. */
export function startEmbedTransport(shell: EmbedShell, bootstrapValue: string, changed: (state: SessionState) => void,
  connected: (transport: EmbedTransport) => Promise<void>, view: Window = window, fetcher: typeof fetch = fetch): EmbedTransport {
  let bootstrap = bootstrapValue, credential = '', parentOrigin = '', channelId = '', expiresAt = 0, deadline = 0;
  let destroyed = false, terminal = false, initialized = false;
  let pendingStatus: Promise<void> | undefined;
  const controllers = new Set<AbortController>();
  let poll: number | undefined, watchdog: number | undefined, expiry: number | undefined;
  const emit = (event: string) => {
    if (parentOrigin && channelId && !destroyed) view.parent.postMessage({ version: 2, type: 'opensight:session', event, sessionId: shell.sessionId, channelId }, parentOrigin);
  };
  const stopTimers = () => { if (poll !== undefined) view.clearInterval(poll); if (watchdog !== undefined) view.clearTimeout(watchdog); if (expiry !== undefined) view.clearTimeout(expiry); };
  const stop = (state: SessionState) => {
    if (terminal || destroyed) return;
    terminal = true; bootstrap = ''; credential = ''; stopTimers(); controllers.forEach(c => c.abort()); controllers.clear();
    changed(state); emit(state === 'expired' ? 'sessionExpired' : state === 'revoked' ? 'authorizationRevoked' : state === 'saved' ? 'saved' : 'error');
  };
  const failure = (code: unknown) => stop(code === 'EMBED_SESSION_EXPIRED' || code === 'EMBED_BOOTSTRAP_EXPIRED' ? 'expired'
    : ['EMBED_SESSION_REVOKED', 'EMBED_KEY_REVOKED', 'AUTHORIZATION_REVISED', 'TENANT_UNAVAILABLE', 'EMBED_SUBJECT_UNRESOLVED'].includes(String(code)) ? 'revoked' : 'error');
  const call = async <T>(action: string, body?: unknown): Promise<T> => {
    if (destroyed || terminal) throw new Error('EMBED_UNAVAILABLE');
    const controller = new AbortController(); controllers.add(controller);
    const timeout = view.setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetcher(`/api/embed/sessions/${shell.sessionId}/${action}`, { method: body === undefined ? 'GET' : 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal,
        headers: { ...(credential ? { Authorization: `Embed ${credential}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const result = await response.json() as T & { errorCode?: string };
      if (!response.ok) { failure(result.errorCode); throw new Error('EMBED_UNAVAILABLE'); }
      if (destroyed || terminal) throw new Error('EMBED_UNAVAILABLE');
      return result;
    } catch { stop('error'); throw new Error('EMBED_UNAVAILABLE'); }
    finally { view.clearTimeout(timeout); controllers.delete(controller); }
  };
  const status = (): Promise<void> => {
    if (pendingStatus) return pendingStatus;
    if (terminal || destroyed || !credential) return Promise.resolve();
    pendingStatus = (async () => {
    try {
      const result = await call<{ expiresAt: number }>('status');
      if (result.expiresAt !== expiresAt || Date.now() >= expiresAt) { stop('expired'); return; }
      deadline = Math.min(Date.now() + 45000, expiresAt);
      if (watchdog !== undefined) view.clearTimeout(watchdog);
      watchdog = view.setTimeout(() => stop(Date.now() >= expiresAt ? 'expired' : 'revoked'), Math.max(0, deadline - Date.now()));
    } finally { pendingStatus = undefined; }
    })();
    return pendingStatus;
  };
  const visibility = () => {
    if (terminal || destroyed || !credential) return;
    // A hidden/frozen document never keeps an authorized view visible on resume.
    changed('loading');
    if (view.document.visibilityState === 'visible') void status().then(() => {
      if (!terminal && !destroyed && Date.now() < deadline) changed('ready');
    }).catch(() => {});
  };
  const message = (event: MessageEvent<unknown>) => {
    if (initialized || terminal || destroyed || view.parent === view || event.source !== view.parent || !shell.allowedDomains.includes(event.origin) || event.origin === view.location.origin || !event.data || typeof event.data !== 'object') return;
    const data = event.data as Record<string, unknown>;
    if (Object.keys(data).some(k => !['version', 'type', 'sessionId', 'channelId'].includes(k)) || data.version !== 2 || data.type !== 'opensight:initialize' || data.sessionId !== shell.sessionId || typeof data.channelId !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(data.channelId)) return;
    initialized = true; parentOrigin = event.origin; channelId = data.channelId;
    void (async () => {
      const result = await call<{ credential: string; expiresAt: number }>('redeem', { bootstrap, parentOrigin, channelId }); bootstrap = '';
      if (typeof result.credential !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(result.credential) || !Number.isSafeInteger(result.expiresAt) || result.expiresAt <= Date.now()) { stop('error'); return; }
      credential = result.credential; expiresAt = result.expiresAt;
      expiry = view.setTimeout(() => stop('expired'), Math.max(0, expiresAt - Date.now()));
      await status(); if (terminal || destroyed) return;
      poll = view.setInterval(() => { void status().catch(() => {}); }, 20000);
      await connected(transport);
    })().catch(() => stop('error'));
  };
  const transport: EmbedTransport = {
    async request<T>(action: 'content' | 'question' | 'analysis' | 'save', body?: unknown): Promise<T> {
      if (!credential || Date.now() >= expiresAt || Date.now() >= deadline) { stop('revoked'); throw new Error('EMBED_UNAVAILABLE'); }
      return call<T>(action, body);
    },
    ready() { if (!terminal && !destroyed) { changed('ready'); emit('ready'); } },
    saved() { stop('saved'); },
    destroy() { destroyed = true; bootstrap = ''; credential = ''; stopTimers(); controllers.forEach(c => c.abort()); controllers.clear(); view.removeEventListener('message', message); view.document.removeEventListener('visibilitychange', visibility); },
  };
  view.addEventListener('message', message); view.document.addEventListener('visibilitychange', visibility);
  watchdog = view.setTimeout(() => stop('error'), 30000);
  return transport;
}
