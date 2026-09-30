import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { SqliteMetadataDatabase } from '../dist/metadata-db.js';
import { initializeMetadata } from '../dist/metadata-schema.js';
import { initializeAuth } from '../dist/auth-schema.js';
import { hostedConfig } from '../dist/hosted-config.js';

export function environment() {
  return { OPENSIGHT_PUBLIC_ORIGIN: 'https://opensight.example', OPENSIGHT_AUTH_ISSUER: 'opensight-test', OPENSIGHT_AUTH_AUDIENCE: 'opensight-api',
    OPENSIGHT_AUTH_KEY_ID: 'test-key', OPENSIGHT_AUTH_SIGNING_KEY: randomBytes(32).toString('base64'),
    OPENSIGHT_AUTH_ENCRYPTION_KEY: randomBytes(32).toString('base64'), OPENSIGHT_OPERATOR_KEY: randomBytes(32).toString('base64'),
    OPENSIGHT_SESSION_SECONDS: '900', OPENSIGHT_INVITATION_SECONDS: '86400' };
}
export async function database(t) {
  const directory = await mkdtemp(join(tmpdir(), 'opensight-h2-')), path = join(directory, 'metadata.sqlite');
  const db = new SqliteMetadataDatabase(path);
  t.after(async () => { await db.close(); await rm(directory, { recursive: true, force: true }); });
  await initializeMetadata(db); await initializeAuth(db);
  return { db, path, config: hostedConfig(environment()) };
}
