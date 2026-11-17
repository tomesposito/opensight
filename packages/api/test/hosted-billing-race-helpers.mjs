import assert from 'node:assert/strict';
import { HostedBilling, DAY_MS } from '../dist/hosted-billing.js';
import { readOperatorAudit } from '../dist/operator-audit.js';
import { StubMailTransport } from '../dist/mail.js';

export const tenantLock = 'SELECT tenant_id FROM h1_tenants WHERE tenant_id = ? FOR UPDATE';
export const billingRead = 'SELECT * FROM h9_billing WHERE tenant_id = ?';

/** Real PostgreSQL uses its own transactions/locks. The dialect harness runs
 * SQL on SQLite but models only explicit tenant locks, held until the callback
 * commits. Each SQL statement gets a separate SQLite transaction so SQLite's
 * global writer lock cannot accidentally hide the PostgreSQL race. These
 * schedules gate before writes; rollback is tested on real SQLite separately. */
export function billingRaceConnections(db, hooks, simulateLocks = true) {
  const locks = new Map();
  return label => ({ dialect: 'postgres', transaction: work => {
    const run = async execute => {
      const held = new Map();
      try {
        return await work({ query: async (sql, values = []) => {
          await hooks.beforeQuery?.({ label, sql, values });
          if (simulateLocks && sql === tenantLock && !held.has(values[0])) {
            while (locks.has(values[0])) {
              const previous = locks.get(values[0]);
              hooks.blocked?.({ label, sql, values });
              await previous.promise;
            }
            const lease = Promise.withResolvers();
            locks.set(values[0], lease); held.set(values[0], lease);
          }
          const rows = await execute(simulateLocks ? sql.replace(' FOR UPDATE', '') : sql, values);
          await hooks.afterQuery?.({ label, sql, values, rows });
          return rows;
        } });
      } finally {
        for (const [tenantId, lease] of held) { locks.delete(tenantId); lease.resolve(); }
      }
    };
    return simulateLocks ? run((sql, values) => db.transaction(c => c.query(sql, values)))
      : db.transaction(c => run((sql, values) => c.query(sql, values)));
  } });
}

export async function storedBilling(db, tenantId) {
  return db.transaction(async c => {
    const [billing] = await c.query(billingRead, [tenantId]);
    const pending = await c.query("SELECT id FROM h11_paid_requests WHERE tenant_id = ? AND state = 'pending'", [tenantId]);
    return { billing, pending };
  });
}

/** The caller supplies an active trial and pending Regular request, with the
 * clock initially one day before its deadline. No sleeps or polling races. */
export async function paidResolutionRace(f, resolution, order, simulateLocks = true) {
  const tenantId = f.tenantId ?? 'tenant-one';
  const initial = await storedBilling(f.db, tenantId), deadline = initial.billing.trial_ends_at;
  const expiryBlocked = Promise.withResolvers();
  let expiry, expiryRun, injected = false, billingStateRead;
  const connections = billingRaceConnections(f.db, {
    async beforeQuery({ label, sql }) {
      // Real PostgreSQL blocks this statement until the resolution commits.
      if (!simulateLocks && label === 'expiry' && sql === tenantLock) expiryBlocked.resolve();
      if (label === 'resolution' && sql === tenantLock && !injected && order === 'expiry-first') {
        injected = true;
        f.advance(47); // Well past expiry: retention must use resolution time.
        await expiry.expireTrials();
        const held = await storedBilling(f.db, tenantId);
        assert.equal(held.billing.access_state, 'paused');
        assert.equal(held.billing.retention_due_at, null);
        assert.equal(held.pending.length, 1);
      }
    },
    blocked({ label }) { if (label === 'expiry') expiryBlocked.resolve(); },
    async afterQuery({ label, sql, rows }) {
      if (label !== 'resolution' || sql !== billingRead) return;
      billingStateRead = rows[0].access_state;
      if (injected || order !== 'resolution-first') return;
      injected = true;
      assert.equal(billingStateRead, 'active');
      f.advance(1); // Cross the deadline after resolution read the live trial.
      expiryRun = expiry.expireTrials();
      // Old code lets expiry finish here, then commits stale retention. With
      // the fix, expiry must wait for resolution's tenant lock instead.
      await Promise.race([expiryRun, expiryBlocked.promise]);
    },
  }, simulateLocks);
  const options = { ...f.options, mail: f.options.mail ?? new StubMailTransport(), notifyTo: 'operator@example.test' };
  const resolver = new HostedBilling(connections('resolution'), f.config, options);
  expiry = new HostedBilling(connections('expiry'), f.config, options);
  const resolved = await resolver.resolvePaidRequest(tenantId, resolution, undefined, undefined, undefined, 'regular');
  await expiryRun;
  assert.equal(injected, true);
  assert.equal(billingStateRead, order === 'expiry-first' ? 'paused' : 'active');
  const { billing, pending } = await storedBilling(f.db, tenantId);
  assert.equal(billing.access_state === 'paused' && pending.length === 0 && billing.retention_due_at === null, false,
    'a paused workspace without a pending request must have a retention deadline');
  assert.equal(pending.length, 0); assert.equal(resolved.state, resolution);
  assert.equal(resolved.resolvedAt, new Date(f.clock()).toISOString());
  assert.equal(billing.access_state, resolution === 'granted' ? 'active' : 'paused');
  assert.equal(billing.retention_due_at, resolution === 'granted' ? null : new Date(f.clock() + 30 * DAY_MS).toISOString());
  assert.equal(billing.trial_ends_at, resolution === 'granted' ? null : deadline);
  assert.equal(billing.pause_effective_at, resolution === 'granted' ? null : deadline);
  if (resolution === 'granted') {
    assert.equal(billing.entitlement_source, 'manual'); assert.equal(billing.tier, 'regular');
    assert.doesNotThrow(() => resolver.assertAccess(tenantId));
  }
  await expiry.expireTrials(); // Repeated passes cannot duplicate the audit.
  const pauses = (await readOperatorAudit(f.db)).filter(a => a.tenantId === tenantId && a.action === 'billing.access.paused');
  assert.equal(pauses.length, resolution === 'granted' && order === 'resolution-first' ? 0 : 1);
  if (pauses.length) assert.deepEqual(pauses[0].detail, { reason: 'trial_expired', pauseEffectiveAt: deadline,
    retentionDueAt: order === 'expiry-first' ? null : billing.retention_due_at });
}
