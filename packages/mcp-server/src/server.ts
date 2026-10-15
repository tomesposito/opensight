import type { JsonSchemaType } from '@modelcontextprotocol/sdk/validation/types.js';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, ErrorCode, McpError, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { apiVersion, operations } from './generated.js';
import type { Credentials } from './types.js';

export const serverVersion = '1.0.0';
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const assertion = /^(?:authorization|credential[s]?|(?:access|refresh)[_-]?token|token|principals?|principal[_-]?id|subject|user|user[_-]?id|tenant|tenant[_-]?id|namespace|namespace[_-]?id|owner[_-]?id|groups?|group[_-]?ids?|roles?|policy|policies|security|capabilities|issuer|audience|x[-_](?:user|tenant|namespace|principal|role|groups|subject|capabilities)(?:[-_]id)?)$/i;
function hasAssertions(value: unknown, schema: unknown): boolean {
  const shape = record(schema) ? schema : {};
  if (Array.isArray(value)) return value.some(item => hasAssertions(item, shape.items));
  if (!record(value)) return false;
  const alternatives = Array.isArray(shape.oneOf) ? shape.oneOf : Array.isArray(shape.anyOf) ? shape.anyOf : [];
  const properties = Object.assign({}, record(shape.properties) ? shape.properties : {},
    ...alternatives.map(option => record(option) && record(option.properties) ? option.properties : {})) as Record<string, unknown>;
  const dictionary = record(shape.additionalProperties);
  return Object.entries(value).some(([key, entry]) => {
    const declared = Object.hasOwn(properties, key);
    // Parameter/control/binding map keys are data, not caller identity fields.
    if (!declared && !dictionary && assertion.test(key)) return true;
    return hasAssertions(entry, declared ? properties[key] : dictionary ? shape.additionalProperties : undefined);
  });
}
const protocolError = () => new McpError(ErrorCode.InternalError, 'OpenSight HTTP transport failed');
function failure(errorCode: string, message: string): CallToolResult {
  const structuredContent = { errorCode, message };
  return { isError: true, structuredContent, content: [{ type: 'text', text: JSON.stringify(structuredContent) }] };
}

export interface ServerOptions {
  /** Full v1 base URL, ending in /api/v1. */
  baseUrl: string;
  credentials: Credentials;
  fetch?: typeof fetch;
}
export function apiBase(value: string): URL {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname.replace(/\/+$/, '') !== '/api/v1'
    || !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('OPENSIGHT_MCP_BASE_URL must be an HTTPS /api/v1 URL (HTTP allowed on loopback)');
  }
  url.pathname = '/api/v1/'; return url;
}

/** Only HTTP crosses this package boundary; authorization and data validation belong to v1. */
export function createMcpServer(options: ServerOptions): Server {
  const base = apiBase(options.baseUrl), fetchImpl = options.fetch ?? fetch;
  const schemaValidator = new CfWorkerJsonSchemaValidator();
  const queryValidators = new Map(operations.filter(op => op.bodyInput === 'query').map(op =>
    [op.name, schemaValidator.getValidator(op.tool.inputSchema.properties!.query as JsonSchemaType)]));
  const server = new Server({ name: 'opensight-v1', version: serverVersion, title: `OpenSight API v${apiVersion}` },
    { jsonSchemaValidator: schemaValidator, capabilities: { tools: {} }, instructions: `Tools map exactly to OpenSight HTTP API ${apiVersion}. One configured user and tenant. Response headers are in _meta.headers.` });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: operations.map(op => op.tool) }));
  server.setRequestHandler(CallToolRequestSchema, async request => {
    const op = operations.find(candidate => candidate.name === request.params.name);
    if (!op) throw new McpError(ErrorCode.InvalidParams, 'Unknown tool');
    const args = request.params.arguments ?? {};
    if (!record(args)) throw new McpError(ErrorCode.InvalidParams, 'Expected tool arguments object');
    const properties = op.tool.inputSchema.properties ?? {};
    // Only documented target principals are accepted. Arbitrary caller assertions cannot become headers.
    if (hasAssertions(args, op.tool.inputSchema)) {
      return failure('FORGED_PRINCIPAL', 'Caller credentials, principal and policy assertions are forbidden');
    }
    if (Object.keys(args).some(key => !Object.hasOwn(properties, key))) return failure('HOSTED_REQUEST_INVALID', 'Unknown tool argument');
    const validQuery = queryValidators.get(op.name)?.(args.query).valid ?? true;
    const headers = new Headers({ Accept: 'application/json' });
    let path = op.path;
    for (const parameter of op.parameters) {
      const value = args[parameter.input];
      if (parameter.location === 'path') {
        const schema = properties[parameter.input] as { type?: string; pattern?: string; enum?: unknown[] };
        if (!(typeof value === 'string' && value.length > 0 || typeof value === 'number' && Number.isSafeInteger(value) && value > 0)
          || schema.type === 'string' && typeof value !== 'string'
          || schema.type === 'integer' && typeof value !== 'number'
          || schema.pattern && !new RegExp(schema.pattern).test(String(value))
          || schema.enum && !schema.enum.includes(value)
          || ['.', '..'].includes(String(value))) return failure('HOSTED_REQUEST_INVALID', 'Invalid path argument');
        path = path.replace(`{${parameter.name}}`, encodeURIComponent(String(value)));
      } else if (value !== undefined) {
        if (!['string', 'number'].includes(typeof value) || /[\r\n\x00]/.test(String(value))) return failure('HOSTED_REQUEST_INVALID', 'Invalid header argument');
        headers.set(parameter.name, String(value));
      }
    }
    // Body is forwarded intact, including invalid bodies: REST supplies the operation's exact named validation error.
    // This is essential for FORGED_PRINCIPAL and engine errors, which JSON Schema alone cannot classify.
    let body: string | undefined;
    if (op.emptyBody) body = '{}';
    else if (op.bodyInput && args[op.bodyInput] !== undefined) body = JSON.stringify(args[op.bodyInput]);
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    let token: string;
    try { token = await options.credentials.accessToken(); }
    catch (error) {
      if (error instanceof McpError) throw error;
      return failure('AUTHENTICATION_FAILED', 'Credential exchange failed');
    }
    let response: Response, bytes: Uint8Array;
    try {
      headers.set('Authorization', `Bearer ${token}`);
      response = await fetchImpl(new URL(path.slice(1), base), { method: op.method, headers, body, redirect: 'error', signal: AbortSignal.timeout(120_000) });
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch { throw protocolError(); }
    if (response.status === 401) options.credentials.invalidate();
    const text = new TextDecoder().decode(bytes);
    const metadata: Record<string, string> = {};
    for (const name of ['ETag', 'Idempotent-Replayed', 'Retry-After', 'Content-Disposition', 'Content-Type']) {
      const value = response.headers.get(name); if (value !== null) metadata[name] = value;
    }
    if (text.includes(token) || options.credentials.containsSecret(text) || JSON.stringify(metadata).includes(token) || options.credentials.containsSecret(JSON.stringify(metadata))) throw protocolError();
    const _meta = { status: response.status, headers: metadata };
    if (response.ok && !validQuery) return failure('HOSTED_REQUEST_INVALID', 'Query does not match the OpenAPI schema');
    if (response.headers.get('content-type')?.includes('application/json')) {
      let data: unknown;
      try { data = JSON.parse(text); } catch { throw protocolError(); }
      if (!record(data)) throw protocolError();
      if (!response.ok) {
        if (typeof data.errorCode !== 'string' || !data.errorCode) throw protocolError();
        if (typeof data.message !== 'string') data.message = data.errorCode;
      }
      const serialized = JSON.stringify(data);
      if (serialized.includes(token) || options.credentials.containsSecret(serialized)) throw protocolError();
      return { ...(response.ok ? {} : { isError: true }), structuredContent: data, content: [{ type: 'text', text: serialized }], _meta };
    }
    if (!response.ok) throw protocolError();
    const data = { base64: Buffer.from(bytes).toString('base64'), mimeType: response.headers.get('content-type') ?? 'application/octet-stream' };
    return { structuredContent: data, content: [{ type: 'text', text: JSON.stringify(data) }], _meta };
  });
  return server;
}
