import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { OperatorSignups } from '../build/test/OperatorSignups.js';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
test('197 Signups panel shows counts, cap, queued copy, retention entry and audited toggle route', async t => {
  let ui; const calls = [];
  const status = { enabled: false, paused: false, volumeCap: 25, trialsToday: 10, trialsLast24h: 25, convertedToday: 2, expiredToday: 1, queued: 3, pausedAtCap: true, retentionDue: [{ tenantId: 'tenant-one', displayName: 'Example', retentionDueAt: '2026-10-01T00:00:00Z' }] };
  await act(() => { ui = create(createElement(OperatorSignups, { fetcher: async (path, init) => { calls.push({ path, ...init }); if (init.method === 'PATCH') status.paused = JSON.parse(init.body).paused; return { ok: true, json: async () => ({ ...status }) }; } })); });
  t.after(() => act(() => ui.unmount()));
  await act(() => ui.root.findByType('input').props.onChange({ target: { value: 'synthetic-key' } }));
  await act(() => ui.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.match(JSON.stringify(ui.toJSON()), /routes return 404/); assert.match(JSON.stringify(ui.toJSON()), /verified signups remain queued/);
  assert.ok(ui.root.findAllByType('a').some(a => a.props.href === '#operator-tenant/tenant-one'));
  await act(() => ui.root.findAllByType('button').find(b => b.children.join('') === 'Pause signups').props.onClick());
  assert.equal(calls.at(-1).method, 'PATCH'); assert.deepEqual(JSON.parse(calls.at(-1).body), { paused: true }); assert.match(JSON.stringify(ui.toJSON()), /Resume signups/);
});
