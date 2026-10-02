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
  if (server) { server.close(); await drainHostedServer(server); server.closeAllConnections(); }
  await database?.close(); clearTimeout(deadline);
}
try {
  process.umask(0o077);
  const command = process.argv[2] ?? 'serve';
  if (!['serve', 'initialize'].includes(command) || process.argv.length > 3) throw new MetadataError('REFERENCE_COMMAND_INVALID');
  database = await referenceDatabase(process.env, () => { void stop(); });
  if (command === 'initialize') { await database.initialize(); await database.close(); }
  else {
    server = await createBuiltinHostedServer({ ...database });
    server.listen(3000, '0.0.0.0');
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void stop(); });
    server.on('error', () => { console.error('REFERENCE_SERVER_FAILED'); void stop(); });
  }
} catch (error) {
  console.error(error instanceof MetadataError ? error.code : 'REFERENCE_START_FAILED');
  await database?.close(); process.exitCode = 1;
}
