#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './server.js';
import { refreshCredentials } from './auth.js';

try {
  const credentials = refreshCredentials({ tokenUrl: process.env.OPENSIGHT_MCP_TOKEN_URL ?? '', refreshToken: process.env.OPENSIGHT_MCP_REFRESH_TOKEN ?? '' });
  const server = createMcpServer({ baseUrl: process.env.OPENSIGHT_MCP_BASE_URL ?? '', credentials });
  await credentials.accessToken();
  await server.connect(new StdioServerTransport());
} catch {
  // Stdio stdout is protocol-only; no exception objects, URLs, credentials or result data in diagnostics.
  process.stderr.write('OpenSight MCP startup failed; check API and refresh-exchange configuration.\n');
  process.exitCode = 1;
}
