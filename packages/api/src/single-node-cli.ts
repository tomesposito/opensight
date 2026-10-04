// Pilot, single-node, no HA claims; ephemeral Blaze. Actual deployment requires separate authorization.
import { createBuiltinHostedServer, drainHostedServer } from './hosted-server.js';
import { referenceDisclosure, secretEnvironment } from './single-node-config.js';
import { ReferencePostgres, migrateReference } from './single-node.js';
import { ReferenceMaintenance } from './single-node-maintenance.js';
import { hostedConfig } from './hosted-config.js';
import { MetadataError } from './metadata-db.js';
import { hostedReadiness } from './hosted-health.js';
import { activateAuthKey } from './hosted-auth.js';

process.umask(0o077);
let reference: ReferencePostgres | undefined;
try {
  const env = await secretEnvironment(process.env), config = hostedConfig(env);
  reference = new ReferencePostgres(env);
  await reference.lock(() => { console.error('REFERENCE_LOCK_LOST'); process.exit(1); });
  const command = process.argv[2] ?? 'serve';
  if (process.argv.length > 3) throw new MetadataError('CLI_ARGUMENT_INVALID', 400);
  if (command === 'migrate') { await migrateReference(reference.operator, env); await reference.grantTenant(); }
  else if (command === 'rotate-auth-key') {
    if (env.OPENSIGHT_MAINTENANCE !== 'frozen') throw new MetadataError('REFERENCE_MAINTENANCE_REQUIRED', 503);
    await activateAuthKey(reference.operator, config);
  } else if (command === 'serve') {
    await hostedReadiness(reference.operator, reference.tenant);
    const server = await createBuiltinHostedServer({ membershipDatabase: reference.operator, tenantDatabase: reference.tenant, env });
    const port = env.PORT ?? '3000';
    if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new MetadataError('REFERENCE_CONFIG_INVALID', 503);
    server.once('close', () => { void reference?.close().catch(() => { console.error('REFERENCE_CLOSE_FAILED'); process.exitCode = 1; }); });
    server.on('error', () => { console.error('REFERENCE_LISTENER_FAILED'); process.exitCode = 1; void drainHostedServer(server); });
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
      void drainHostedServer(server).catch(() => { console.error('DRAIN_FAILED'); process.exitCode = 1; });
    });
    server.listen(Number(port), env.HOST ?? '127.0.0.1', () => console.log(referenceDisclosure));
  } else if (['backup', 'restore', 'delete-tenant', 'retain', 'restore-review'].includes(command)) {
    if (!env.OPENSIGHT_BACKUP_DIRECTORY) throw new MetadataError('BACKUP_DIRECTORY_REQUIRED', 503);
    const maintenance = await ReferenceMaintenance.open(reference.operator, env.OPENSIGHT_BACKUP_DIRECTORY, config.encryptionKey, env.OPENSIGHT_MAINTENANCE);
    if (command === 'backup') console.log(JSON.stringify(await maintenance.backup()));
    else if (command === 'restore') await maintenance.restore(env.OPENSIGHT_BACKUP_ID ?? '');
    else if (command === 'delete-tenant') await maintenance.deleteTenant(env.OPENSIGHT_DELETE_OPERATION ?? '', env.OPENSIGHT_BACKUP_COPIES);
    else if (command === 'restore-review') {
      let users: unknown; try { users = JSON.parse(env.OPENSIGHT_RESTORE_USERS ?? ''); } catch { throw new MetadataError('RESTORE_REVIEW_INVALID', 400); }
      if (!Array.isArray(users) || users.some(u => typeof u !== 'string')) throw new MetadataError('RESTORE_REVIEW_INVALID', 400);
      await maintenance.review(env.OPENSIGHT_RESTORE_TENANT ?? '', users as string[]);
    } else await maintenance.retain(reference.config.auditDays, reference.config.usageDays);
  } else throw new MetadataError('CLI_ARGUMENT_INVALID', 400);
  if (command !== 'serve') { await reference.close(); reference = undefined; console.log('REFERENCE_OPERATION_COMPLETE'); }
} catch (error) {
  await reference?.close().catch(() => {});
  console.error(error instanceof MetadataError ? error.code : 'REFERENCE_OPERATION_FAILED'); process.exitCode = 1;
}
