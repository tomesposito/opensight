import { fileURLToPath } from 'node:url';
import { createApiServer } from './index.js';
import { createBuiltinHostedServer } from './hosted-server.js';
import { SqliteMetadataDatabase } from './metadata-db.js';
import { initializeMetadata } from './metadata-schema.js';
import { initializeAuth } from './auth-schema.js';
import { hostedConfig } from './hosted-config.js';
import { activateAuthKey } from './hosted-auth.js';
import { mkdir, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';

let database: SqliteMetadataDatabase | undefined;
try {
  const portText = process.env.PORT ?? '3000';
  if (!/^\d+$/u.test(portText) || Number(portText) > 65535) throw new Error('PORT must be an integer from 0 to 65535');
  const mode = process.env.OPENSIGHT_MODE ?? 'fixture';
  const hostedSettings = ['OPENSIGHT_PUBLIC_ORIGIN', 'OPENSIGHT_OPERATOR_KEY', 'OPENSIGHT_SESSION_SECONDS', 'OPENSIGHT_INVITATION_SECONDS', 'OPENSIGHT_METADATA_DATABASE'];
  if (!['fixture', 'hosted'].includes(mode) || mode !== 'hosted' && Object.keys(process.env).some(k => k.startsWith('OPENSIGHT_AUTH_') || hostedSettings.includes(k))) throw new Error('HOSTED_MODE_REQUIRED');
  if (process.argv.length > 2 && (mode !== 'hosted' || process.argv.length !== 3 || process.argv[2] !== 'rotate-auth-key')) throw new Error('CLI_ARGUMENT_INVALID');
  const server = await (async () => {
    if (mode === 'hosted') {
      const config = hostedConfig(), path = process.env.OPENSIGHT_METADATA_DATABASE;
      if (!path || path === ':memory:') throw new Error('DURABLE_MEMBERSHIP_STORE_REQUIRED');
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      process.umask(0o077);
      database = new SqliteMetadataDatabase(path);
      await chmod(path, 0o600);
      await initializeMetadata(database); await initializeAuth(database);
      if (process.argv[2] === 'rotate-auth-key') {
        await activateAuthKey(database, config); await database.close();
        console.log('AUTH_KEY_ACTIVATED'); return undefined;
      }
      return createBuiltinHostedServer({ membershipDatabase: database, tenantDatabase: database });
    }
    const dataRoot = process.env.OPENSIGHT_DATA_ROOT ?? fileURLToPath(new URL('../../../fixtures/', import.meta.url));
    return createApiServer({ dataRoot, prepStorePath: process.env.OPENSIGHT_PREP_STORE ?? '.opensight/prep.json', automationStorePath: process.env.OPENSIGHT_AUTOMATION_STORE ?? '.opensight/automation.json' });
  })();
  if (server) {
    server.once('close', () => { void database?.close(); });
    server.on('error', error => {
      console.error(error.message);
      process.exitCode = 1;
    });
    server.listen(Number(portText), process.env.HOST ?? '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address !== 'string') console.log(`OpenSight API listening on http://${address.address}:${address.port}`);
    });
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.once(signal, () => {
        server.close();
        server.closeAllConnections();
      });
    }
  }
} catch (error) {
  await database?.close();
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
