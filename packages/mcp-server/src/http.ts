import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createMcpServer, type ServerOptions } from './server.js';
import { operations } from './generated.js';

export const mcpScopes = ['opensight/mcp.read', 'opensight/mcp.write'] as const;
// POST query/ask are reads: their existing v1 compute/spend guards still apply.
const read = (op: typeof operations[number]) => op.method === 'GET' || ['run_dataset_query', 'ask_question'].includes(op.name);
export function scopedTools(scopes: readonly string[]): ReadonlySet<string> {
  return new Set(operations.filter(op => scopes.includes(read(op) ? mcpScopes[0] : mcpScopes[1])).map(op => op.name));
}
/** Also fence direct v1 requests made with an OAuth token; no non-tool routes. */
export function mcpRouteAllowed(method: string, path: string, scopes: readonly string[]): boolean {
  const allowed = scopedTools(scopes);
  return operations.some(op => allowed.has(op.name) && op.method === method
    && new RegExp(`^/api/v1${op.path.replace(/\{[^}]+\}/g, '[A-Za-z0-9_-]+')}$`).test(path));
}

/** Stateless Streamable HTTP with JSON responses works on both Node and invocation runtimes. */
export async function handleMcpHttp(request: Request, options: ServerOptions & { scopes: readonly string[] }): Promise<Response> {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });
  try {
    if (Array.isArray(await request.clone().json())) return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Batch requests are not supported' } }, { status: 400 });
  } catch { /* The transport returns the standard parse error. */ }
  const server = createMcpServer({ ...options, allowedTools: scopedTools(options.scopes) });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    // Consume before close: the SDK completes its response stream asynchronously.
    return new Response(await response.arrayBuffer(), { status: response.status, headers: response.headers });
  } finally { await server.close(); }
}
