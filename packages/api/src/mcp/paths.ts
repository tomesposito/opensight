export const mcpDiscoveryPaths = ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/api/mcp', '/.well-known/oauth-authorization-server'];
export const mcpOAuthPaths = ['/api/mcp/register', '/api/mcp/oauth/interaction', '/api/mcp/oauth/authorize', '/api/mcp/oauth/token', '/api/mcp/oauth/revoke', '/api/mcp/connections'];
export function isMcpPublicPath(path: string): boolean {
  return /^\/(?:api\/mcp(?:\/(?:register|connections|oauth\/(?:interaction|authorize|token|revoke)))?|\.well-known\/oauth-(?:authorization-server|protected-resource(?:\/api\/mcp)?))$/.test(path);
}
