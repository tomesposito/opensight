import { createRuntime, runtimeMode } from './runtime.js';
import { MetadataError } from './metadata-db.js';

try {
  if (runtimeMode(process.env) !== 'http') throw new MetadataError('HTTP_MODE_REQUIRED', 503);
  const port = process.env.PORT ?? '3000';
  if (!/^\d+$/.test(port) || Number(port) > 65535) throw new MetadataError('RUNTIME_CONFIG_INVALID', 503);
  const server = createRuntime().http();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => server.close());
  server.on('error', () => { console.error('RUNTIME_LISTENER_FAILED'); process.exitCode = 1; });
  server.listen(Number(port), process.env.HOST ?? '127.0.0.1');
} catch (error) { console.error(error instanceof MetadataError ? error.code : 'RUNTIME_START_FAILED'); process.exitCode = 1; }
