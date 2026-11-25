import { useEffect, useState } from 'react';
import { useAccess } from './access.js';
import type { createApiClient } from './api-client.js';
import { BrandMark } from './BrandMark.js';
import { consentRedirect, mcpRead, mcpWrite, type McpAuthorization, type McpInteraction } from './mcp-oauth.js';

type Client = Pick<ReturnType<typeof createApiClient>, 'mcpInteraction' | 'mcpAuthorize'>;
export function McpConsent({ client, authorization, redirect = value => window.location.assign(value) }: { client: Client; authorization: McpAuthorization; redirect?: (url: string) => void }) {
  const access = useAccess();
  const [interaction, setInteraction] = useState<McpInteraction>(), [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    if (access.mode !== 'hosted' || !('params' in authorization)) return;
    const controller = new AbortController(); let active = true;
    setInteraction(undefined); setError('');
    void client.mcpInteraction(authorization.params, controller.signal).then(value => {
      if (active) { setInteraction(value); setSelected(value.scopes); }
    }).catch(() => { if (active) setError('This connection request is invalid or has expired. Start again from your connector.'); });
    return () => { active = false; controller.abort(); };
  }, [client, authorization, access.mode, access.session?.id, access.session?.tenantId]);
  async function decide(action: 'approve' | 'deny') {
    if (!interaction || busy) return;
    setBusy(true); setError('');
    try {
      const result = await client.mcpAuthorize(interaction.id, action, selected.join(' '));
      redirect(consentRedirect(result.redirect, interaction.redirectUri));
    } catch { setError('The connection could not be completed. Start again from your connector.'); setBusy(false); }
  }
  return <main className="mcp-consent-page"><section className="mcp-consent-card" aria-labelledby="mcp-title">
    <BrandMark size={32} /><h1 id="mcp-title">Connect to OpenSight</h1>
    {access.mode !== 'hosted' ? <p role="status">Connections need a hosted API. Sign in to your OpenSight workspace from your connector.</p>
      : 'error' in authorization ? <p role="alert">{authorization.error}</p> : <>
        {!interaction && !error && <p role="status">Checking connection request…</p>}
        {interaction && <>
          <p><strong>{interaction.clientName}</strong> wants to connect to <strong>{interaction.workspaceName}</strong>.</p>
          <p>Connecting as {access.session?.name}. This app can only use your existing workspace permissions.</p>
          <p className="mcp-redirect">Return to: {new URL(interaction.redirectUri).host}</p>
          <fieldset disabled={busy}><legend>Choose access</legend>{interaction.scopes.map(scope => <label key={scope} className="mcp-scope"><input type="checkbox" checked={selected.includes(scope)} onChange={event => setSelected(current => event.target.checked ? [...current, scope] : current.filter(s => s !== scope))} />
            <span><strong>{scope === mcpRead ? 'Read and query' : 'Create and change'}</strong><span>{scope === mcpWrite ? 'Create, update and delete content that your role permits.' : 'Read permitted content, run queries and ask questions. Compute and AI usage limits apply.'}</span></span></label>)}</fieldset>
          <p>You can revoke this connection in Account → MCP connections.</p>
          <div className="mcp-buttons"><button type="button" disabled={busy} onClick={() => void decide('deny')}>Deny</button><button type="button" className="primary" disabled={busy || selected.length === 0} onClick={() => void decide('approve')}>{busy ? 'Completing…' : 'Approve connection'}</button></div>
        </>}
        {error && <p role="alert">{error}</p>}
      </>}
  </section></main>;
}
