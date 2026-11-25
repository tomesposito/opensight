import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptGatewayRequest, validateViewerRequest, publicPath } from '../dist/runtime-ingress.js';
import { mcpDiscoveryPaths, mcpOAuthPaths, isMcpPublicPath } from '../dist/mcp/paths.js';
import { runtimeEnv, event } from './runtime-helpers.mjs';
test('MCP discovery, token/consent and canonical HTTP routes survive hosted gateway without widening neighbors', () => {
  for (const path of [...mcpDiscoveryPaths, ...mcpOAuthPaths, '/api/mcp']) {
    assert.equal(isMcpPublicPath(path), true); assert.equal(publicPath(path), path);
    const method = path.startsWith('/.well-known') || path.endsWith('/connections') ? 'GET' : 'POST';
    const e = event(path, method); e.headers['mcp-protocol-version'] = '2025-11-25';
    const result = adaptGatewayRequest(e, runtimeEnv()); assert.equal(result.path, path); assert.equal(result.headers['mcp-protocol-version'], '2025-11-25');
    validateViewerRequest({ protocol: 'https', uri: path, querystring: {}, headers: { host: { value: 'opensight.example' } } }, 'https://opensight.example');
  }
  assert.equal(publicPath('/api/api/mcp/oauth/authorize'), '/api/mcp/oauth/authorize');
  for (const path of ['/api/mcp/unknown', '/.well-known/unknown', '/.well-known/oauth-authorization-server/evil']) assert.throws(() => publicPath(path));
  const duplicated = event('/api/mcp', 'POST'); duplicated.headers['mcp-protocol-version'] = '2025-11-25,2025-03-26'; assert.throws(() => adaptGatewayRequest(duplicated, runtimeEnv()));
});
