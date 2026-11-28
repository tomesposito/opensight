import { isDataMessage, type EmbedDataEvent } from './events.js';
import { isSurfaceDeclaration, type SurfaceDeclaration } from './surface.js';
import { EmbeddingError } from './index.js';

export type FullAppLandingRoute = '/dashboards' | `/dashboards/${string}` | '/data' | '/analyses/author' | `/analyses/author/${string}` | '/data/preparation' | '/ask-o';
export type ExperienceConfiguration = { Dashboard: { InitialDashboardId: string } }
  | { DashboardVisual: { InitialDashboardVisualId: { DashboardId: string; SheetId: string; VisualId: string } } }
  | { QSearchBar: { InitialTopicId: string } } | { QuickSightConsole: { InitialPath?: string } }
  | { FullApp: { InitialPath: FullAppLandingRoute } };
export interface GenerateEmbedUrlForRegisteredUser {
  Surface?: SurfaceDeclaration; UserArn?: string; ExperienceConfiguration: ExperienceConfiguration; SessionLifetimeInMinutes?: number; AllowedDomains?: string[];
  SessionTags?: { Key: string; Value: string }[];
}
export interface GenerateEmbedUrlForAnonymousUser {
  Surface?: SurfaceDeclaration; Namespace: string; AuthorizedResourceArns: string[]; ExperienceConfiguration: Exclude<ExperienceConfiguration, { FullApp: unknown }>;
  SessionLifetimeInMinutes?: number; SessionTags?: { Key: string; Value: string }[]; AllowedDomains?: string[];
}
export interface SessionEmbedUrl { Surface?: SurfaceDeclaration; sessionId: string; EmbedUrl: string; bootstrapExpiresAt: string; SessionLifetimeInMinutes: number; configRevision: number }
export interface SessionCallbacks {
  onDataEvent?: (event: EmbedDataEvent) => void;
  onReady?: () => void; onSessionExpired?: () => void; onAuthorizationRevoked?: () => void;
  onConnectionRequired?: () => void;
  onSaved?: () => void; onError?: (error: EmbeddingError) => void;
}
export interface SessionMountOptions extends SessionCallbacks {
  surface?: SurfaceDeclaration;
}
export interface SessionEmbeddingOptions {
  /** Trusted application configuration, never inferred from a returned URL. */
  allowedEmbedOrigins: readonly string[];
  /** Calls your product backend. Broad API credentials do not belong in this SDK. */
  getEmbedUrl: (signal: AbortSignal, surface?: SurfaceDeclaration) => Promise<SessionEmbedUrl>;
  title?: string;
}
function exactOrigin(raw: string): string {
  let url: URL;
  try { url = new URL(raw); } catch { throw new EmbeddingError('INVALID_ORIGIN', 'Expected an exact HTTPS origin'); }
  if (url.origin !== raw || url.username || url.password || (!/^[a-z0-9.-]+$/i.test(url.hostname) && !/^\[[a-f0-9:]+\]$/i.test(url.hostname)) || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new EmbeddingError('INVALID_ORIGIN', 'Expected an exact HTTPS origin');
  return raw;
}
/** v2 transport is intentionally separate from the unchanged Phase 3c client. */
export function createSessionEmbeddingClient(options: SessionEmbeddingOptions) {
  if (!options.allowedEmbedOrigins.length || options.allowedEmbedOrigins.length > 64) throw new EmbeddingError('INVALID_ORIGIN', 'Configure trusted embed origins');
  const origins = options.allowedEmbedOrigins.map(exactOrigin);
  return {
    async mount(container: HTMLElement, callbacks: SessionMountOptions = {}) {
      if (callbacks.surface !== undefined && !isSurfaceDeclaration(callbacks.surface)) throw new EmbeddingError('EMBED_SURFACE_INVALID', 'Invalid embed surface');
      const surface = structuredClone(callbacks.surface);
      const view = container.ownerDocument.defaultView;
      if (!view) throw new EmbeddingError('PARENT_ORIGIN_MISMATCH', 'A browser window is required');
      const parentOrigin = exactOrigin(view.location.origin);
      if (origins.includes(parentOrigin)) throw new EmbeddingError('PARENT_ORIGIN_MISMATCH', 'The embed requires a separate origin');
      const iframe = container.ownerDocument.createElement('iframe');
      iframe.title = options.title ?? 'OpenSight embedded content'; iframe.referrerPolicy = 'no-referrer';
      iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
      iframe.style.width = '100%'; iframe.style.height = '100%'; iframe.style.border = '0';
      let destroyed = false, generation = 0, active: { id: string; origin: string; channelId: string } | undefined;
      let controller: AbortController | undefined, timer: ReturnType<typeof setTimeout> | undefined, handshakeTimer: ReturnType<typeof setInterval> | undefined;
      const clear = () => { if (timer !== undefined) clearTimeout(timer); if (handshakeTimer !== undefined) clearInterval(handshakeTimer); timer = undefined; handshakeTimer = undefined; };
      const failed = () => { clear(); callbacks.onError?.(new EmbeddingError('FRAME_LOAD_FAILED', 'Unable to load the hosted embed')); };
      const initialize = () => {
        if (!active || destroyed) return;
        iframe.contentWindow?.postMessage({ version: 2, type: 'opensight:initialize', sessionId: active.id, channelId: active.channelId }, active.origin);
      };
      const loaded = () => {
        if (handshakeTimer !== undefined) clearInterval(handshakeTimer);
        initialize();
        // React effects may attach after iframe load. Retry the same nonce until
        // the frame acknowledges; its one-shot receiver cannot redeem twice.
        handshakeTimer = setInterval(initialize, 250);
      };
      let ready = false, terminal = false;
      const message = (event: MessageEvent<unknown>) => {
        if (destroyed || !active || event.source !== iframe.contentWindow || event.origin !== active.origin || !event.data || typeof event.data !== 'object') return;
        if (isDataMessage(event.data, active.id, active.channelId)) {
          if (ready && !terminal) callbacks.onDataEvent?.(event.data.payload);
          return;
        }
        const data = event.data as Record<string, unknown>;
        if (Object.keys(data).some(k => !['version', 'type', 'event', 'sessionId', 'channelId', 'errorCode'].includes(k)) || data.version !== 2 || data.type !== 'opensight:session'
          || data.sessionId !== active.id || data.channelId !== active.channelId) return;
        if (data.event === 'ready' && !terminal) ready = true;
        if (data.event === 'connectionRequired') ready = false;
        if (['saved', 'error', 'sessionExpired', 'authorizationRevoked'].includes(String(data.event))) terminal = true;
        if (data.event === 'ready' && !terminal) { clear(); callbacks.onReady?.(); }
        else if (data.event === 'connectionRequired') { clear(); callbacks.onConnectionRequired?.(); }
        else if (data.event === 'sessionExpired') { clear(); callbacks.onSessionExpired?.(); }
        else if (data.event === 'authorizationRevoked') { clear(); callbacks.onAuthorizationRevoked?.(); }
        else if (data.event === 'saved') { clear(); callbacks.onSaved?.(); }
        else if (data.event === 'error') { clear(); callbacks.onError?.(new EmbeddingError('EMBED_UNAVAILABLE', 'The embedded content is unavailable')); }
      };
      const destroy = () => {
        if (destroyed) return;
        destroyed = true; active = undefined; generation++; controller?.abort(); clear();
        view.removeEventListener('message', message); iframe.removeEventListener('load', loaded); iframe.removeEventListener('error', failed); iframe.remove();
      };
      const refresh = async () => {
        if (destroyed) throw new EmbeddingError('EMBED_DESTROYED', 'The embed has been destroyed');
        ready = false; terminal = false;
        const current = ++generation; controller?.abort(); controller = new AbortController(); active = undefined; clear();
        const result = await options.getEmbedUrl(controller.signal, structuredClone(surface));
        if (destroyed || generation !== current) return;
        if (surface) {
          // An older host callback might ignore its second argument. Refuse to
          // display that session unless issuance acknowledged the requested states.
          const bound = result.Surface;
          if (!isSurfaceDeclaration(bound) || !Object.entries(surface).every(([group, entries]) =>
            Object.entries(entries).every(([key, state]) => {
              const received: Record<string, unknown> | undefined = bound[group as keyof SurfaceDeclaration];
              return received?.[key] === state;
            }))) throw new EmbeddingError('EMBED_SURFACE_MISMATCH', 'The issued session did not acknowledge the requested surface');
        }
        let url: URL;
        try { url = new URL(result.EmbedUrl); } catch { throw new EmbeddingError('INVALID_RESPONSE', 'Invalid session embed URL'); }
        if (!origins.includes(url.origin) || url.username || url.password || url.search || !/^[A-Za-z0-9_-]{32}$/.test(result.sessionId)
          || url.pathname !== `/embed/sessions/${result.sessionId}` || !/^#bootstrap=[A-Za-z0-9_-]{1,512}\.[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/.test(url.hash)
          || url.hash.split('.')[1] !== result.sessionId || !Number.isFinite(Date.parse(result.bootstrapExpiresAt)) || Date.parse(result.bootstrapExpiresAt) <= Date.now()) throw new EmbeddingError('INVALID_RESPONSE', 'Invalid session embed URL');
        const bytes = new Uint8Array(24); view.crypto.getRandomValues(bytes);
        active = { id: result.sessionId, origin: url.origin, channelId: [...bytes].map(b => b.toString(16).padStart(2, '0')).join('') };
        iframe.src = url.href;
        timer = setTimeout(() => { clear(); callbacks.onError?.(new EmbeddingError('FRAME_NOT_READY', 'The embedded session did not become ready')); }, 30000);
      };
      view.addEventListener('message', message); iframe.addEventListener('load', loaded); iframe.addEventListener('error', failed);
      try { await refresh(); container.appendChild(iframe); } catch (error) { destroy(); throw error; }
      return { iframe, refresh, destroy };
    },
  };
}
