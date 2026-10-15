import { randomUUID } from 'node:crypto';
import { MetadataError, type Database, type SqlConnection, type SqlRow, type SqlValue } from './metadata-db.js';
import { identifier } from './metadata-resources.js';
import { DurableDispatch, type DispatchEnvelope } from './dispatch.js';
import type { ObjectCollector } from './object-collector.js';

export interface RecoveryScope { tenantId: string; namespaceId: string; userId: string }
export interface RecoveryOptions { dryRun?: boolean; windowMs?: number }
export type RecoveryDecision =
  | 'replace' | 'resumed'
  | 'recovered'
  | 'already-complete'
  | 'protected-pin' | 'protected-retention' | 'protected-continued' | 'protected-manifest'
  | 'scope-mismatch' | 'unknown-object' | 'unexpected-state'
  | 'obligation-expired' | 'epoch-changed' | 'failed';
export interface RecoveryObjectReport {
  objectId: string; decision: RecoveryDecision; reason: string;
  supersededEventIds: string[]; strandedEventIds: string[];
  newEventId?: string; aggregateRevision?: number; error?: string;
}
export interface RecoveryReport {
  deployment: string; scope: RecoveryScope; dryRun: boolean;
  epoch: number; startedAt: string; objects: RecoveryObjectReport[];
}

const scoped = 'deployment = ? AND tenant_id = ? AND namespace_id = ? AND owner_id = ?';
const CLEANUP = "'object-cleanup'";
const number = (value: SqlValue | undefined): number => {
  const n = Number(value); if (value === undefined || !Number.isSafeInteger(n) || n < 0) throw new MetadataError('OBJECT_LEDGER_UNAVAILABLE', 503); return n;
};
const errorCode = (error: unknown): string => error instanceof MetadataError ? error.code : 'RECOVERY_FAILED';

/**
 * Operator-only recovery for expired object-cleanup obligations (issue #96).
 *
 * When cleanup events expire they are terminalized (DurableExecution.claim and
 * ObjectCollector.run both exclude expired events; DurableExecution.replay refuses
 * expired envelopes), so redriving the DLQ cannot release the stranded storage.
 * Recovery never replays an expired envelope: it prearms a FRESH outbox envelope
 * (new event id, next aggregate revision, current control epoch, fresh due/expires
 * window) for an explicitly selected scope and reviewed object set, then runs the
 * unchanged ObjectCollector, which rechecks pins/live references/retention under
 * its own locks, proves exact-version absence, and releases the gauge atomically
 * with the ledger transition. No principal session is required or created.
 */
export class ObjectRecovery {
  readonly deployment: string;
  constructor(private readonly database: Database, private readonly dispatch: DurableDispatch, private readonly collector: ObjectCollector) {
    this.deployment = dispatch.deployment;
  }
  private scope(scope: RecoveryScope): SqlValue[] { return [this.deployment, scope.tenantId, scope.namespaceId, scope.userId]; }
  private envelope(eventId: string, epoch: number): DispatchEnvelope { return { version: 1, deploymentEpoch: epoch, eventId, kind: 'execute' }; }
  private entry(objectId: string, decision: RecoveryDecision, reason: string): RecoveryObjectReport {
    return { objectId, decision, reason, supersededEventIds: [], strandedEventIds: [] };
  }
  private validated(scope: RecoveryScope, objectIds: readonly string[], windowMs: number): string[] {
    for (const value of [scope.tenantId, scope.namespaceId, scope.userId]) identifier(value);
    if (!Number.isSafeInteger(windowMs) || windowMs < 60000 || windowMs > 86400000) throw new MetadataError('RECOVERY_INPUT_INVALID', 400);
    if (!Array.isArray(objectIds) || objectIds.length < 1 || objectIds.length > 50) throw new MetadataError('RECOVERY_INPUT_INVALID', 400);
    const ids = [...new Set(objectIds.map(id => identifier(id)))];
    if (ids.length !== objectIds.length) throw new MetadataError('RECOVERY_INPUT_INVALID', 400);
    return ids;
  }
  /** Dry-run: recheck every gate without writing. */
  async plan(scope: RecoveryScope, objectIds: readonly string[], windowMs = 3600000): Promise<RecoveryReport> {
    const ids = this.validated(scope, objectIds, windowMs);
    const startedAt = new Date().toISOString();
    const epoch = await this.dispatch.system(async (c, control) => control.epoch);
    const objects: RecoveryObjectReport[] = [];
    for (const id of ids) {
      const assessed = await this.dispatch.system(async (c, control) =>
        control.epoch === epoch ? this.assess(c, scope, id, control.epoch, control.now)
          : this.entry(id, 'epoch-changed', 'Control epoch changed during planning; rerun the plan.'));
      objects.push(assessed);
      if (assessed.decision === 'epoch-changed') break;
    }
    return { deployment: this.deployment, scope, dryRun: true, epoch, startedAt, objects };
  }
  async recover(scope: RecoveryScope, objectIds: readonly string[], options: RecoveryOptions = {}): Promise<RecoveryReport> {
    const windowMs = options.windowMs ?? 3600000;
    if (options.dryRun) return this.plan(scope, objectIds, windowMs);
    const ids = this.validated(scope, objectIds, windowMs);
    const startedAt = new Date().toISOString();
    const epoch = await this.dispatch.system(async (c, control) => control.epoch);
    const objects: RecoveryObjectReport[] = [];
    for (const id of ids) {
      const assessed = await this.dispatch.system(async (c, control) =>
        control.epoch === epoch ? this.assess(c, scope, id, control.epoch, control.now)
          : this.entry(id, 'epoch-changed', 'Control epoch changed; remaining objects not attempted.'));
      if (assessed.decision === 'epoch-changed') { objects.push(assessed); break; }
      if (assessed.decision !== 'replace' && assessed.decision !== 'resumed') { objects.push(assessed); continue; }
      let outcome: RecoveryObjectReport;
      try {
        outcome = assessed.decision === 'replace' ? await this.replace(scope, id, assessed, epoch, windowMs) : await this.resume(scope, id, assessed);
      } catch (error) {
        // Lost eligibility between assessment and prearm (e.g. a pin landed): report
        // the fresh assessment instead of a failure.
        outcome = error instanceof MetadataError && error.code === 'RECOVERY_NOT_ELIGIBLE'
          ? await this.dispatch.system((c, control) => this.assess(c, scope, id, control.epoch, control.now))
          : { ...assessed, decision: 'failed', reason: 'Collection failed; the obligation stays pending and resumable.', error: errorCode(error) };
      }
      objects.push(outcome);
      if (outcome.decision === 'epoch-changed') {
        const seen = new Set(objects.map(o => o.objectId));
        for (const rest of ids) if (!seen.has(rest)) objects.push(this.entry(rest, 'epoch-changed', 'Control epoch changed; not attempted.'));
        break;
      }
    }
    return { deployment: this.deployment, scope, dryRun: false, epoch, startedAt, objects };
  }
  /**
   * Read-only assessment. Pins and minimum retention are checked here; the deeper
   * live-reference checks (accepted uploads, source bindings, cache manifests,
   * result operations) stay with ObjectCollector, which re-verifies them
   * authoritatively inside its own transaction at run time.
   */
  private async assess(c: SqlConnection, scope: RecoveryScope, id: string, epoch: number, now: number): Promise<RecoveryObjectReport> {
    const located = (await c.query('SELECT tenant_id, namespace_id, owner_id FROM sr_object WHERE deployment = ? AND object_id = ?', [this.deployment, id]))[0];
    if (!located) return this.entry(id, 'unknown-object', 'No object with this id in the deployment; nothing written.');
    if (String(located.tenant_id) !== scope.tenantId || String(located.namespace_id) !== scope.namespaceId || String(located.owner_id) !== scope.userId)
      return this.entry(id, 'scope-mismatch', 'Object belongs to another tenant, namespace or owner; never touched.');
    const entry = (await c.query(`SELECT * FROM sr_object WHERE ${scoped} AND object_id = ?`, [...this.scope(scope), id]))[0]!;
    if (entry.state === 'deleted') return this.entry(id, 'already-complete', 'Object is already deleted; the gauge was already released.');
    if (!['reserved', 'live', 'retiring'].includes(String(entry.state)))
      return this.entry(id, 'unexpected-state', `Object state ${entry.state} is not recoverable; operator review required.`);
    const rows = await c.query(`SELECT event_id, control_epoch, aggregate_revision, state, expires_at FROM sr_outbox
      WHERE ${scoped} AND aggregate_id = ? AND kind = ${CLEANUP} ORDER BY aggregate_revision DESC`, [...this.scope(scope), id]);
    const terminalIds = rows.filter(r => r.state === 'terminal').map(r => String(r.event_id));
    const live = rows.filter(r => r.state !== 'terminal');
    const expiredIds = live.filter(r => number(r.expires_at) <= now).map(r => String(r.event_id));
    const supersededEventIds = [...terminalIds, ...expiredIds];
    const strandedEventIds = live.filter(r => number(r.control_epoch) !== epoch && number(r.expires_at) > now).map(r => String(r.event_id));
    const resumable = live.find(r => number(r.control_epoch) === epoch && number(r.expires_at) > now);
    if (resumable) return { ...this.entry(id, 'resumed', 'A non-terminal obligation from this epoch is still pending; it will be resumed, not duplicated.'),
      supersededEventIds, strandedEventIds, newEventId: String(resumable.event_id), aggregateRevision: number(resumable.aggregate_revision) };
    const pins = await c.query(`SELECT pin_id FROM sr_object_pin WHERE ${scoped} AND object_id = ? AND expires_at > ? LIMIT 1`, [...this.scope(scope), id, now]);
    if (pins.length) return { ...this.entry(id, 'protected-pin', 'An active pin protects this object; cleanup stays deferred.'), supersededEventIds, strandedEventIds };
    const until = Math.max(number(entry.retention_until), number(entry.created_at) + 86400000, number(entry.signature_until) + 600000);
    if (until > now) return { ...this.entry(id, 'protected-retention', `Minimum retention holds until ${new Date(until).toISOString()}; cleanup stays deferred.`), supersededEventIds, strandedEventIds };
    const aggregateRevision = rows.reduce((max, r) => Math.max(max, number(r.aggregate_revision)), 0) + 1;
    return { ...this.entry(id, 'replace', 'Eligible: a fresh cleanup obligation will be prearmed and collected with exact-version proof.'),
      supersededEventIds, strandedEventIds, aggregateRevision };
  }
  /**
   * Prearm a fresh obligation inside one transaction, then collect outside it.
   * Expired-but-pending rows are terminalized exactly as inspect() would; the
   * fresh row reuses the object's own intent_id (the outbox FK requires a live
   * sr_dispatch_intent row) with the next aggregate revision.
   */
  private async replace(scope: RecoveryScope, id: string, assessed: RecoveryObjectReport, epoch: number, windowMs: number): Promise<RecoveryObjectReport> {
    type Prearm = { kind: 'epoch-changed' } | { kind: 'resumed'; report: RecoveryObjectReport }
      | { kind: 'prearmed'; eventId: string; revision: number; supersededEventIds: string[]; strandedEventIds: string[] };
    const prearmed: Prearm = await this.dispatch.system(async (c, control): Promise<Prearm> => {
      if (control.epoch !== epoch) return { kind: 'epoch-changed' };
      const fresh = await this.assess(c, scope, id, control.epoch, control.now);
      if (fresh.decision === 'resumed') return { kind: 'resumed', report: fresh };
      if (fresh.decision !== 'replace' || fresh.aggregateRevision === undefined) throw new MetadataError('RECOVERY_NOT_ELIGIBLE', 409);
      const row = (await c.query(`SELECT intent_id FROM sr_object WHERE ${scoped} AND object_id = ?`, [...this.scope(scope), id]))[0]!;
      for (const eventId of fresh.supersededEventIds) {
        const current = (await c.query('SELECT state FROM sr_outbox WHERE deployment = ? AND event_id = ?', [this.deployment, eventId]))[0];
        if (current && current.state !== 'terminal') await c.query("UPDATE sr_outbox SET state = 'terminal' WHERE deployment = ? AND event_id = ?", [this.deployment, eventId]);
      }
      const eventId = randomUUID(), values: SqlValue[] = [...this.scope(scope), eventId, String(row.intent_id), id,
        fresh.aggregateRevision, 'object-cleanup', control.epoch, control.now, control.now + windowMs];
      await c.query("INSERT INTO sr_outbox VALUES (?,?,?,?,?,?,?,?,?,1,?,?,?,'pending')", values);
      return { kind: 'prearmed', eventId, revision: fresh.aggregateRevision, supersededEventIds: fresh.supersededEventIds, strandedEventIds: fresh.strandedEventIds };
    });
    if (prearmed.kind === 'epoch-changed') return { ...this.entry(id, 'epoch-changed', 'Control epoch changed between assessment and prearm; nothing written.'),
      supersededEventIds: assessed.supersededEventIds, strandedEventIds: assessed.strandedEventIds };
    if (prearmed.kind === 'resumed') return this.resume(scope, id, prearmed.report);
    // External I/O never holds the SQL transaction: the prearmed row is durable first.
    await this.collector.run(this.envelope(prearmed.eventId, epoch));
    return this.outcome(scope, id, prearmed.eventId, prearmed.revision, epoch, prearmed.supersededEventIds, prearmed.strandedEventIds);
  }
  /** A pending obligation from this epoch is resumed instead of duplicated. */
  private async resume(scope: RecoveryScope, id: string, assessed: RecoveryObjectReport): Promise<RecoveryObjectReport> {
    const checked = await this.dispatch.system(async (c, control) => ({ epoch: control.epoch, fresh: await this.assess(c, scope, id, control.epoch, control.now) }));
    if (checked.fresh.decision !== 'resumed') {
      const decision: RecoveryDecision = checked.fresh.decision === 'epoch-changed' ? 'epoch-changed' : 'failed';
      return { ...this.entry(id, decision, checked.fresh.reason), supersededEventIds: assessed.supersededEventIds, strandedEventIds: assessed.strandedEventIds };
    }
    await this.collector.run(this.envelope(checked.fresh.newEventId!, checked.epoch));
    return this.outcome(scope, id, checked.fresh.newEventId!, checked.fresh.aggregateRevision!, checked.epoch, assessed.supersededEventIds, assessed.strandedEventIds);
  }
  private async outcome(scope: RecoveryScope, id: string, eventId: string, revision: number, epoch: number,
    supersededEventIds: string[], strandedEventIds: string[]): Promise<RecoveryObjectReport> {
    return this.dispatch.system(async (c, control) => {
      const base = { objectId: id, supersededEventIds, strandedEventIds, newEventId: eventId, aggregateRevision: revision };
      const row = (await c.query(`SELECT state FROM sr_object WHERE ${scoped} AND object_id = ?`, [...this.scope(scope), id]))[0];
      if (!row || String(row.state) === 'deleted')
        return { ...base, decision: 'recovered' as const, reason: 'Exact-version absence proven; ledger and gauge updated atomically.' };
      if (control.epoch !== epoch)
        return { ...base, decision: 'epoch-changed' as const, reason: 'Control epoch changed during collection; the obligation stays pending for a later run.' };
      const continuation = (await c.query(`SELECT event_id FROM sr_outbox WHERE ${scoped} AND aggregate_id = ? AND kind = ${CLEANUP}
        AND state <> 'terminal' AND aggregate_revision > ? ORDER BY aggregate_revision DESC LIMIT 1`, [...this.scope(scope), id, revision]))[0];
      if (continuation)
        return { ...base, decision: 'protected-continued' as const, reason: 'Live references still protect this object; a continuation obligation was prearmed for the next eligible window.' };
      const event = (await c.query('SELECT state, expires_at FROM sr_outbox WHERE deployment = ? AND event_id = ?', [this.deployment, eventId]))[0];
      if (event?.state === 'terminal') {
        if (number(event.expires_at) <= control.now)
          return { ...base, decision: 'obligation-expired' as const, reason: 'The fresh obligation expired before collection; rerun to prearm a new one. Expired envelopes are never replayed.' };
        return { ...base, decision: 'protected-manifest' as const, reason: 'An active indefinite manifest protects this object; the obligation was closed without deletion.' };
      }
      return { ...base, decision: 'failed' as const, reason: 'Collection left the obligation pending; rerun to resume.', error: 'RECOVERY_INCOMPLETE' };
    });
  }
  /** Release the underlying connection (idle database pause). The CLI guarantees this in a finally. */
  async close(): Promise<void> { await this.database.close(); }
}
