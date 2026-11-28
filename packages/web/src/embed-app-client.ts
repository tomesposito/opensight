import type { EmbeddedAnalysisRecord } from './EmbeddedAnalysis.js';
import { createApiClient } from './api-client.js';
import type { EmbedTransport } from './embed-transport.js';
import type { Session } from './access.js';
import type { DraftStorage } from './local-drafts.js';

/** API-compatible adapter; only the transport closure ever sees the credential. */
export function embedAppClient(transport: EmbedTransport) {
  if (!transport.app) throw new Error('EMBED_SCOPE_DENIED');
  const app = transport.app;
  const api = createApiClient('/embed-app', async (input, init) => {
    if (typeof input !== 'string' || !input.startsWith('/embed-app/api/')) throw new Error('EMBED_SCOPE_DENIED');
    return app(input.slice('/embed-app'.length), init);
  });
  const checked = async (path: string, init?: RequestInit) => {
    const response = await app(path, init), body = await response.json() as { errorCode?: string };
    if (!response.ok) throw new Error(body.errorCode ?? 'EMBED_UNAVAILABLE');
    return body;
  };
  const values = new Map<string, string>();
  const storage: DraftStorage = () => ({ getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } });
  const saveHostedAnalysis: typeof api.saveHostedAnalysis = async (id, input, revision) => {
    const version = await api.saveHostedAnalysis(id, input, revision);
    transport.events?.emit({ type: 'save', analysisId: id, version });
    return version;
  };
  return { api: { ...api, saveHostedAnalysis }, storage, clear: () => values.clear(),
    session: () => checked('/session') as Promise<Session>,
    loadAnalysis: (id: string) => checked(`/analysis/${encodeURIComponent(id)}`) as Promise<EmbeddedAnalysisRecord>,
    authorizeRoute: async (path: string) => { await checked('/route', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) }); },
  };
}
