import { createHmac } from 'node:crypto';
import { MetadataError, type Database, type SqlConnection } from './metadata-db.js';
import { hostedConfig, type HostedConfig } from './hosted-config.js';
import { digest, equal, hashPassword, passwordInput, seal } from './auth-crypto.js';
import { normalizedEmail } from './hosted-auth.js';
import { canonical, checksum } from './metadata-operator.js';
import { identifier, object, insertResource } from './metadata-resources.js';
import { appendMetadataEvent } from './metadata-outbox.js';
import { budgetEnvironment } from './budget-store.js';
import { appendOperatorAudit, entitlementConfig } from './hosted-usage.js';
import { deploymentId } from './runtime-startup.js';
import { serverlessTables } from './serverless-migration.js';
import { coordinationChecksum, type CoordinationDialect } from './coordination-schema.js';
import { manifestChecksum } from './manifest-schema.js';
import { dispatchChecksum } from './dispatch-schema.js';
import { objectChecksum } from './object-schema.js';
import { operationChecksum } from './operation-schema.js';

interface InitialTester { tenantId: string; namespaceId: string; userId: string; subject: string; email: string; name: string; password: string; totpSecret: string }
export type InitialCommand = { version: 1; command: 'bootstrap-initial'; operationId: string; testers: InitialTester[] }
  | { version: 1; command: 'activate-initial'; operationId: string; expectedEpoch: 1; releaseDigest: string };
export type InitialResult = { state: 'bootstrapped'; epoch: 1; tenants: 2 } | { state: 'active'; epoch: 1 };
function fail(code = 'INITIAL_ACTIVATION_INVALID'): never { throw new MetadataError(code, 503); }
const markers = [['sr_coordination_schema', coordinationChecksum], ['sr_manifest_schema', manifestChecksum], ['sr_dispatch_schema', dispatchChecksum], ['sr_object_schema', objectChecksum], ['sr_operation_schema', operationChecksum]] as const;
const workTables = serverlessTables.filter(t => t.startsWith('sr_') && !t.endsWith('_schema') && !['sr_control', 'sr_limits'].includes(t));
const hmac = (config: HostedConfig, value: unknown) => createHmac('sha256', config.encryptionKey).update(canonical(value)).digest('hex');
const receipt = async (c: SqlConnection, id: string) => (await c.query('SELECT request_hash FROM h2_requests WHERE operation_id = ?', [id]))[0]?.request_hash;
const tenantOperation = (deployment: string, operationId: string, index: number) => checksum(['initial-bootstrap-tenant', deployment, operationId, index]);

/** Validate private authority and the entire command before constructing SQL. */
export function initialCommand(raw: unknown, env: NodeJS.ProcessEnv): InitialCommand {
  if (env.OPENSIGHT_RUNTIME !== 'lambda' || env.OPENSIGHT_MODE !== 'hosted' || env.OPENSIGHT_REFERENCE !== undefined || env.OPENSIGHT_SERVERLESS_DATA !== 'durable') fail('INITIAL_ACTIVATION_DISABLED');
  if (env.OPENSIGHT_MAINTENANCE !== 'frozen') fail('WORKSPACE_MAINTENANCE_REQUIRED');
  const config = hostedConfig(env), input = object(raw);
  if (typeof input.authorization !== 'string' || !equal(input.authorization, `Operator ${config.operatorKey.toString('base64url')}`)) throw new MetadataError('OPERATOR_REQUIRED', 403);
  deploymentId(env);
  if (input.version !== 1) fail();
  const operationId = identifier(input.operationId);
  if (input.command === 'activate-initial') {
    object(input, ['command', 'authorization', 'version', 'operationId', 'expectedEpoch', 'releaseDigest']);
    if (input.expectedEpoch !== 1 || typeof input.releaseDigest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(input.releaseDigest) || input.releaseDigest !== env.OPENSIGHT_RELEASE_DIGEST) fail();
    return { command: input.command, version: 1, operationId, expectedEpoch: 1, releaseDigest: input.releaseDigest };
  }
  object(input, ['command', 'authorization', 'version', 'operationId', 'testers']);
  if (input.command !== 'bootstrap-initial' || !Array.isArray(input.testers) || input.testers.length !== 2) fail();
  const testers = input.testers.map(raw => {
    const t = object(raw, ['tenantId', 'namespaceId', 'userId', 'subject', 'email', 'name', 'password', 'totpSecret']);
    if (typeof t.name !== 'string' || !t.name.trim() || t.name.length > 512 || /[\x00-\x1f\x7f]/.test(t.name) || typeof t.totpSecret !== 'string') fail();
    const bytes = Buffer.from(t.totpSecret, 'base64');
    if (bytes.length !== 20 || bytes.toString('base64') !== t.totpSecret) fail();
    return { tenantId: identifier(t.tenantId), namespaceId: identifier(t.namespaceId), userId: identifier(t.userId), subject: identifier(t.subject),
      email: normalizedEmail(t.email), name: t.name, password: passwordInput(t.password), totpSecret: t.totpSecret };
  });
  const ids = testers.flatMap(t => [t.tenantId, t.namespaceId, t.userId, t.subject]);
  if (new Set(ids).size !== ids.length || testers[0]!.email === testers[1]!.email) fail();
  return { command: input.command, version: 1, operationId, testers };
}

async function inspect(c: SqlConnection, env: NodeJS.ProcessEnv, dialect: CoordinationDialect): Promise<string> {
  const deployment = deploymentId(env), lock = dialect === 'postgres' ? ' FOR UPDATE' : '';
  const tables = await c.query(dialect === 'postgres'
    ? "SELECT c.relname AS name, CASE WHEN c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user) THEN 1 ELSE 0 END AS owned FROM pg_class c WHERE c.relnamespace = current_schema()::regnamespace AND c.relkind IN ('r','p')"
    : "SELECT name, 1 AS owned FROM sqlite_master WHERE type = 'table'");
  if (tables.length !== serverlessTables.length || serverlessTables.some(name => !tables.some(t => t.name === name && Number(t.owned) === 1))) fail('INITIAL_SCHEMA_NOT_OWNED');
  if (dialect === 'postgres') {
    // Empty-database checks must see every tenant, even under FORCE RLS. Schema
    // ownership alone does not imply bypass on managed PostgreSQL.
    const role = (await c.query('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user'))[0];
    if (!role?.rolsuper && !role?.rolbypassrls) fail('INITIAL_OWNER_RLS_REQUIRED');
  }
  const controls = await c.query(`SELECT * FROM sr_control${lock}`), row = controls[0];
  if (controls.length !== 1 || row?.deployment !== deployment || Number(row.epoch) !== 1 || !['schema_min', 'schema_max', 'protocol_min', 'protocol_max'].every(k => Number(row[k]) === 1)) fail('INITIAL_EPOCH_REQUIRED');
  const authControl = await c.query('UPDATE h2_control SET id = id WHERE id = 1 RETURNING id');
  if (authControl.length !== 1) fail('INITIAL_SCHEMA_INVALID');
  for (const [table, expected] of markers) {
    const rows = await c.query(`SELECT * FROM ${table}`);
    if (rows.length !== 1 || rows[0]?.deployment !== deployment || Number(rows[0]?.version) !== 1 || rows[0]?.checksum !== expected) fail('INITIAL_SCHEMA_INVALID');
  }
  if (Number((await c.query('SELECT version FROM h8_schema WHERE id = 1'))[0]?.version) !== 1) fail('INITIAL_SCHEMA_INVALID');
  const budget = (await c.query('SELECT version, body FROM h4_budget_config WHERE id = 1'))[0];
  const limits = (await c.query('SELECT budget_version, entitlements FROM sr_limits WHERE deployment = ?', [deployment]))[0];
  if (!budget || !limits || Number(limits.budget_version) !== Number(budget.version) || canonical(JSON.parse(String(budget.body))) !== canonical(budgetEnvironment(env))
    || canonical(JSON.parse(String(limits.entitlements))) !== canonical(entitlementConfig(env.OPENSIGHT_ENTITLEMENTS))) fail('COORDINATION_CONFIG_CHANGED');
  return String(row.state);
}
async function key(c: SqlConnection, config: HostedConfig, allowEmpty: boolean): Promise<void> {
  const keys = await c.query('SELECT * FROM h2_keys');
  if (!keys.length && allowEmpty) return;
  if (keys.length !== 1 || keys[0]?.key_id !== config.keyId || Number(keys[0]?.active) !== 1 || keys[0]?.fingerprint !== digest(config.signingKey)) fail('INITIAL_AUTH_KEY_INVALID');
}
async function empty(c: SqlConnection, tables: readonly string[]): Promise<void> {
  for (const table of tables) if ((await c.query(`SELECT 1 FROM ${table} LIMIT 1`)).length) fail('INITIAL_DATABASE_NOT_EMPTY');
}
async function verifyTesters(c: SqlConnection, deployment: string, operationId: string, requestHash: string): Promise<void> {
  for (const table of ['h1_tenants', 'h1_namespaces', 'h1_resources', 'h1_revisions', 'h1_operations', 'h2_identities', 'h2_memberships']) {
    if (Number((await c.query(`SELECT COUNT(*) AS count FROM ${table}`))[0]?.count) !== 2) fail('INITIAL_TESTERS_CHANGED');
  }
  for (let index = 0; index < 2; index++) {
    const rows = await c.query(`SELECT o.request_hash, o.action, o.status AS operation_status, o.step, t.state,
      m.status AS membership_status, i.status AS identity_status, i.password_hash, i.totp_secret, u.body
      FROM h1_operations o JOIN h1_tenants t ON t.tenant_id = o.tenant_id
      JOIN h2_memberships m ON m.tenant_id = o.tenant_id AND m.namespace_id = o.namespace_id
      JOIN h2_identities i ON i.subject = m.subject
      JOIN h1_resources u ON u.tenant_id = m.tenant_id AND u.namespace_id = m.namespace_id AND u.kind = 'user' AND u.owner_id = '' AND u.resource_id = m.user_id
      WHERE o.operation_id = ?`, [tenantOperation(deployment, operationId, index)]);
    const t = rows[0];
    if (rows.length !== 1 || t?.request_hash !== requestHash || t.action !== 'provision' || t.operation_status !== 'complete' || t.step !== 'active' || t.state !== 'active'
      || t.membership_status !== 'active' || t.identity_status !== 'active' || !t.password_hash || !t.totp_secret || JSON.parse(String(t.body)).role !== 'administrator') fail('INITIAL_TESTERS_CHANGED');
  }
}

/** Initial epoch only. No HTTP route, credential response, email, or general reopen. */
export async function initialAdministration(database: Database, env: NodeJS.ProcessEnv, input: InitialCommand, dialect: CoordinationDialect = 'postgres'): Promise<InitialResult> {
  const config = hostedConfig(env), deployment = deploymentId(env);
  if (!database.durable || env.OPENSIGHT_MAINTENANCE !== 'frozen' || !['postgres', 'sqlite'].includes(dialect)) fail('INITIAL_ACTIVATION_DISABLED');
  const selectionId = checksum(['initial-bootstrap-selection', deployment]), selectionHash = checksum(['bootstrap-selection', input.operationId]);
  const bootstrapId = checksum(['initial-bootstrap', deployment, input.operationId]), activationId = checksum(['activate-initial', deployment]);
  // Password derivations own no SQL transaction or idle database connection.
  const prepared: { passwordHash: string; totp: string }[] = [];
  if (input.command === 'bootstrap-initial') for (const tester of input.testers) prepared.push({ passwordHash: await hashPassword(tester.password), totp: seal(tester.totpSecret, config.encryptionKey, `totp:${tester.subject}`) });
  return database.transaction(async c => {
    const state = await inspect(c, env, dialect);
    const selected = await receipt(c, selectionId), prior = await receipt(c, bootstrapId), requestHash = hmac(config, input);
    if (input.command === 'bootstrap-initial') {
      if (state !== 'maintenance' || await receipt(c, activationId)) fail('INITIAL_MAINTENANCE_REQUIRED');
      await key(c, config, !selected);
      if (selected || prior) {
        if (selected !== selectionHash || prior !== requestHash) fail('INITIAL_BOOTSTRAP_CONFLICT');
        await verifyTesters(c, deployment, input.operationId, requestHash);
        return { state: 'bootstrapped', epoch: 1, tenants: 2 };
      }
      await empty(c, [...workTables, 'h1_tenants', 'h1_resources', 'h1_operations', 'h1_outbox', 'h2_identities', 'h2_memberships', 'h2_invitations', 'h2_sessions', 'h2_onboarding', 'h2_requests', 'h7_jobs', 'h8_usage', 'h8_usage_events', 'h8_recovery']);
      for (let index = 0; index < input.testers.length; index++) {
        const t = input.testers[index]!, credential = prepared[index]!, scope = { tenantId: t.tenantId, namespaceId: t.namespaceId };
        await c.query("INSERT INTO h1_tenants VALUES (?, 'active', 2, NULL, NULL, NULL)", [t.tenantId]);
        await c.query('INSERT INTO h1_namespaces VALUES (?,?,?)', [t.namespaceId, t.tenantId, t.name]);
        await c.query('INSERT INTO h1_revisions VALUES (?,?,1,1,1)', [t.tenantId, t.namespaceId]);
        await insertResource(c, scope, { kind: 'user', id: t.userId }, { name: t.name, role: 'administrator' });
        await c.query("INSERT INTO h2_identities (subject,email,password_hash,totp_secret,status) VALUES (?,?,?,?,'active')", [t.subject, t.email, credential.passwordHash, credential.totp]);
        await c.query("INSERT INTO h2_memberships (subject,tenant_id,namespace_id,user_id,status) VALUES (?,?,?,?,'active')", [t.subject, t.tenantId, t.namespaceId, t.userId]);
        await c.query("INSERT INTO h1_operations VALUES (?,?,?,'provision',?,'complete','active')", [tenantOperation(deployment, input.operationId, index), t.tenantId, t.namespaceId, requestHash]);
        await appendMetadataEvent(c, scope, 'tenant.active');
      }
      if (!(await c.query('SELECT 1 FROM h2_keys')).length) await c.query('INSERT INTO h2_keys VALUES (?,?,1)', [config.keyId, digest(config.signingKey)]);
      for (const [id, hash] of [[selectionId, selectionHash], [bootstrapId, requestHash]]) await c.query('INSERT INTO h2_requests VALUES (?,?)', [id!, hash!]);
      await appendOperatorAudit(c, 'runtime.initial-bootstrapped');
      return { state: 'bootstrapped', epoch: 1, tenants: 2 };
    }
    if (input.expectedEpoch !== 1 || input.releaseDigest !== env.OPENSIGHT_RELEASE_DIGEST || selected !== selectionHash || typeof prior !== 'string') fail('INITIAL_BOOTSTRAP_REQUIRED');
    await key(c, config, false);
    const activated = await receipt(c, activationId);
    if (activated) {
      if (activated !== requestHash || state !== 'open') fail('INITIAL_ACTIVATION_CONFLICT');
      return { state: 'active', epoch: 1 };
    }
    if (state !== 'maintenance') fail('INITIAL_MAINTENANCE_REQUIRED');
    await verifyTesters(c, deployment, input.operationId, prior);
    await empty(c, [...workTables, 'h7_jobs', 'h2_sessions', 'h8_usage', 'h8_usage_events']);
    await c.query("UPDATE sr_control SET state = 'open' WHERE deployment = ? AND epoch = 1 AND state = 'maintenance'", [deployment]);
    await c.query('INSERT INTO h2_requests VALUES (?,?)', [activationId, requestHash]);
    await appendOperatorAudit(c, 'runtime.initial-activated');
    return { state: 'active', epoch: 1 };
  });
}
