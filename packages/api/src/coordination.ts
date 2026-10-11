import { randomUUID } from 'node:crypto';
import { currentAuthority } from './serverless-authority.js';
import { MetadataError, type Database, type SqlConnection, type SqlRow, type SqlValue } from './metadata-db.js';
import { type TenantContext, type Revisions, TenantMetadata } from './metadata.js';
import { identifier, object } from './metadata-resources.js';
import { validateBudgets, type BudgetConfig, type WorkLimits } from './budgets.js';
import { entitlementConfig, type Entitlements } from './hosted-usage.js';
import { coordinationChecksum, coordinationDeployment, coordinationFailure, coordinationNow, type CoordinationDialect } from './coordination-schema.js';

export interface AdmissionInput {
  attemptId: string;
  class: 'query' | 'refresh';
  revisions: Revisions;
  platformRemainingMs: number;
  claim?: { kind: 'source' | 'prepared-dataset'; id: string; expectedVersion: number };
}
export interface AttemptHandle {
  readonly attemptId: string; readonly token: string;
  readonly executionDeadline: number; readonly holdUntil: number; readonly leaseUntil: number;
  readonly fence?: string; readonly generation?: string;
}
export interface AttemptDetails {
  readonly context: TenantContext; readonly input: Readonly<AdmissionInput>;
  readonly epoch: string; readonly limits: Readonly<WorkLimits>;
  readonly fence?: string; readonly generation?: string;
}
interface Attempt {
  context: TenantContext; input: AdmissionInput; token: string; epoch: string; limitsRevision: number;
  limits: WorkLimits;
  fence?: string; generation?: string;
}
interface Locked { epoch: string; revision: number; budgets: BudgetConfig; entitlements: Entitlements }
const maximumFence = '9223372036854775807';
const attemptPredicate = 'deployment = ? AND attempt_id = ? AND token = ? AND tenant_id = ? AND namespace_id = ? AND owner_id = ?';
const integer = (v: SqlValue | undefined): number => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 0) throw new MetadataError('COORDINATION_UNAVAILABLE', 503);
  return n;
};
const counter = (v: SqlValue | undefined): string => {
  const n = String(v);
  if (!/^[1-9]\d{0,18}$/.test(n) || BigInt(n) > BigInt(maximumFence)) throw new MetadataError('COORDINATION_UNAVAILABLE', 503);
  return n;
};
const invalid = (): never => { throw new MetadataError('COORDINATION_INPUT_INVALID', 400); };
function inputSnapshot(raw: AdmissionInput): AdmissionInput {
  const input = structuredClone(raw), r = object(input, ['attemptId', 'class', 'revisions', 'platformRemainingMs', 'claim']);
  if (typeof r.attemptId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(r.attemptId)
    || !['query', 'refresh'].includes(String(r.class)) || !Number.isSafeInteger(r.platformRemainingMs) || Number(r.platformRemainingMs) <= 3000 || Number(r.platformRemainingMs) > 120000) invalid();
  const revisions = object(r.revisions, ['authorization', 'policy', 'configuration']);
  if (!['authorization', 'policy', 'configuration'].every(k => Number.isSafeInteger(revisions[k]) && Number(revisions[k]) > 0)) invalid();
  if (r.class === 'query' && r.claim !== undefined || r.class === 'refresh' && r.claim === undefined) invalid();
  if (r.claim !== undefined) {
    const claim = object(r.claim, ['kind', 'id', 'expectedVersion']);
    if (!['source', 'prepared-dataset'].includes(String(claim.kind)) || !Number.isSafeInteger(claim.expectedVersion) || Number(claim.expectedVersion) < 1) invalid();
    identifier(claim.id);
  }
  return input;
}

/** Internal SQL authority. No timer, queue consumer or runtime activation lives here. */
export class DurableCoordinator {
  readonly #attempts = new WeakMap<AttemptHandle, Attempt>();
  readonly deployment: string;
  constructor(private readonly database: Database, private readonly metadata: TenantMetadata, deployment: string,
    private readonly dialect: CoordinationDialect = 'postgres') {
    this.deployment = coordinationDeployment(deployment);
    if (database.durable !== true || !['sqlite', 'postgres'].includes(dialect)) throw new MetadataError('COORDINATION_CONFIG_INVALID', 503);
  }
  private transaction<T>(work: (c: SqlConnection) => Promise<T>): Promise<T> { return this.database.transaction(work).catch(coordinationFailure); }
  private async locked(c: SqlConnection, open = true): Promise<Locked> {
    const lock = this.dialect === 'postgres' ? ' FOR UPDATE' : '';
    const control = (await c.query(`SELECT state, CAST(epoch AS TEXT) AS epoch, schema_min, schema_max, protocol_min, protocol_max FROM sr_control WHERE deployment = ?${lock}`, [this.deployment]))[0];
    if (!control || open && (control.state !== 'open' || !['schema_min', 'schema_max', 'protocol_min', 'protocol_max'].every(k => integer(control[k]) === 1))) throw new MetadataError('WORKSPACE_MAINTENANCE', 503);
    const limits = (await c.query(`SELECT revision, budget_version, entitlements FROM sr_limits WHERE deployment = ?${lock}`, [this.deployment]))[0];
    const budget = (await c.query(`SELECT version, body FROM h4_budget_config WHERE id = 1${lock}`))[0];
    const marker = (await c.query('SELECT version, checksum FROM sr_coordination_schema WHERE deployment = ?', [this.deployment]))[0];
    if (!limits || !budget || integer(marker?.version) !== 1 || marker?.checksum !== coordinationChecksum) throw new MetadataError('COORDINATION_SCHEMA_REQUIRED', 503);
    if (open && integer(limits.budget_version) !== integer(budget.version)) throw new MetadataError('COORDINATION_CONFIG_CHANGED', 503);
    return { epoch: counter(control.epoch), revision: integer(limits.revision), budgets: validateBudgets(JSON.parse(String(budget.body))), entitlements: entitlementConfig(String(limits.entitlements)) };
  }
  private async authority(c: SqlConnection, context: TenantContext, input: AdmissionInput): Promise<void> {
    await currentAuthority(c, this.metadata, context, input.revisions, input.class === 'refresh');
    if (input.claim) {
      const row = (await c.query('SELECT version FROM h1_resources WHERE tenant_id = ? AND namespace_id = ? AND owner_id = ? AND kind = ? AND resource_id = ?',
        [context.tenantId, context.namespaceId, context.userId, input.claim.kind, input.claim.id]))[0];
      if (!row) throw new MetadataError('RESOURCE_NOT_FOUND', 404);
      if (integer(row.version) !== input.claim.expectedVersion) throw new MetadataError('METADATA_REVISED', 403);
    }
  }
  private claimValues(attempt: Pick<Attempt, 'context' | 'input'>): SqlValue[] {
    const { context: c, input } = attempt, claim = input.claim;
    if (!claim) return invalid();
    return [this.deployment, c.tenantId, c.namespaceId, c.userId, claim.kind, claim.id];
  }
  private async claim(c: SqlConnection, attempt: Pick<Attempt, 'context' | 'input'>): Promise<SqlRow | undefined> {
    return (await c.query(`SELECT CAST(fence AS TEXT) AS fence, CAST(generation AS TEXT) AS generation, resource_version, attempt_id FROM sr_claim
      WHERE deployment = ? AND tenant_id = ? AND namespace_id = ? AND owner_id = ? AND kind = ? AND resource_id = ?${this.dialect === 'postgres' ? ' FOR UPDATE' : ''}`, this.claimValues(attempt)))[0];
  }
  private handle(handle: AttemptHandle): Attempt {
    const attempt = this.#attempts.get(handle);
    if (!attempt) throw new MetadataError('ATTEMPT_HANDLE_REQUIRED', 403);
    return attempt;
  }
  private details(attempt: Omit<Attempt, 'token' | 'limitsRevision'>): AttemptDetails {
    const input = structuredClone(attempt.input);
    Object.freeze(input.revisions); if (input.claim) Object.freeze(input.claim); Object.freeze(input);
    return Object.freeze({ context: attempt.context, input, epoch: attempt.epoch, limits: Object.freeze({ ...attempt.limits }),
      ...(attempt.fence ? { fence: attempt.fence, generation: attempt.generation } : {}) });
  }
  /** Immutable server-derived description, not a replacement for a live SQL check. */
  describe(handle: AttemptHandle): AttemptDetails { return this.details(this.handle(handle)); }
  private attemptValues(attempt: Attempt): SqlValue[] {
    return [this.deployment, attempt.input.attemptId, attempt.token, attempt.context.tenantId, attempt.context.namespaceId, attempt.context.userId];
  }
  async admit(context: TenantContext, raw: AdmissionInput, admittedWork?: (c: SqlConnection, details: AttemptDetails) => Promise<void>): Promise<AttemptHandle> {
    this.metadata.assertContext(context);
    const entered = performance.now(), input = inputSnapshot(raw), token = randomUUID();
    const admitted = await this.transaction(async c => {
      const configuration = await this.locked(c); await this.authority(c, context, input);
      const now = await coordinationNow(c, this.dialect), limits = Object.hasOwn(configuration.budgets.tenants, context.tenantId) ? configuration.budgets.tenants[context.tenantId]! : configuration.budgets.defaults;
      const remaining = input.platformRemainingMs - Math.ceil(performance.now() - entered);
      if (remaining <= 3000) throw new MetadataError('EXECUTION_CANCELLED', 409);
      const entitlement = Object.hasOwn(configuration.entitlements.tenants, context.tenantId) ? configuration.entitlements.tenants[context.tenantId] : configuration.entitlements.defaults;
      if (!entitlement) throw new MetadataError('ENTITLEMENT_UNRESOLVED', 503);
      const claim = input.claim ? await this.claim(c, { context, input }) : undefined;
      if ((await c.query('SELECT attempt_id FROM sr_admission WHERE deployment = ? AND attempt_id = ?', [this.deployment, input.attemptId])).length) throw new MetadataError('ATTEMPT_ALREADY_ADMITTED', 409);
      const active = await c.query("SELECT tenant_id, class, working_bytes, rss_bytes FROM sr_admission WHERE deployment = ? AND state = 'held' AND hold_until > ?", [this.deployment, now]);
      const tenant = active.filter(r => r.tenant_id === context.tenantId), node = configuration.budgets.node;
      const fits = (rows: SqlRow[], cap: typeof limits) => rows.length < cap.running
        && rows.reduce((n, r) => n + integer(r.working_bytes), limits.workingBytes) <= cap.workingBytes
        && rows.reduce((n, r) => n + integer(r.rss_bytes), limits.workerRssBytes) <= cap.workerRssBytes;
      if (!fits(tenant, limits)) throw new MetadataError('TENANT_BUDGET_EXCEEDED', 429);
      if (!fits(active, node) || input.class === 'query' && active.filter(r => r.class === 'query').length >= node.running - node.refreshSlots) throw new MetadataError('NODE_ADMISSION_REFUSED', 429);
      if (claim?.attempt_id) {
        const prior = (await c.query('SELECT state, revoked, lease_until, execution_deadline FROM sr_admission WHERE deployment = ? AND attempt_id = ? AND tenant_id = ? AND namespace_id = ? AND owner_id = ?', [this.deployment, claim.attempt_id, context.tenantId, context.namespaceId, context.userId]))[0];
        if (prior?.state === 'held' && integer(prior.revoked) === 0 && integer(prior.lease_until) > now && integer(prior.execution_deadline) > now) throw new MetadataError('BLAZE_BUSY', 409);
      }
      if (claim && (counter(claim.fence) === maximumFence || counter(claim.generation) === maximumFence)) throw new MetadataError('CLAIM_FENCE_EXHAUSTED', 503);
      if (input.class === 'refresh') {
        const timestamp = new Date(now).toISOString(), period = timestamp.slice(0, 10), args = [context.tenantId, context.namespaceId, period, 'computeAttempts'];
        await c.query('INSERT INTO h8_usage VALUES (?,?,?,?,0,0) ON CONFLICT (tenant_id, namespace_id, period, metric) DO NOTHING', args);
        const count = integer((await c.query('SELECT admitted FROM h8_usage WHERE tenant_id = ? AND namespace_id = ? AND period = ? AND metric = ?', args))[0]?.admitted);
        const denied = count >= entitlement.computeAttempts;
        await c.query(`UPDATE h8_usage SET ${denied ? 'denied = denied + 1' : 'admitted = admitted + 1'} WHERE tenant_id = ? AND namespace_id = ? AND period = ? AND metric = ?`, args);
        await c.query('INSERT INTO h8_usage_events VALUES (?,?,?,?,?,?,?,?)', [randomUUID(), context.tenantId, context.namespaceId, timestamp, 'computeAttempts', 'attempt', 1, denied ? 'denied' : 'admitted']);
        if (denied) return undefined;
      }
      const executionDeadline = now + Math.min(limits.executionMs, remaining - 3000);
      const holdUntil = now + remaining + 10000, leaseUntil = Math.min(executionDeadline, now + 30000);
      await c.query(`INSERT INTO sr_admission VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'held',0)`, [this.deployment, input.attemptId, token,
        context.tenantId, context.namespaceId, context.userId, input.class, configuration.epoch, configuration.revision,
        input.revisions.authorization, input.revisions.policy, input.revisions.configuration, limits.workingBytes, limits.workerRssBytes,
        executionDeadline, holdUntil, leaseUntil, now + 10000]);
      let fence: string | undefined, generation: string | undefined;
      if (input.claim) {
        if (claim) await c.query(`UPDATE sr_claim SET fence = fence + 1, generation = generation + 1, resource_version = ?, attempt_id = ?
          WHERE deployment = ? AND tenant_id = ? AND namespace_id = ? AND owner_id = ? AND kind = ? AND resource_id = ?`, [input.claim.expectedVersion, input.attemptId, ...this.claimValues({ context, input })]);
        else await c.query('INSERT INTO sr_claim VALUES (?,?,?,?,?,?,1,1,?,?)', [...this.claimValues({ context, input }), input.claim.expectedVersion, input.attemptId]);
        const allocated = await this.claim(c, { context, input }); fence = counter(allocated?.fence); generation = counter(allocated?.generation);
      }
      await admittedWork?.(c, this.details({ context, input, epoch: configuration.epoch, limits, fence, generation }));
      if (await coordinationNow(c, this.dialect) >= executionDeadline) throw new MetadataError('EXECUTION_CANCELLED', 409);
      return { configuration, limits, executionDeadline, holdUntil, leaseUntil, fence, generation };
    });
    if (!admitted) throw new MetadataError('USAGE_LIMIT_EXCEEDED', 429);
    const handle: AttemptHandle = Object.freeze({ attemptId: input.attemptId, token, executionDeadline: admitted.executionDeadline,
      holdUntil: admitted.holdUntil, leaseUntil: admitted.leaseUntil, ...(admitted.fence ? { fence: admitted.fence, generation: admitted.generation } : {}) });
    this.#attempts.set(handle, { context, input, token, epoch: admitted.configuration.epoch, limitsRevision: admitted.configuration.revision, limits: admitted.limits,
      ...(admitted.fence ? { fence: admitted.fence, generation: admitted.generation } : {}) });
    return handle;
  }
  private async live(c: SqlConnection, attempt: Attempt): Promise<SqlRow> {
    const configuration = await this.locked(c);
    if (configuration.epoch !== attempt.epoch || configuration.revision !== attempt.limitsRevision) throw new MetadataError('WORKSPACE_MAINTENANCE', 503);
    await this.authority(c, attempt.context, attempt.input);
    if (attempt.input.claim) {
      const claim = await this.claim(c, attempt);
      if (claim?.attempt_id !== attempt.input.attemptId || counter(claim?.fence) !== attempt.fence || counter(claim?.generation) !== attempt.generation
        || integer(claim?.resource_version) !== attempt.input.claim.expectedVersion) throw new MetadataError('CLAIM_LOST', 409);
    }
    const row = (await c.query(`SELECT state, revoked, lease_until, execution_deadline, next_renew FROM sr_admission WHERE ${attemptPredicate}`, this.attemptValues(attempt)))[0];
    if (!row || row.state !== 'held' || integer(row.revoked) !== 0) throw new MetadataError('ATTEMPT_REVOKED', 409);
    this.unexpired(row, await coordinationNow(c, this.dialect)); return row;
  }
  private unexpired(row: SqlRow, now: number): void {
    if (integer(row.lease_until) <= now || integer(row.execution_deadline) <= now) throw new MetadataError('ATTEMPT_EXPIRED', 409);
  }
  async renew(handle: AttemptHandle): Promise<number> {
    const attempt = this.handle(handle);
    return this.transaction(async c => {
      const row = await this.live(c, attempt), now = await coordinationNow(c, this.dialect); this.unexpired(row, now);
      if (now < integer(row.next_renew)) return integer(row.lease_until);
      const lease = Math.min(integer(row.execution_deadline), now + 30000);
      await c.query(`UPDATE sr_admission SET lease_until = ?, next_renew = ? WHERE ${attemptPredicate}`, [lease, now + 10000, ...this.attemptValues(attempt)]);
      return lease;
    });
  }
  async publish<T>(handle: AttemptHandle, work: (c: SqlConnection) => Promise<T>): Promise<T> {
    const attempt = this.handle(handle);
    return this.transaction(async c => {
      const row = await this.live(c, attempt), result = await work(c);
      this.unexpired(row, await coordinationNow(c, this.dialect)); return result;
    });
  }
  private async retire(handle: AttemptHandle, release: boolean): Promise<void> {
    const attempt = this.handle(handle);
    await this.transaction(async c => {
      await this.locked(c, false);
      // Lock order is retained, but cleanup must work after membership revocation.
      await c.query('UPDATE h1_tenants SET version = version WHERE tenant_id = ?', [attempt.context.tenantId]);
      const claim = attempt.input.claim ? await this.claim(c, attempt) : undefined;
      const row = (await c.query(`SELECT state, revoked FROM sr_admission WHERE ${attemptPredicate}`, this.attemptValues(attempt)))[0];
      if (!row || row.state === 'released' || !release && integer(row.revoked) !== 0) return;
      if (claim?.attempt_id === attempt.input.attemptId) {
        const advance = !release && counter(claim.fence) !== maximumFence;
        await c.query(`UPDATE sr_claim SET attempt_id = NULL${advance ? ', fence = fence + 1' : ''} WHERE deployment = ? AND tenant_id = ? AND namespace_id = ? AND owner_id = ? AND kind = ? AND resource_id = ? AND attempt_id = ?`, [...this.claimValues(attempt), attempt.input.attemptId]);
      }
      await c.query(`UPDATE sr_admission SET ${release ? "state = 'released'" : 'revoked = 1'} WHERE ${attemptPredicate}`, this.attemptValues(attempt));
    });
  }
  revoke(handle: AttemptHandle): Promise<void> { return this.retire(handle, false); }
  /** Only after the owning invocation has confirmed worker/socket exit. */
  release(handle: AttemptHandle): Promise<void> { return this.retire(handle, true); }
}
