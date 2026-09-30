import { MetadataError, type Database } from './metadata-db.js';

/** Operator/membership database only. Never grant tenant SQL roles access to h2_* tables. */
export async function initializeAuth(database: Database): Promise<void> {
  if (database.durable !== true) throw new MetadataError('DURABLE_MEMBERSHIP_STORE_REQUIRED', 503);
  await database.transaction(async c => {
    for (const sql of [
      `CREATE TABLE IF NOT EXISTS h2_control (id INTEGER PRIMARY KEY CHECK (id = 1))`,
      `INSERT INTO h2_control VALUES (1) ON CONFLICT (id) DO NOTHING`,
      `CREATE TABLE IF NOT EXISTS h2_identities (
        subject TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT, totp_secret TEXT,
        status TEXT NOT NULL CHECK (status IN ('invited','enrolling','active')), last_step BIGINT NOT NULL DEFAULT -1)`,
      `CREATE TABLE IF NOT EXISTS h2_memberships (
        subject TEXT NOT NULL REFERENCES h2_identities(subject), tenant_id TEXT NOT NULL, namespace_id TEXT NOT NULL, user_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('invited','active','removed')), version INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (subject, tenant_id), UNIQUE (tenant_id, namespace_id, user_id),
        FOREIGN KEY (tenant_id, namespace_id) REFERENCES h1_namespaces(tenant_id, namespace_id))`,
      `CREATE TABLE IF NOT EXISTS h2_invitations (
        invitation_id TEXT PRIMARY KEY, subject TEXT NOT NULL, tenant_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
        token_secret TEXT NOT NULL, expires_at BIGINT NOT NULL, accepted INTEGER NOT NULL DEFAULT 0, delivered INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (subject, tenant_id) REFERENCES h2_memberships(subject, tenant_id))`,
      `CREATE TABLE IF NOT EXISTS h2_keys (key_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, active INTEGER NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS h2_sessions (
        session_id TEXT PRIMARY KEY, subject TEXT NOT NULL, tenant_id TEXT NOT NULL, namespace_id TEXT NOT NULL, user_id TEXT NOT NULL,
        issuer TEXT NOT NULL, audience TEXT NOT NULL, origin TEXT NOT NULL, expires_at BIGINT NOT NULL,
        key_id TEXT NOT NULL REFERENCES h2_keys(key_id), membership_version INTEGER NOT NULL,
        authorization_revision INTEGER NOT NULL, policy_revision INTEGER NOT NULL, configuration_revision INTEGER NOT NULL,
        revoked INTEGER NOT NULL DEFAULT 0, FOREIGN KEY (subject, tenant_id) REFERENCES h2_memberships(subject, tenant_id))`,
      `CREATE TABLE IF NOT EXISTS h2_attempts (bucket TEXT PRIMARY KEY, window_start BIGINT NOT NULL, attempts INTEGER NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS h2_onboarding (operation_id TEXT PRIMARY KEY, request_hash TEXT NOT NULL, tenant_id TEXT NOT NULL,
        invitation_id TEXT NOT NULL REFERENCES h2_invitations(invitation_id))`
    ]) await c.query(sql);
  });
}
