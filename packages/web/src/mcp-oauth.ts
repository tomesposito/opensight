export const mcpRead = 'opensight/mcp.read', mcpWrite = 'opensight/mcp.write';
export interface McpInteraction { id: string; clientName: string; workspaceName: string; redirectUri: string; scopes: string[] }
export interface McpConnection { id: string; clientName: string; scopes: string[]; createdAt: number; expiresAt: number; revoked: boolean }
export type McpAuthorization = { params: Record<string, string> } | { error: string };
export function mcpAuthorization(search: string): McpAuthorization | undefined {
  const params = new URLSearchParams(search);
  if (!params.has('mcp_oauth')) return;
  const allowed = ['mcp_oauth', 'client_id', 'redirect_uri', 'response_type', 'state', 'scope', 'resource', 'code_challenge', 'code_challenge_method'];
  if (search.length > 8192 || params.get('mcp_oauth') !== '1' || [...params.keys()].some(k => !allowed.includes(k) || params.getAll(k).length !== 1)) return { error: 'This connection request is invalid. Start again from your connector.' };
  params.delete('mcp_oauth'); return { params: Object.fromEntries(params) };
}
/** Redirect only to the registered destination shown by the server at consent. */
export function consentRedirect(value: string, registered: string): string {
  const url = new URL(value), expected = new URL(registered);
  if (url.origin !== expected.origin || url.pathname !== expected.pathname || url.hash || url.username || url.password
    || !(url.protocol === 'https:' || url.protocol === 'http:' && url.port && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw new Error('Invalid connector response.');
  return url.href;
}
