import { once } from 'node:events';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApiServer, StubMailTransport } from '@opensight/api';
export const interval = { kind: 'interval', minutes: 1, timeZone: 'UTC' };
export async function dashboardRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'opensight-automation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(new URL('../../../fixtures/renderable-sales/', import.meta.url), root, { recursive: true });
  const analysis = JSON.parse(await readFile(join(root, 'analysis.json'), 'utf8'));
  const dashboard = { DashboardId: 'sales-dashboard', Name: 'Sales <report>', Definition: analysis.Definition };
  await writeFile(join(root, 'dashboard.json'), JSON.stringify(dashboard));
  return root;
}
export async function startApi(t, options = {}) {
  const mail = options.mailTransport ?? new StubMailTransport();
  const server = await createApiServer({ dataRoot: options.dataRoot ?? await dashboardRoot(t), ...options, mailTransport: mail });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.close(); server.closeAllConnections(); });
  const request = async (path, method = 'GET', body) => fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  return { mail, request };
}
