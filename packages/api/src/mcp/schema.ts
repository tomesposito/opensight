import type { SqlConnection } from '../metadata-db.js';
export const mcpTables = ['h2_mcp_clients', 'h2_mcp_interactions', 'h2_mcp_grants', 'h2_mcp_tokens'] as const;
export async function initializeMcp(c: SqlConnection): Promise<void> {
  for (const sql of [
    `CREATE TABLE IF NOT EXISTS h2_mcp_clients (client_id TEXT PRIMARY KEY, name TEXT NOT NULL, redirects TEXT NOT NULL, scopes TEXT NOT NULL, created_at BIGINT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS h2_mcp_interactions (interaction_id TEXT PRIMARY KEY, session_hash TEXT NOT NULL, params TEXT NOT NULL, expires_at BIGINT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS h2_mcp_grants (grant_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, subject TEXT NOT NULL,
      client_id TEXT NOT NULL REFERENCES h2_mcp_clients(client_id), binding TEXT NOT NULL, scopes TEXT NOT NULL,
      created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (subject, tenant_id) REFERENCES h2_memberships(subject, tenant_id))`,
    `CREATE TABLE IF NOT EXISTS h2_mcp_tokens (token_hash TEXT PRIMARY KEY, tenant_id TEXT NOT NULL,
      grant_id TEXT NOT NULL REFERENCES h2_mcp_grants(grant_id) ON DELETE CASCADE, kind TEXT NOT NULL CHECK (kind IN ('code','access','refresh')),
      data TEXT NOT NULL, expires_at BIGINT NOT NULL, consumed INTEGER NOT NULL DEFAULT 0)`,
    `CREATE INDEX IF NOT EXISTS h2_mcp_tokens_grant ON h2_mcp_tokens(grant_id)`,
    `CREATE INDEX IF NOT EXISTS h2_mcp_grants_member ON h2_mcp_grants(tenant_id, subject)`
  ]) await c.query(sql);
}
