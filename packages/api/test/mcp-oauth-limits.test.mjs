import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mcpFixture, allScopes, readScope } from './mcp-helpers.mjs';
import { serving } from './v1-helpers.mjs';

const refresh = (f, g, overrides = {}) => f.form('/api/mcp/oauth/token', { grant_type: 'refresh_token', client_id: g.client.client_id, refresh_token: g.refresh_token, ...overrides });
const revoke = (f, g, token = g.refresh_token) => f.form('/api/mcp/oauth/revoke', { client_id: g.client.client_id, token });
const attempts = f => f.db.transaction(c => c.query('SELECT * FROM h2_attempts ORDER BY bucket'));
const limited = result => {
  assert.equal(result.status, 429, JSON.stringify(result.body));
  assert.equal(result.body.error, 'temporarily_unavailable'); assert.equal(result.headers['retry-after'], '900');
};

test('independent connections on one public client and IP exchange, refresh and revoke without consuming login budgets', async t => {
  const f = await mcpFixture(t), before = await attempts(f), client = await f.register(), grants = [];
  for (let i = 0; i < 12; i++) grants.push(await f.grant(allScopes, undefined, client));
  for (const g of grants) {
    const next = await refresh(f, g); assert.equal(next.status, 200, JSON.stringify(next.body));
    assert.equal((await revoke(f, g, next.body.refresh_token)).status, 200);
    assert.equal((await f.rpc(next.body.access_token, 'tools/list')).status, 401);
  }
  const after = await attempts(f);
  for (const row of before) assert.deepEqual(after.find(r => r.bucket === row.bucket), row);
  // The interactive principal still gets its full independent allowance.
  for (let i = 0; i < 10; i++) await f.auth.limit('interactive-independent', '127.0.0.1');
});

test('connection limits persist across rotation and restart, recover after the window, and do not block revocation', async t => {
  const f = await mcpFixture(t), g = await f.grant(); let current = g;
  for (let i = 0; i < 9; i++) {
    const next = await refresh(f, current); assert.equal(next.status, 200); current = { ...g, ...next.body };
  }
  const http = await serving(t, f, {}, { clock: f.clock });
  const restarted = { form: (path, body) => http(path, { method: 'POST', rawBody: new URLSearchParams(body).toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }) };
  limited(await refresh(restarted, current));
  const other = await f.grant(); assert.equal((await refresh(f, other)).status, 200);
  assert.equal((await revoke(f, other)).status, 200);
  f.advance(900001);
  const next = await refresh(restarted, current); assert.equal(next.status, 200);
  assert.equal((await revoke(f, current, next.body.refresh_token)).status, 200);
  assert.equal((await f.rpc(next.body.access_token, 'tools/list')).status, 401);
});

test('replay revokes the family even when the connection token budget is exhausted', async t => {
  const f = await mcpFixture(t), g = await f.grant(); let current = g;
  for (let i = 0; i < 9; i++) {
    const next = await refresh(f, current, { scope: readScope }); assert.equal(next.status, 200); current = { ...g, ...next.body };
  }
  limited(await refresh(f, g, { scope: allScopes }));
  assert.equal((await f.rpc(current.access_token, 'tools/list')).status, 401);
  assert.equal((await refresh(f, current)).body.error, 'invalid_grant');
});

test('unknown credentials and forged client IDs are throttled separately from valid connections and revoke', async t => {
  const f = await mcpFixture(t), g = await f.grant();
  for (let i = 0; i < 50; i++) {
    const bad = await refresh(f, g, { client_id: `invented_${i}`, refresh_token: randomBytes(32).toString('base64url') });
    assert.equal(bad.status, 400);
  }
  limited(await refresh(f, g, { refresh_token: 'unknown' }));
  // Possession and client binding, rather than an attacker-selected ID or IP, select the valid budget.
  const next = await refresh(f, g); assert.equal(next.status, 200);
  for (let i = 0; i < 50; i++) assert.equal((await revoke(f, g, `unknown_${i}`)).status, 200);
  limited(await revoke(f, g, 'unknown_over_limit'));
  assert.equal((await revoke(f, g, next.body.refresh_token)).status, 200);
  assert.equal((await f.rpc(next.body.access_token, 'tools/list')).status, 401);
});

test('bad scope attempts count against the bound connection without consuming its refresh token', async t => {
  const f = await mcpFixture(t), g = await f.grant(readScope);
  for (let i = 0; i < 9; i++) assert.equal((await refresh(f, g, { scope: allScopes })).body.error, 'invalid_scope');
  limited(await refresh(f, g));
  assert.equal((await f.rpc(g.access_token, 'tools/list')).status, 200);
  // A saturated token budget must not prevent the member from revoking this connection.
  assert.equal((await revoke(f, g)).status, 200);
  assert.equal((await f.rpc(g.access_token, 'tools/list')).status, 401);
});
