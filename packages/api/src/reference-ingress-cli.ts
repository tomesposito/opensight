import { referenceIngress } from './reference-ingress.js';
try {
  const server = await referenceIngress(); server.listen(8443, '0.0.0.0');
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { server.close(); server.closeAllConnections(); });
} catch { console.error('INGRESS_START_FAILED'); process.exitCode = 1; }
