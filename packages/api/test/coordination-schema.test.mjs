import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateCoordination, coordinationTables } from '../dist/coordination-schema.js';
import { coordinationFixture } from './coordination-helpers.mjs';

test('SR2a migration requires frozen maintenance and preserves control, keys and repeated configuration', async t => {
  const f = await coordinationFixture(t, { migrate: false });
  await assert.rejects(migrateCoordination(f.db, 'test', f.entitlements, 'open', 'sqlite'), { code: 'WORKSPACE_MAINTENANCE_REQUIRED' });
  const before = await f.db.transaction(c => c.query('SELECT * FROM sr_control'));
  await migrateCoordination(f.db, 'test', f.entitlements, 'frozen', 'sqlite');
  await migrateCoordination(f.db, 'test', f.entitlements, 'frozen', 'sqlite');
  assert.deepEqual(await f.db.transaction(c => c.query('SELECT * FROM sr_control')), before);
  assert.deepEqual(await f.db.transaction(c => c.query('SELECT * FROM h2_keys')), []);
  assert.equal((await f.db.transaction(c => c.query('SELECT * FROM sr_limits'))).length, 1);
  await f.open();
  await assert.rejects(migrateCoordination(f.db, 'test', f.entitlements, 'frozen', 'sqlite'), { code: 'WORKSPACE_MAINTENANCE_REQUIRED' });
});

test('SR2a migration refuses foreign tables, altered marker and changed configuration without resetting state', async t => {
  for (const fault of ['foreign', 'marker', 'budgets', 'entitlements']) {
    const f = await coordinationFixture(t, { migrate: fault !== 'foreign' });
    if (fault === 'foreign') await f.db.transaction(c => c.query('CREATE TABLE sr_claim (foreign_value TEXT)'));
    if (fault === 'marker') await f.db.transaction(c => c.query("UPDATE sr_coordination_schema SET checksum = 'foreign'"));
    if (fault === 'budgets') await f.db.transaction(c => c.query('UPDATE h4_budget_config SET version = version + 1'));
    const configured = structuredClone(f.entitlements);
    if (fault === 'entitlements') configured.defaults.computeAttempts++;
    await assert.rejects(migrateCoordination(f.db, 'test', configured, 'frozen', 'sqlite'), {
      code: ['foreign', 'marker'].includes(fault) ? 'COORDINATION_FOREIGN_SCHEMA' : 'COORDINATION_CONFIG_CHANGED',
    });
    assert.equal((await f.db.transaction(c => c.query('SELECT state FROM sr_control')))[0].state, 'maintenance');
    if (fault === 'foreign') assert.equal((await f.db.transaction(c => c.query("SELECT name FROM sqlite_master WHERE name LIKE 'sr_%'"))).length, 2);
  }
});

test('SR2a schema failure rolls back every new table and configuration row', async t => {
  const f = await coordinationFixture(t, { migrate: false });
  const broken = { durable: true, close: async () => {}, transaction: work => f.db.transaction(c => work({ query: (sql, values) => {
    if (sql.startsWith('INSERT INTO sr_limits')) throw Error('private driver diagnostic');
    return c.query(sql, values);
  } })) };
  await assert.rejects(migrateCoordination(broken, 'test', f.entitlements, 'frozen', 'sqlite'), { message: 'COORDINATION_UNAVAILABLE', code: 'COORDINATION_UNAVAILABLE' });
  const tables = await f.db.transaction(c => c.query("SELECT name FROM sqlite_master WHERE type = 'table'"));
  assert.deepEqual(tables.filter(r => coordinationTables.includes(r.name)), []);
  await migrateCoordination(f.db, 'test', f.entitlements, 'frozen', 'sqlite');
});
