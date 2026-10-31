import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { mkdtemp, cp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApiServer } from '../dist/index.js';
import { authFixture } from './hosted-helpers.mjs';
import { serving } from './v1-helpers.mjs';
import { TenantMetadata } from '../dist/metadata.js';
import { upload } from './source-helpers.mjs';
const at = v => ({ 'If-Match': `"${v}"` });
const input = (id, name = id) => ({ analysisId: id, name, definition: { dataSetIdentifierDeclarations: [], sheets: [], calculatedFields: [], filterGroups: [], opaque: { KeepCase: ['unchanged'] } }, datasetBindings: {} });
function good(r, status = 200) { assert.equal(r.status, status, JSON.stringify(r.body)); return r; }
function error(r, status, code) { assert.equal(r.status, status, JSON.stringify(r.body)); assert.equal(r.body.errorCode, code); }
export async function metricLocal(t, authenticated = true) {
  const directory = await mkdtemp(join(tmpdir(), 'opensight-assets-')), root = join(directory, 'data'), securityPath = join(directory, 'security.json');
  await cp(resolve('../../fixtures/renderable-sales'), root, { recursive: true });
  const users = ['admin','author','peer','reader'].map(id => ({ id, namespaceId: 'default', name: id, role: id === 'admin' ? 'administrator' : id === 'reader' ? 'reader' : 'author' }));
  const security = { storePath: securityPath, authenticate: async req => ({ namespaceId: 'default', userId: String(req.headers.authorization ?? 'Bearer author').slice(7) }), initialState: { version: 1, namespaces: [{ id: 'default', name: 'Default' }], users, groups: [{ namespaceId: 'default', id: 'team', name: 'Team', userIds: ['author','peer'] }], datasets: [], folders: [
    { namespaceId: 'default', id: 'shared', name: 'Shared' },
    { namespaceId: 'default', id: 'private', name: 'Private', grants: [{ principal: { type: 'user', id: 'admin' }, role: 'co-owner' }] },
    { namespaceId: 'default', id: 'view-only', name: 'View', grants: [{ principal: { type: 'user', id: 'author' }, role: 'viewer' }] },
  ] } };
  let server;
  const close = async () => { if (server?.listening) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); };
  const start = async () => { server = await createApiServer({ dataRoot: root, prepStorePath: join(directory, 'prep.json'), ...(authenticated ? { security } : {}) }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); };
  await start(); t.after(async () => { await close(); await rm(directory, { recursive: true, force: true }); });
  const request = (path, { method = 'GET', body, headers = {}, user = 'author' } = {}) => new Promise((resolve, reject) => {
    const bytes = body === undefined ? undefined : JSON.stringify(body);
    const req = httpRequest({ host: '127.0.0.1', port: server.address().port, path, method, headers: { ...(authenticated ? { Authorization: `Bearer ${user}` } : {}), ...(bytes ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bytes) } : {}), ...headers } }, res => {
      const chunks = []; res.on('data', b => chunks.push(b)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(Buffer.concat(chunks).toString()) }));
    }); req.on('error', reject); req.end(bytes);
  });
  return { request, restart: async () => { await close(); await start(); }, state: async () => JSON.parse(await readFile(securityPath, 'utf8')) };
}
export async function metricHosted(t, env = {}) {
  const f = await authFixture(t), call = await serving(t, f, env), metadata = new TenantMetadata(f.db, f.db);
  let token = (await f.login()).token;
  const identity = await f.auth.verify(token), context = () => metadata.authenticate(null, async () => identity);
  const request = (p,o = {}) => call(p, { token, ...o }), renew = async () => { token = (await f.login()).token; };
  return { ...f, request, metadata, context, identity, renew, restart: async () => {} };
}
