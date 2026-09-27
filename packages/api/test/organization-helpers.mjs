import { once } from 'node:events';
import { createApiServer, emptySecurityState, StubMailTransport } from '@opensight/api';
import { dashboardRoot } from './automation-helpers.mjs';
export function registry() {
  const state = emptySecurityState();
  state.namespaces.push({ id: 'tenant', name: 'Tenant' });
  state.users = ['default', 'tenant'].flatMap(namespaceId => ['admin', 'alice', 'bob'].map(id => ({ id, namespaceId, name: id, role: id === 'admin' ? 'admin' : 'reader' })));
  state.groups = ['default', 'tenant'].map(namespaceId => ({ id: 'team', namespaceId, name: 'Team', userIds: ['alice'] }));
  return state;
}
export async function organizationApi(t, options = {}) {
  const dataRoot = options.dataRoot ?? await dashboardRoot(t);
  const server = await createApiServer({ dataRoot, mailTransport: new StubMailTransport(), ...options,
    security: { initialState: registry(), authenticate: r => {
      const match = /^Bearer test-(default|tenant)-(admin|alice|bob)$/.exec(r.headers.authorization ?? '');
      return match ? { namespaceId: match[1], userId: match[2] } : undefined;
    }, ...options.security } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.close(); server.closeAllConnections(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const api = async (path, method = 'GET', body, user = 'default-admin', headers = {}) => {
    const response = await fetch(`${origin}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer test-${user}` } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, headers: response.headers, body: await response.json() };
  };
  return { api, origin, dataRoot };
}
export const viewer = { principal: { type: 'user', id: 'alice' }, role: 'viewer' };
export const groupViewer = { principal: { type: 'group', id: 'team' }, role: 'viewer' };
