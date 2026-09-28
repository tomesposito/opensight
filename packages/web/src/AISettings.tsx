import { useEffect, useState } from 'react';
import { allowed, useAccess } from './access.js';
import type { AIConfig, createApiClient } from './api-client.js';

type Client = Pick<ReturnType<typeof createApiClient>, 'getAIConfig' | 'saveAIConfig' | 'saveAIKey' | 'testAIConnection'>;
export function AISettings({ client }: { client: Client }) {
  const access = useAccess();
  if (access.mode !== 'hosted' || !allowed(access, 'admin')) return <p role="alert">SECURITY_ADMIN_REQUIRED: Hosted administrator access required.</p>;
  return <SettingsForm client={client} />;
}
function SettingsForm({ client }: { client: Client }) {
  const [config, setConfig] = useState<AIConfig>();
  const [provider, setProvider] = useState<AIConfig['provider']>('openai');
  const [model, setModel] = useState(''), [baseUrl, setBaseUrl] = useState(''), [key, setKey] = useState('');
  const [message, setMessage] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void client.getAIConfig().then(value => { if (active) { setConfig(value); setProvider(value.provider ?? 'openai'); setModel(value.model); setBaseUrl(value.baseUrl ?? value.compatibleBaseUrls[0] ?? ''); } }).catch(e => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, [client]);
  const run = async (action: () => Promise<AIConfig | void>, success: string) => {
    setBusy(true); setError(''); setMessage('');
    try { const result = await action(); if (result) setConfig(result); setMessage(success); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); setKey(''); }
  };
  const dirty = provider !== config?.provider || model !== config?.model || provider === 'openai-compatible' && baseUrl !== config?.baseUrl;
  return <section className="admin-settings" aria-labelledby="ai-settings-title">
    <h1 id="ai-settings-title">AI provider settings</h1>
    <p>Configure O generative answers and AI Build for me for this namespace.</p>
    {!config && !error && <p role="status">Loading settings…</p>}
    <form onSubmit={e => { e.preventDefault(); void run(() => client.saveAIConfig({ provider, model, ...(provider === 'openai-compatible' ? { baseUrl } : {}) }), 'Provider and model saved.'); }}>
      <label>AI provider<select aria-label="AI provider" value={provider ?? 'openai'} onChange={e => { setProvider(e.target.value as AIConfig['provider']); setKey(''); }} disabled={busy}>
        <option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="openai-compatible">OpenAI-compatible</option><option value="bedrock">Amazon Bedrock — needs approval</option>
      </select></label>
      <label>Model ID<input required maxLength={256} value={model} onChange={e => setModel(e.target.value)} disabled={busy} /></label>
      {provider === 'openai-compatible' && <label>Server-approved endpoint<select aria-label="Server-approved endpoint" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} disabled={busy} required><option value="">Choose endpoint</option>{config?.compatibleBaseUrls.map(url => <option key={url}>{url}</option>)}</select></label>}
      {provider === 'bedrock' && <p role="status">AI_BEDROCK_APPROVAL_REQUIRED: Bedrock needs explicit approval. Live AWS calls are disabled.</p>}
      <button type="submit" disabled={busy || !config}>Save provider and model</button>
    </form>
    {config && <>
      <p role="status">{config.state} · API key {config.hasKey ? 'stored (hidden)' : 'not configured'} · {config.keyStorage === 'ephemeral' ? 'Settings reset on server restart' : 'Encrypted server storage'}</p>
      <form onSubmit={e => { e.preventDefault(); const value = key; setKey(''); void run(() => client.saveAIKey(value), 'API key saved on the server.'); }}>
        <label>Replace API key<input type="password" autoComplete="new-password" value={key} maxLength={4096} onChange={e => setKey(e.target.value)} disabled={busy || !config.canSaveKey || dirty || provider === 'bedrock'} /></label>
        <button type="submit" disabled={busy || !key || !config.canSaveKey || dirty || provider === 'bedrock'}>Save API key</button>
      </form>
      {!config.canSaveKey && <p>Key entry needs secure storage configured on the hosted server. An administrator can also configure the key through server environment variables.</p>}
      {dirty && <p>Save provider and model before replacing the key or testing the connection.</p>}
      <button type="button" disabled={busy || dirty || !config.configured} onClick={() => void run(async () => { await client.testAIConnection(); }, 'Connection succeeded.')}>Test connection</button>
    </>}
    {busy && <p role="status">Working…</p>}{message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
