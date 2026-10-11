import type { EmbedShell, EmbedTransport, SessionState } from './embed-transport.js';
import { createWorkspaceStartup } from './workspace-startup.js';
import { assembleResult } from './object-transfers.js';

/** A display lease is local and finite; no timer makes a network request. */
export function startOnDemandEmbed(shell: EmbedShell, initialBootstrap: string, changed: (state: SessionState) => void,
  connected: (transport: EmbedTransport) => Promise<void>, view: Window, fetcher: typeof fetch): EmbedTransport {
  let bootstrap = initialBootstrap, credential = '', parentOrigin = '', channelId = '';
  let initialized = false, destroyed = false, terminal = false, redeeming = false, redeemed = false;
  let expiresAt = 0, lease = 0, leaseStart = 0, generation = 0, state: SessionState = 'loading';
  let leaseTimer: number | undefined, expiryTimer: number | undefined, frame: number | undefined;
  let flight: Promise<void> | undefined, connectController: AbortController | undefined;
  const controllers = new Set<AbortController>(), startup = createWorkspaceStartup(fetcher, view);
  const emit = (event: string) => {
    if (initialized && !destroyed) view.parent.postMessage({ version: 2, type: 'opensight:session', event, sessionId: shell.sessionId, channelId }, parentOrigin);
  };
  const stopLease = () => { view.clearTimeout(leaseTimer); if (frame !== undefined) view.cancelAnimationFrame(frame); frame = undefined; lease = 0; };
  const cancel = () => { generation++; stopLease(); connectController?.abort(); startup.cancel(); controllers.forEach(c => c.abort()); controllers.clear(); };
  const finish = (next: 'expired' | 'revoked' | 'saved' | 'error') => {
    if (terminal || destroyed) return;
    terminal = true; cancel(); view.clearTimeout(expiryTimer); view.clearTimeout(handshakeTimer); bootstrap = ''; credential = '';
    state = next; changed(next); emit(next === 'expired' ? 'sessionExpired' : next === 'revoked' ? 'authorizationRevoked' : next === 'saved' ? 'saved' : 'error');
  };
  const hide = (next: 'idle' | 'unavailable' = 'idle') => {
    if (terminal || destroyed) return;
    if (redeeming) { finish('error'); return; } // A consumed bootstrap cannot be retried safely.
    if (credential && Date.now() >= expiresAt) { finish('expired'); return; }
    cancel(); state = next; changed(next); emit('connectionRequired');
  };
  const valid = () => {
    if (destroyed || terminal || !credential) return false;
    if (Date.now() >= expiresAt) { finish('expired'); return false; }
    if (view.document.visibilityState === 'hidden' || Date.now() < leaseStart || Date.now() >= lease) { hide(); return false; }
    return true;
  };
  const guard = () => { frame = undefined; if (state === 'ready' && valid()) frame = view.requestAnimationFrame(guard); };
  const renew = (started: number) => {
    leaseStart = started; lease = Math.min(started + 45000, expiresAt);
    view.clearTimeout(leaseTimer);
    if (!valid()) throw new Error('EMBED_UNAVAILABLE');
    leaseTimer = view.setTimeout(() => { if (valid()) renew(leaseStart); }, Math.max(0, lease - Date.now()));
  };
  const failure = (code: unknown, status: number) => {
    if (code === 'EMBED_SESSION_EXPIRED' || code === 'EMBED_BOOTSTRAP_EXPIRED') finish('expired');
    else if (['EMBED_SESSION_REVOKED', 'EMBED_KEY_REVOKED', 'AUTHORIZATION_REVISED', 'TENANT_UNAVAILABLE', 'EMBED_SUBJECT_UNRESOLVED'].includes(String(code))) finish('revoked');
    else if (redeeming || status === 401 || status === 403) finish('error');
    else hide('unavailable');
  };
  const call = async <T>(action: string, body?: unknown): Promise<T> => {
    if (destroyed || terminal) throw new Error('EMBED_UNAVAILABLE');
    const current = generation, started = Date.now(), controller = new AbortController(); controllers.add(controller);
    const timeout = view.setTimeout(() => controller.abort(), 8000);
    const aborted = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('EMBED_UNAVAILABLE')), { once: true }));
    try {
      const result = await Promise.race([aborted, (async () => {
        const route = action.startsWith('/api/operations/') ? `/api${action}` : `/api/embed/sessions/${shell.sessionId}/${action}`;
        const response = await fetcher(route, { method: body === undefined ? 'GET' : 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal,
          headers: { ...(credential ? { Authorization: `Embed ${credential}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        const value: unknown = await response.json().catch(() => undefined);
        if (current !== generation || destroyed || terminal || controller.signal.aborted) throw new Error('EMBED_UNAVAILABLE');
        if (!response.ok) { failure(value && typeof value === 'object' && 'errorCode' in value ? value.errorCode : undefined, response.status); throw new Error('EMBED_UNAVAILABLE'); }
        if (action !== 'redeem') renew(started);
        if (response.status === 202) {
          if (!Number.isSafeInteger(shell.resultMaxBytes) || shell.resultMaxBytes! < 1 || shell.resultMaxBytes! > 2147483647) throw new Error('EMBED_UNAVAILABLE');
          return await assembleResult(value, shell.resultMaxBytes!, path => call(path), () => { if (current !== generation || !valid()) throw new Error('EMBED_UNAVAILABLE'); });
        }
        return value;
      })()]);
      if (current !== generation || destroyed || terminal || controller.signal.aborted || (action !== 'redeem' && !valid())) throw new Error('EMBED_UNAVAILABLE');
      return result as T;
    } catch {
      if (current === generation && !destroyed && !terminal) { if (redeeming) finish('error'); else hide('unavailable'); }
      throw new Error('EMBED_UNAVAILABLE');
    } finally { view.clearTimeout(timeout); controllers.delete(controller); }
  };
  const connect = (): Promise<void> => {
    if (flight) return flight;
    if (!initialized || terminal || destroyed || view.document.visibilityState === 'hidden') return Promise.reject(new Error('EMBED_UNAVAILABLE'));
    const current = ++generation, controller = new AbortController(); connectController = controller;
    state = 'connecting'; changed(state);
    flight = (async () => {
      await startup.connect(controller.signal);
      if (current !== generation || destroyed || terminal || controller.signal.aborted) return;
      if (!credential) {
        if (redeemed) { finish('error'); return; }
        redeemed = true; redeeming = true;
        const value = bootstrap; bootstrap = '';
        const result = await call<{ credential: string; expiresAt: number }>('redeem', { bootstrap: value, parentOrigin, channelId });
        redeeming = false;
        if (!result || typeof result.credential !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(result.credential) || !Number.isSafeInteger(result.expiresAt) || result.expiresAt <= Date.now()) { finish('error'); return; }
        credential = result.credential; expiresAt = result.expiresAt;
        expiryTimer = view.setTimeout(() => finish('expired'), Math.max(0, expiresAt - Date.now()));
      }
      const status = await call<{ expiresAt: number }>('status');
      if (!status || status.expiresAt !== expiresAt) { finish('expired'); return; }
      if (current === generation && valid()) await connected(transport);
    })().catch(() => { if (current === generation && !terminal && !destroyed) hide('unavailable'); }).finally(() => {
      if (connectController === controller) connectController = undefined;
      flight = undefined;
    });
    return flight;
  };
  const message = (event: MessageEvent<unknown>) => {
    if (initialized || terminal || destroyed || view.parent === view || event.source !== view.parent || !shell.allowedDomains.includes(event.origin) || event.origin === view.location.origin || !event.data || typeof event.data !== 'object') return;
    const data = event.data as Record<string, unknown>;
    if (Object.keys(data).some(k => !['version', 'type', 'sessionId', 'channelId'].includes(k)) || data.version !== 2 || data.type !== 'opensight:initialize' || data.sessionId !== shell.sessionId || typeof data.channelId !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(data.channelId)) return;
    initialized = true; parentOrigin = event.origin; channelId = data.channelId; view.clearTimeout(handshakeTimer); hide();
  };
  const background = () => hide();
  const visibility = () => { if (view.document.visibilityState === 'hidden') hide(); else if (credential) valid(); };
  const resumed = () => { if (credential) valid(); };
  const input = (event: Event) => { if (state === 'ready' && !valid()) { event.preventDefault(); event.stopImmediatePropagation(); } };
  const transport: EmbedTransport = {
    connect,
    async request<T>(action: 'content' | 'question' | 'analysis' | 'save', body?: unknown) { if (!valid()) throw new Error('EMBED_UNAVAILABLE'); return call<T>(action, body); },
    ready() { if (valid()) { state = 'ready'; changed(state); emit('ready'); if (frame === undefined) frame = view.requestAnimationFrame(guard); } },
    saved() { if (valid()) finish('saved'); },
    destroy() {
      destroyed = true; cancel(); bootstrap = ''; credential = ''; view.clearTimeout(expiryTimer); view.clearTimeout(handshakeTimer);
      view.removeEventListener('message', message); view.removeEventListener('pagehide', background); view.removeEventListener('pageshow', resumed); view.removeEventListener('focus', resumed);
      view.document.removeEventListener('visibilitychange', visibility); view.document.removeEventListener('freeze', background);
      for (const event of ['pointerdown', 'keydown', 'input', 'click']) view.document.removeEventListener(event, input, true);
    },
  };
  view.addEventListener('message', message); view.addEventListener('pagehide', background); view.addEventListener('pageshow', resumed); view.addEventListener('focus', resumed);
  view.document.addEventListener('visibilitychange', visibility); view.document.addEventListener('freeze', background);
  for (const event of ['pointerdown', 'keydown', 'input', 'click']) view.document.addEventListener(event, input, true);
  const handshakeTimer = view.setTimeout(() => finish('error'), 30000);
  return transport;
}
