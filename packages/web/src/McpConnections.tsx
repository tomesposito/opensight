import { useEffect, useState } from 'react';
import { useAccess } from './access.js';
import type { createApiClient } from './api-client.js';
import { mcpRead, type McpConnection } from './mcp-oauth.js';

type Client = Pick<ReturnType<typeof createApiClient>, 'mcpConnections' | 'revokeMcpConnection'>;
export function McpConnections({ client }: { client: Client }) {
  const access = useAccess(), [connections, setConnections] = useState<McpConnection[]>();
  const [error, setError] = useState(''), [busy, setBusy] = useState<string>(), [status, setStatus] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (access.mode !== 'hosted') return;
    const controller = new AbortController(); let active = true;
    setConnections(undefined); setError(''); setStatus('');
    void client.mcpConnections(controller.signal).then(value => { if (active) setConnections(value.connections); })
      .catch(() => { if (active) setError('Connections could not be loaded. Try again.'); });
    return () => { active = false; controller.abort(); };
  }, [client, access.mode, access.session?.id, access.session?.tenantId, attempt]);
  async function revoke(connection: McpConnection) {
    if (busy) return;
    setBusy(connection.id); setError(''); setStatus('');
    try {
      await client.revokeMcpConnection(connection.id);
      setConnections(rows => rows?.map(row => row.id === connection.id ? { ...row, revoked: true } : row));
      setStatus(`Access revoked for ${connection.clientName}.`);
    } catch { setError('Access could not be revoked. Try again.'); }
    finally { setBusy(undefined); }
  }
  return <section className="mcp-connections" aria-labelledby="mcp-connections-title"><h1 id="mcp-connections-title">MCP connections</h1>
    {access.mode !== 'hosted' ? <p role="status">Needs hosted API · Sign in to manage your connected apps.</p> : <>
      <p>Apps connected as you in {access.session?.workspaceName ?? 'this workspace'}. Revoking a connection immediately ends its access.</p>
      {!connections && !error && <p role="status">Loading connections…</p>}
      {error && <p role="alert">{error} {!connections && <button type="button" onClick={() => setAttempt(n => n + 1)}>Try again</button>}</p>}
      {status && <p role="status">{status}</p>}
      {connections?.length === 0 && <p className="mcp-empty">No connected apps yet. Add your workspace’s <code>/api/mcp</code> address in your MCP host, then sign in and choose access.</p>}
      {!!connections?.length && <div className="mcp-table-scroll"><table><caption>Your connections in this workspace</caption><thead><tr><th>App</th><th>Access</th><th>Connected</th><th>Status</th><th>Action</th></tr></thead><tbody>{connections.map(connection => {
        const expired = connection.expiresAt <= Date.now();
        return <tr key={connection.id}><th scope="row">{connection.clientName}</th><td>{connection.scopes.map(s => s === mcpRead ? 'Read and query' : 'Create and change').join(', ')}</td><td>{new Date(connection.createdAt).toLocaleDateString()}</td><td>{connection.revoked ? 'Revoked' : expired ? 'Expired' : 'Active'}</td><td><button type="button" aria-label={`Revoke access for ${connection.clientName}`} disabled={!!busy || connection.revoked || expired} onClick={() => void revoke(connection)}>{busy === connection.id ? 'Revoking…' : 'Revoke'}</button></td></tr>;
      })}</tbody></table></div>}
    </>}
  </section>;
}
