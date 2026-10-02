import test from 'node:test';
import assert from 'node:assert/strict';
import { jobFixture, report, refresh } from './job-helpers.mjs';
import { JobOwnership } from '../dist/job-ownership.js';
import { HostedProvisioning } from '../dist/hosted-provisioning.js';
import { hostedConfig } from '../dist/hosted-config.js';
import { environment } from './hosted-helpers.mjs';
import { migrateJobs } from '../dist/job-migration.js';
import { checksum } from '../dist/metadata-operator.js';
import { emptyAutomationState } from '../dist/automation-state.js';
const alert = { kind: 'alert', datasetId: 'dataset', dashboardId: 'dashboard', visualId: 'visual', fieldId: 'total', dimensions: {}, condition: { kind: 'above', threshold: 10 }, enabled: true, recipients: ['other'] };

test('H7 removal requires explicit transfer-or-stop, cancels work atomically and retries idempotently', async t => {
  for (const action of ['transfer', 'stop']) {
    const f = await jobFixture(t), ownership = new JobOwnership(f.store, f.executor), provisioning = new HostedProvisioning(f.db, hostedConfig(environment()), f.mail, f.clock, ownership);
    await f.put('report'); await f.put('refresh', refresh); await f.put('alert', alert);
    const c = await f.login(), run = await f.store.enqueue(c, 'report'); await f.runner.execute(run);
    await assert.rejects(provisioning.removeMember(c.tenantId, c.userId), { code: 'JOB_DISPOSITION_REQUIRED' });
    assert.equal((await ownership.users(c.tenantId)).length, 2);
    const preview = await ownership.preview(c.tenantId, c.userId); assert.equal(preview.jobs.length, 3);
    const choice = { action, preview: preview.preview, ...(action === 'transfer' ? { transferTo: 'other' } : {}) };
    await provisioning.removeMember(c.tenantId, c.userId, choice); await provisioning.removeMember(c.tenantId, c.userId, choice);
    const replacement = await f.login('one', 'other'), jobs = await f.store.list(replacement);
    assert.equal(jobs.length, 3);
    for (const job of jobs) { assert.equal(job.stopped, action === 'stop'); assert.equal(job.ownerId, action === 'transfer' ? 'other' : 'admin'); }
    assert.equal((await f.store.history(replacement, 'report'))[0].state, 'cancelled');
    assert.equal((await f.store.deliveries(replacement, 'report'))[0].state, 'cancelled');
    await f.runner.deliver(); assert.equal(f.mail.messages.length, 0);
    assert.equal((await ownership.users(c.tenantId)).length, 1);
  }
});
test('H7 stale deletion previews and inaccessible or foreign transfer targets leave membership and jobs intact', async t => {
  const f = await jobFixture(t), ownership = new JobOwnership(f.store, f.executor), p = new HostedProvisioning(f.db, hostedConfig(environment()), f.mail, f.clock, ownership);
  await f.put('report'); const c = await f.login(), before = await ownership.preview(c.tenantId, c.userId);
  await f.put('new', refresh);
  await assert.rejects(p.removeMember(c.tenantId, c.userId, { action: 'stop', preview: before.preview }), { code: 'JOB_DISPOSITION_STALE' });
  const current = await ownership.preview(c.tenantId, c.userId);
  for (const transferTo of ['admin', 'foreign']) await assert.rejects(p.removeMember(c.tenantId, c.userId, { action: 'transfer', preview: current.preview, transferTo }), { code: 'JOB_TRANSFER_TARGET_INVALID' });
  f.executor.authorize = async () => { throw Object.assign(new Error(), { code: 'RESOURCE_NOT_FOUND' }); };
  await assert.rejects(p.removeMember(c.tenantId, c.userId, { action: 'transfer', preview: current.preview, transferTo: 'other' }), { code: 'RESOURCE_NOT_FOUND' });
  assert.equal((await ownership.users(c.tenantId)).length, 2); assert.equal((await f.store.get(c, 'report')).ownerId, 'admin');
});
test('H7 legacy migration resolves owners/recipients, preserves histories, is atomic and never replays mail', async t => {
  const f = await jobFixture(t), c = await f.login(), state = emptyAutomationState(), now = new Date(f.clock()).toISOString();
  state.subscriptions.push({ id: 'old', userId: 'admin', dashboardId: 'dashboard', recipients: ['one-other@example.test'], enabled: true, schedule: report.schedule, nextRun: '2099-01-01T00:00:00.000Z' });
  state.reportRuns.push({ id: 'old-run', subscriptionId: 'old', userId: 'admin', startedAt: now, finishedAt: null, state: 'running', error: null });
  await f.db.transaction(async db => { for (const [collection, list] of Object.entries(state)) if (collection !== 'version') for (const record of list) {
    const key = collection === 'subscriptions' ? [record.userId, record.id] : record.id;
    await db.query("INSERT INTO h1_resources VALUES (?,?,'job','',?,?,1)", [c.tenantId, c.namespaceId, checksum([collection, key]), JSON.stringify({ collection, record, references: [], executionDisabled: true })]);
  } });
  f.executor.authorize = async () => { throw Object.assign(new Error(), { code: 'RESOURCE_NOT_FOUND' }); };
  await assert.rejects(migrateJobs(f.store, f.executor, { tenantId: c.tenantId, namespaceId: c.namespaceId }, 'admin', 'frozen'), { code: 'RESOURCE_NOT_FOUND' });
  assert.deepEqual(await f.store.list(c), []);
  f.executor.authorize = async () => {};
  const scope = { tenantId: c.tenantId, namespaceId: c.namespaceId };
  const migrated = await migrateJobs(f.store, f.executor, scope, 'admin', 'frozen'); assert.equal(migrated.jobs, 1);
  assert.equal((await migrateJobs(f.store, f.executor, scope, 'admin', 'frozen')).checksum, migrated.checksum);
  const [job] = await f.store.list(c); assert.deepEqual(job.spec.recipients, ['other']);
  assert.equal((await f.store.history(c, job.id))[0].errorCode, 'LEGACY_JOB_INTERRUPTED');
  await f.runner.tick(); assert.equal(f.mail.messages.length, 0);
  await assert.rejects(migrateJobs(f.store, f.executor, scope, 'other', 'frozen'), { code: 'JOB_MIGRATION_CHANGED' });
});
test('H7 refresh/report/alert migration rolls back interrupted writes and retains archived state and transitions', async t => {
  const f = await jobFixture(t), c = await f.login(), scope = { tenantId: c.tenantId, namespaceId: c.namespaceId }, state = emptyAutomationState(), now = new Date(f.clock()).toISOString();
  state.schedules.push({ datasetId: 'dataset', enabled: true, schedule: refresh.schedule, nextRun: '2099-01-01T00:00:00.000Z' });
  state.datasets.push({ datasetId: 'dataset', lastGood: now, nextRun: state.schedules[0].nextRun, consecutiveFailures: 0, state: 'ready', error: null });
  state.refreshRuns.push({ id: 'refresh-old', datasetId: 'dataset', startedAt: now, finishedAt: now, state: 'succeeded', rows: 3, error: null });
  const { kind, ...rule } = alert;
  state.alertRules.push({ id: 'alert-old', ...rule, recipients: ['one-other@example.test'] });
  state.alertStates.push({ ruleId: 'alert-old', state: 'triggered', evaluatedAt: now, error: null });
  state.alertRuns.push({ id: 'evaluation-old', ruleId: 'alert-old', refreshRunId: 'refresh-old', startedAt: now, finishedAt: now, state: 'evaluated', value: 40, previousValue: null, percentChange: null, error: null, notification: 'pending', notificationError: null });
  state.alertTransitions.push({ version: 1, type: 'opensight.alert.state_changed', eventId: 'event-old', occurredAt: now, ruleId: 'alert-old', datasetId: 'dataset', dashboardId: 'dashboard', visualId: 'visual', fieldId: 'total', refreshRunId: 'refresh-old', from: 'ok', to: 'triggered', value: 40, previousValue: null, percentChange: null, condition: rule.condition });
  await f.db.transaction(async db => { for (const [collection, list] of Object.entries(state)) if (collection !== 'version') for (const record of list) {
    await db.query("INSERT INTO h1_resources VALUES (?,?,'job','',?,?,1)", [c.tenantId, c.namespaceId, checksum([collection, record.id ?? record.eventId ?? record.ruleId ?? record.datasetId]), JSON.stringify({ collection, record, references: [], executionDisabled: true })]);
  } });
  const transaction = f.db.transaction.bind(f.db); let fault = true;
  f.db.transaction = work => transaction(c => work({ query(sql, args) { if (fault && sql.startsWith('INSERT INTO h7_occurrences')) { fault = false; throw new Error('interrupted migration'); } return c.query(sql, args); } }));
  await assert.rejects(migrateJobs(f.store, f.executor, scope, 'admin', 'frozen'), /interrupted migration/);
  assert.deepEqual(await f.store.list(c), []); assert.equal((await transaction(c => c.query('SELECT * FROM h7_migrations'))).length, 0);
  await migrateJobs(f.store, f.executor, scope, 'admin', 'frozen');
  const jobs = await f.store.list(c); assert.equal(jobs.length, 2);
  const ruleJob = jobs.find(j => j.spec.kind === 'alert'); assert.equal(ruleJob.alertState, 'triggered');
  assert.equal((await f.store.history(c, ruleJob.id))[0].errorCode, 'LEGACY_JOB_INTERRUPTED');
  assert.equal((await transaction(c => c.query('SELECT * FROM h7_deliveries'))).length, 0);
  assert.equal((await transaction(c => c.query("SELECT * FROM h1_resources WHERE kind = 'job'"))).length, 7);
});
test('H7 migration refuses unresolved owners and external recipients without activating any schedule', async t => {
  const f = await jobFixture(t), c = await f.login(), scope = { tenantId: c.tenantId, namespaceId: c.namespaceId };
  const record = { id: 'outside', userId: 'admin', dashboardId: 'dashboard', recipients: ['external@example.test'], enabled: true, schedule: report.schedule, nextRun: '2099-01-01T00:00:00.000Z' };
  await f.db.transaction(db => db.query("INSERT INTO h1_resources VALUES (?,?,'job','','legacy',?,1)", [c.tenantId, c.namespaceId, JSON.stringify({ collection: 'subscriptions', record, references: [], executionDisabled: true })]));
  await assert.rejects(migrateJobs(f.store, f.executor, scope, 'missing', 'frozen'), { code: 'JOB_PRINCIPAL_UNAVAILABLE' });
  await assert.rejects(migrateJobs(f.store, f.executor, scope, 'admin', 'frozen'), { code: 'JOB_RECIPIENT_UNRESOLVED' });
  assert.deepEqual(await f.store.list(c), []);
});
