import { migrationCommands, referenceMigration } from './reference-migration.js';
import { readFile } from 'node:fs/promises';
import { assertReferenceSchema } from './reference-schema.js';
import { captureBackup, writeBackup, readBackup, restoreBackup, reconcileRestore } from './hosted-recovery.js';
import { secretKey } from './hosted-config.js';
import { object, identifier } from './metadata-resources.js';
import { rotateEncryptionKey } from './hosted-key-rotation.js';
import { hostedConfig } from './hosted-config.js';
import { activateAuthKey } from './hosted-auth.js';
import { initializeEvents, auditWriter } from './hosted-events.js';
import { createBuiltinHostedServer, drainHostedServer } from './hosted-server.js';
import { referenceDatabase } from './reference-postgres.js';
import { MetadataError } from './metadata-db.js';
import type { Server } from 'node:http';

let server: Server | undefined;
let database: Awaited<ReturnType<typeof referenceDatabase>> | undefined;
let stopping = false;
async function stop(): Promise<void> {
  if (stopping) return; stopping = true;
  const deadline = setTimeout(() => { console.error('REFERENCE_SHUTDOWN_TIMEOUT'); process.exit(1); }, 30000);
  if (server) {
    const draining = drainHostedServer(server); server.close();
    try { await draining; } catch { console.error('DRAIN_DEADLINE_EXCEEDED'); process.exit(1); }
    server.closeAllConnections();
  }
  await database?.close(); clearTimeout(deadline);
}
try {
  process.umask(0o077);
  const command = process.argv[2] ?? 'serve';
  if (!['serve', 'initialize', 'rotate-encryption', 'rotate-auth-key', 'backup', 'restore', 'reconcile-restore', ...migrationCommands].includes(command) || process.argv.length > 3) throw new MetadataError('REFERENCE_COMMAND_INVALID');
  database = await referenceDatabase(process.env, () => { void stop(); });
  if (command === 'initialize') { await database.initialize(); await database.close(); }
  else if (command !== 'serve') {
    if (process.env.OPENSIGHT_MAINTENANCE !== 'frozen') throw new MetadataError('REFERENCE_MAINTENANCE_REQUIRED');
    await initializeEvents(database.membershipDatabase);
    if (migrationCommands.includes(command)) await referenceMigration(database.membershipDatabase, database.tenantDatabase, process.env, command);
    else if (['backup', 'restore'].includes(command)) {
      const path = process.env.OPENSIGHT_BACKUP_PATH, key = process.env.OPENSIGHT_BACKUP_KEY;
      if (!path || !key || secretKey(key).equals(secretKey(process.env.OPENSIGHT_AUTH_ENCRYPTION_KEY))) throw new MetadataError('BACKUP_CONFIG_INVALID');
      if (command === 'backup') await writeBackup(path, await captureBackup(database.membershipDatabase, process.env.OPENSIGHT_AUTH_ENCRYPTION_KEY!, 'frozen'), key);
      else await restoreBackup(database.membershipDatabase, await readBackup(path, key), process.env.OPENSIGHT_AUTH_ENCRYPTION_KEY!, 'frozen', process.env.OPENSIGHT_RESTORE_TENANT_ID);
    } else if (command === 'reconcile-restore') {
      const raw = object(JSON.parse(await readFile(process.env.OPENSIGHT_RECONCILIATION_CONFIG!, 'utf8')), ['tenantId', 'expectedVersion', 'removedUsers']);
      if (!Array.isArray(raw.removedUsers)) throw new MetadataError('RESTORE_RECONCILIATION_INVALID');
      await reconcileRestore(database.membershipDatabase, identifier(raw.tenantId), raw.expectedVersion as number, raw.removedUsers.map(identifier), 'frozen');
    } else if (command === 'rotate-encryption') await rotateEncryptionKey(database.membershipDatabase, process.env.OPENSIGHT_AUTH_ENCRYPTION_KEY!, process.env.OPENSIGHT_NEXT_ENCRYPTION_KEY!, 'frozen');
    else { await activateAuthKey(database.membershipDatabase, hostedConfig()); await auditWriter(database.membershipDatabase)({ operation: 'key.rotate', outcome: 'succeeded' }); }
    await database.close();
  }
  else {
    await assertReferenceSchema(database.membershipDatabase);
    server = await createBuiltinHostedServer({ ...database, roleProbe: database.probe });
    server.listen(3000, '0.0.0.0');
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void stop(); });
    server.on('error', () => { console.error('REFERENCE_SERVER_FAILED'); void stop(); });
  }
} catch (error) {
  console.error(error instanceof MetadataError ? error.code : 'REFERENCE_START_FAILED');
  await database?.close(); process.exitCode = 1;
}
