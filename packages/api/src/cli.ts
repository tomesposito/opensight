import { fileURLToPath } from 'node:url';
import { createApiServer } from './index.js';

try {
  const portText = process.env.PORT ?? '3000';
  if (!/^\d+$/u.test(portText) || Number(portText) > 65535) throw new Error('PORT must be an integer from 0 to 65535');
  const dataRoot = process.env.OPENSIGHT_DATA_ROOT ?? fileURLToPath(new URL('../../../fixtures/', import.meta.url));
  const server = await createApiServer({ dataRoot, automationStorePath: process.env.OPENSIGHT_AUTOMATION_STORE ?? '.opensight/automation.json' });
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
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
