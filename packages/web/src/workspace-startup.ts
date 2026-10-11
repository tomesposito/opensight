/** Credential-free startup is the only automatically retried POST. */
export class StartupError extends Error {
  constructor(readonly errorCode: string) {
    super(errorCode === 'WORKSPACE_MAINTENANCE' ? 'This workspace is being updated. Try connecting again later.'
      : errorCode === 'WORKSPACE_CONNECT_CANCELLED' ? 'Connection cancelled.'
      : errorCode === 'WORKSPACE_STARTUP_TIMEOUT' || errorCode === 'WORKSPACE_START_RATE_LIMITED' ? 'The workspace is still starting or busy. Choose Connect to try again.'
      : 'The workspace could not be reached. Choose Connect to try again.');
    this.name = 'StartupError';
  }
}
type View = Pick<Window, 'setTimeout' | 'clearTimeout' | 'document'> & Partial<Pick<Window, 'addEventListener' | 'removeEventListener'>>;
function cancelled(signal: AbortSignal): Error { return signal.reason instanceof StartupError ? signal.reason : new StartupError('WORKSPACE_CONNECT_CANCELLED'); }
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void work.catch(() => {}); return Promise.reject(cancelled(signal)); }
  return new Promise((resolve, reject) => {
    const aborted = () => { signal.removeEventListener('abort', aborted); reject(cancelled(signal)); };
    signal.addEventListener('abort', aborted, { once: true });
    work.then(value => { signal.removeEventListener('abort', aborted); resolve(value); }, error => { signal.removeEventListener('abort', aborted); reject(error); });
  });
}
export function createWorkspaceStartup(fetcher: typeof fetch = fetch, view: View = window, random: () => number = Math.random) {
  let flight: Promise<void> | undefined, current: AbortController | undefined;
  const connect = (signal?: AbortSignal): Promise<void> => {
    if (signal?.aborted || view.document.visibilityState === 'hidden') return Promise.reject(new StartupError('WORKSPACE_CONNECT_CANCELLED'));
    if (flight) return flight;
    const controller = new AbortController(); current = controller;
    const started = Date.now(), deadline = started + 120000;
    const abort = () => controller.abort(new StartupError('WORKSPACE_CONNECT_CANCELLED'));
    const hidden = () => { if (view.document.visibilityState === 'hidden') abort(); };
    const lifetime = view.setTimeout(() => controller.abort(new StartupError('WORKSPACE_STARTUP_TIMEOUT')), 120000);
    signal?.addEventListener('abort', abort, { once: true }); view.document.addEventListener('visibilitychange', hidden);
    view.addEventListener?.('pagehide', abort); view.document.addEventListener('freeze', abort);
    const wait = (ms: number) => new Promise<void>((resolve, reject) => {
      if (controller.signal.aborted) { reject(cancelled(controller.signal)); return; }
      const stop = () => { view.clearTimeout(timer); controller.signal.removeEventListener('abort', stop); reject(cancelled(controller.signal)); };
      const timer = view.setTimeout(() => { controller.signal.removeEventListener('abort', stop); resolve(); }, ms);
      controller.signal.addEventListener('abort', stop, { once: true });
    });
    flight = (async () => {
      for (let attempt = 0; attempt < 6; attempt++) {
        if (controller.signal.aborted) throw cancelled(controller.signal);
        if (Date.now() < started || Date.now() >= deadline) throw new StartupError('WORKSPACE_STARTUP_TIMEOUT');
        const request = new AbortController(), stop = () => request.abort(controller.signal.reason);
        controller.signal.addEventListener('abort', stop, { once: true });
        const timeout = view.setTimeout(() => request.abort(new StartupError('WORKSPACE_STARTUP_TIMEOUT')), Math.min(25000, deadline - Date.now()));
        let response: Response, body: unknown;
        try {
          ({ response, body } = await abortable((async () => {
            const response = await fetcher('/api/api/startup', { method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: request.signal,
              headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: '{}' });
            const text = await response.text();
            let body: unknown;
            if (text.length <= 4096) { try { body = JSON.parse(text) as unknown; } catch { /* Gateway rate limits need not contain JSON. */ } }
            return { response, body };
          })(), request.signal));
        } catch (error) { throw error instanceof StartupError ? error : new StartupError('WORKSPACE_UNAVAILABLE'); }
        finally { view.clearTimeout(timeout); controller.signal.removeEventListener('abort', stop); }
        if (controller.signal.aborted) throw cancelled(controller.signal);
        if (Date.now() < started || Date.now() >= deadline) throw new StartupError('WORKSPACE_STARTUP_TIMEOUT');
        const value = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
        if (response.status === 200 && value.state === 'ready' && Object.keys(value).length === 1) return;
        if (response.status !== 429 && !(response.status === 503 && value.errorCode === 'WORKSPACE_STARTING')) {
          throw new StartupError(value.errorCode === 'WORKSPACE_MAINTENANCE' ? 'WORKSPACE_MAINTENANCE' : 'WORKSPACE_UNAVAILABLE');
        }
        if (attempt === 5) throw new StartupError(response.status === 429 ? 'WORKSPACE_START_RATE_LIMITED' : 'WORKSPACE_STARTUP_TIMEOUT');
        const retry = response.headers.get('retry-after') ?? '', parsed = /^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now();
        const jitter = [5000, 10000, 20000, 30000, 30000][attempt]! * (0.5 + Math.max(0, Math.min(1, random())) * 0.5);
        const delay = Math.ceil(Math.max(jitter, Number.isFinite(parsed) && parsed > 0 ? parsed : 0));
        if (delay >= deadline - Date.now()) throw new StartupError('WORKSPACE_STARTUP_TIMEOUT');
        await wait(delay);
      }
    })().finally(() => {
      view.clearTimeout(lifetime); signal?.removeEventListener('abort', abort); view.document.removeEventListener('visibilitychange', hidden);
      view.removeEventListener?.('pagehide', abort); view.document.removeEventListener('freeze', abort);
      if (current === controller) { current = undefined; flight = undefined; }
    });
    return flight;
  };
  return { connect, cancel: () => current?.abort(new StartupError('WORKSPACE_CONNECT_CANCELLED')) };
}
