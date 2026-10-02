import { checksum } from './metadata-operator.js';
import { MetadataError } from './metadata-db.js';
import { identifier, object, type Scope } from './metadata-resources.js';
import { emptyAutomationState, validateAutomationState } from './automation-state.js';
import { JobStore } from './job-store.js';
import type { JobExecutor } from './job-renderer.js';
import { initializeJobs, jobSpec, lockTenant, member, revisions, scoped, scopeArgs, type JobSpec } from './job-schema.js';

/** Run under the same OS maintenance lock as the single hosted process. H1's
 * frozen input remains intact; a failed transaction leaves no converted jobs. */
export async function migrateJobs(store: JobStore, executor: JobExecutor, scope: Scope, defaultOwner: string, frozen: 'frozen') {
  if (frozen !== 'frozen') throw new MetadataError('MIGRATION_FREEZE_REQUIRED');
  identifier(scope.tenantId); identifier(scope.namespaceId); identifier(defaultOwner);
  await initializeJobs(store.db);
  const input = async () => store.db.transaction(c => c.query(`SELECT resource_id, body FROM h1_resources WHERE ${scoped} AND kind = 'job' ORDER BY resource_id`, scopeArgs(scope)));
  const rows = await input(), hash = checksum([scope, defaultOwner, rows]);
  const previous = await store.db.transaction(c => c.query(`SELECT checksum FROM h7_migrations WHERE ${scoped}`, scopeArgs(scope)));
  if (previous[0]) { if (previous[0].checksum !== hash) throw new MetadataError('JOB_MIGRATION_CHANGED'); return { state: 'committed', checksum: hash }; }
  const raw = emptyAutomationState();
  for (const row of rows) {
    const body = object(JSON.parse(String(row.body))), collection = String(body.collection);
    if (body.executionDisabled !== true || collection === 'version' || !Object.hasOwn(raw, collection)) throw new MetadataError('JOB_MIGRATION_INVALID');
    (raw[collection as Exclude<keyof typeof raw, 'version'>] as unknown[]).push(body.record);
  }
  const legacy = validateAutomationState(raw), owner = await store.context(scope, defaultOwner), rev = await store.metadata.revisions(owner);
  const recipientIds = async (emails: string[]) => store.db.transaction(async c => {
    const result: string[] = [];
    for (const email of emails) {
      const found = await c.query(`SELECT m.user_id FROM h2_memberships m JOIN h2_identities i ON i.subject = m.subject WHERE m.tenant_id = ? AND m.namespace_id = ? AND m.status = 'active' AND i.status = 'active' AND lower(i.email) = ?`, [...scopeArgs(scope), email.toLowerCase()]);
      if (found.length !== 1) throw new MetadataError('JOB_RECIPIENT_UNRESOLVED', 403);
      result.push(String(found[0]!.user_id));
    }
    return result;
  });
  const planned: { id: string; ownerId: string; spec: JobSpec; nextRun: string | null; stopped: boolean; alertState: string }[] = [];
  const add = (collection: string, key: unknown, ownerId: string, spec: unknown, nextRun: string | null, stopped = false, alertState = 'ok') => {
    planned.push({ id: checksum([collection, key]), ownerId, spec: jobSpec(spec), nextRun, stopped, alertState });
  };
  for (const r of legacy.schedules) add('schedules', r.datasetId, defaultOwner, { kind: 'refresh', target: { kind: 'dataset', id: r.datasetId }, enabled: r.enabled, schedule: r.schedule }, r.nextRun);
  // Deleted refresh schedules can still have history. Preserve that history with
  // a stopped record; migration must never invent a runnable schedule.
  for (const id of new Set([...legacy.refreshRuns.map(r => r.datasetId), ...legacy.datasets.map(r => r.datasetId)])) if (!legacy.schedules.some(s => s.datasetId === id))
    add('schedules', id, defaultOwner, { kind: 'refresh', target: { kind: 'dataset', id }, enabled: false, schedule: { kind: 'interval', minutes: 1, timeZone: 'UTC' } }, null, true);
  for (const r of legacy.subscriptions) add('subscriptions', [r.userId, r.id], r.userId, { kind: 'report', dashboardId: r.dashboardId, recipients: await recipientIds(r.recipients), enabled: r.enabled, schedule: r.schedule }, r.nextRun);
  for (const r of legacy.alertRules) {
    const { id, recipients, ...spec } = r;
    add('alertRules', id, defaultOwner, { ...spec, kind: 'alert', recipients: await recipientIds(recipients) }, null, false, legacy.alertStates.find(s => s.ruleId === id)!.state);
  }
  for (const job of planned) {
    const context = await store.context(scope, job.ownerId);
    if (!job.stopped) await executor.authorize(context, job.spec);
    if (job.spec.kind !== 'refresh') for (const user of job.spec.recipients) await executor.authorize(await store.context(scope, user), job.spec);
  }
  await store.db.transaction(async c => {
    await lockTenant(c, scope);
    if (JSON.stringify(rev) !== JSON.stringify(await revisions(c, scope))) throw new MetadataError('JOB_MIGRATION_CHANGED');
    const current = await c.query(`SELECT resource_id, body FROM h1_resources WHERE ${scoped} AND kind = 'job' ORDER BY resource_id`, scopeArgs(scope));
    if (checksum([scope, defaultOwner, current]) !== hash) throw new MetadataError('JOB_MIGRATION_CHANGED');
    for (const j of planned) {
      await member(c, scope, j.ownerId);
      await c.query('INSERT INTO h7_jobs VALUES (?,?,?,?,1,?,?,?,?)', [...scopeArgs(scope), j.id, j.ownerId, JSON.stringify(j.spec), j.nextRun, j.stopped ? 1 : 0, j.alertState]);
    }
    for (const [collection, runs] of [['refreshRuns', legacy.refreshRuns], ['reportRuns', legacy.reportRuns], ['alertRuns', legacy.alertRuns]] as const) for (const r of runs) {
      const jobId = 'datasetId' in r ? checksum(['schedules', r.datasetId]) : 'subscriptionId' in r ? checksum(['subscriptions', [r.userId, r.subscriptionId]]) : checksum(['alertRules', r.ruleId]);
      const job = planned.find(j => j.id === jobId);
      if (!job) throw new MetadataError('JOB_HISTORY_UNRESOLVED');
      const interrupted = r.state === 'running' || 'notification' in r && r.notification === 'pending';
      const failed = interrupted || r.state === 'failed' || 'notification' in r && r.notification === 'failed';
      await c.query('INSERT INTO h7_occurrences VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [...scopeArgs(scope), checksum([collection, r.id]), jobId, job.ownerId, job.ownerId, 1, `legacy:${r.id}`,
        JSON.stringify(job.spec), JSON.stringify(rev), failed ? 'failed' : 'succeeded', interrupted ? 'LEGACY_JOB_INTERRUPTED' : r.error?.code ?? null, r.startedAt, r.finishedAt ?? store.clock().toISOString()]);
    }
    await c.query('INSERT INTO h7_migrations VALUES (?,?,?)', [...scopeArgs(scope), hash]);
  });
  return { state: 'committed', checksum: hash, jobs: planned.length, histories: legacy.refreshRuns.length + legacy.reportRuns.length + legacy.alertRuns.length };
}
