import { randomUUID } from 'node:crypto';
import { Resolver } from 'node:dns/promises';
import { connect, type TLSSocket } from 'node:tls';
import { access, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { SendMessageCommand, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { CreateScheduleCommand, DeleteScheduleCommand } from '@aws-sdk/client-scheduler';
import { MetadataError, PostgresMetadataDatabase } from './metadata-db.js';
import { InvocationScope, invocationDeadline, type InvocationContext } from './runtime-scope.js';
import { InvocationAws, awsEnvironment, databaseUrl, operatorFields } from './runtime-aws.js';
import { InvocationPool } from './runtime-postgres.js';
import { migrateRuntime } from './runtime-migration.js';
import { smtpFromEnvironment, emailAddress } from './mail.js';
import { TenantBudgets } from './budgets.js';
import { budgetEnvironment } from './budget-store.js';
import { containedWork } from './contained-work.js';
import { blazeLimits } from './blaze.js';
import { createRuntime } from './runtime.js';
import { ingressConfig } from './runtime-ingress.js';

export const probeCommands = ['network', 'mail', 'bootstrap', 'database', 'native', 'startup'] as const;
export type ProbeCommand = typeof probeCommands[number];
const fail = (code: string): never => { throw new MetadataError(code, 503); };
export function probeFailure(error: unknown): MetadataError {
  if (error instanceof MetadataError) return new MetadataError(error.code, 503);
  // SQLSTATE is safe diagnostic evidence; SQL text, detail and credentials are not.
  if (error && typeof error === 'object' && 'severity' in error && 'code' in error
    && ['ERROR', 'FATAL', 'PANIC'].includes(String(error.severity)) && typeof error.code === 'string' && error.code.length === 5 && /^[A-Z0-9]{5}$/.test(error.code)) {
    return new MetadataError(`PROBE_SQL_${error.code}`, 503);
  }
  return new MetadataError('PROBE_FAILED', 503);
}
export function probeCommand(raw: unknown, env: NodeJS.ProcessEnv): ProbeCommand {
  if (env.OPENSIGHT_VALIDATION !== 'isolated' || env.OPENSIGHT_MAINTENANCE !== 'frozen' || env.OPENSIGHT_RUNTIME !== 'lambda' || env.OPENSIGHT_MODE !== 'hosted') return fail('PROBE_DISABLED');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).sort().join() !== 'command,version') return fail('PROBE_COMMAND_INVALID');
  const input = raw as Record<string, unknown>;
  if (input.version !== 1 || !probeCommands.includes(input.command as ProbeCommand)) return fail('PROBE_COMMAND_INVALID');
  return input.command as ProbeCommand;
}
async function tlsCheck(scope: InvocationScope, host: string): Promise<void> {
  // DNS and the actual TLS socket independently prove the selected family.
  const resolver = new Resolver({ timeout: 1000, tries: 1 });
  const addresses = await scope.stage(() => resolver.resolve6(host), 2000, () => resolver.cancel(), 'PROBE_DNS_FAILED');
  if (!addresses.length) fail('PROBE_IPV6_REQUIRED');
  const socket = connect({ host: addresses[0]!, port: 443, servername: host, rejectUnauthorized: true, minVersion: 'TLSv1.2' });
  await probeTlsSocket(scope, socket);
}
export async function probeTlsSocket(scope: InvocationScope, socket: TLSSocket, timeoutMs = 3000): Promise<void> {
  const closed = new Promise<void>(resolve => socket.once('close', () => resolve()));
  scope.own({ force: () => socket.destroy(), close: async () => { socket.destroy(); await closed; } });
  await scope.stage(() => new Promise<void>((resolve, reject) => {
    socket.once('error', () => reject(new MetadataError('PROBE_TLS_FAILED', 503)));
    // destroy() during a blackholed connect can emit only close, not error.
    // Settle the tracked work as well as its socket so cleanup can complete.
    socket.once('close', () => reject(new MetadataError('PROBE_TLS_FAILED', 503)));
    socket.once('secureConnect', () => socket.authorized && socket.remoteFamily === 'IPv6' ? resolve() : reject(new MetadataError('PROBE_IPV6_REQUIRED', 503)));
  }), timeoutMs, () => socket.destroy(), 'PROBE_TLS_TIMEOUT');
  socket.destroy(); await closed;
}
function destinations(env: NodeJS.ProcessEnv, aws: InvocationAws) {
  const bucket = env.OPENSIGHT_ARTIFACT_BUCKET, queue = env.OPENSIGHT_PROBE_QUEUE_URL;
  const group = env.OPENSIGHT_PROBE_SCHEDULE_GROUP, role = env.OPENSIGHT_PROBE_SCHEDULE_ROLE_ARN, deployment = env.OPENSIGHT_DEPLOYMENT;
  if (!deployment || !/^[a-z][a-z0-9-]{0,35}$/.test(deployment) || !bucket || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)
    || group !== `${deployment}-probe` || !role || !/^arn:aws:iam::\d{12}:role\/[A-Za-z0-9_-]+$/.test(role)) return fail('PROBE_CONFIG_INVALID');
  const match = new RegExp(`^https://sqs\\.${aws.region}\\.(?:amazonaws\\.com|api\\.aws)/(\\d{12})/(${deployment}-probe)$`).exec(queue ?? '');
  if (!match || role.split(':')[4] !== match[1]) return fail('PROBE_CONFIG_INVALID');
  return { bucket, queue: queue!, group, role, queueArn: `arn:aws:sqs:${aws.region}:${match[1]}:${match[2]}` };
}
async function network(scope: InvocationScope, aws: InvocationAws, env: NodeJS.ProcessEnv): Promise<void> {
  const dest = destinations(env, aws), id = randomUUID(), key = `probe/${id}`, bytes = Buffer.from(`opensight-probe:${id}`);
  for (const host of [aws.hosts.secrets, aws.hosts.sqs, aws.hosts.scheduler]) await tlsCheck(scope, host);
  await aws.secret(env.OPENSIGHT_TENANT_SECRET_ARN, ['username', 'password']);
  let version: string | undefined, uploaded = false, scheduled = false;
  try {
    const put = await aws.call(signal => aws.s3.send(new PutObjectCommand({ Bucket: dest.bucket, Key: key, Body: bytes, ServerSideEncryption: 'AES256' }), { abortSignal: signal }));
    version = put.VersionId; uploaded = true;
    await aws.call(async signal => {
      const object = await aws.s3.send(new GetObjectCommand({ Bucket: dest.bucket, Key: key, VersionId: version }), { abortSignal: signal });
      if (object.ContentLength !== bytes.length || !object.Body || !Buffer.from(await object.Body.transformToByteArray()).equals(bytes)) fail('PROBE_OBJECT_MISMATCH');
    });
    const sent = await aws.call(signal => aws.sqs.send(new SendMessageCommand({ QueueUrl: dest.queue, MessageBody: id }), { abortSignal: signal }));
    // This queue belongs only to validation; an unexpected message is never deleted.
    const received = await aws.call(signal => aws.sqs.send(new ReceiveMessageCommand({ QueueUrl: dest.queue, MaxNumberOfMessages: 1, WaitTimeSeconds: 2, VisibilityTimeout: 10 }), { abortSignal: signal }));
    const message = received.Messages?.[0];
    if (!sent.MessageId || message?.MessageId !== sent.MessageId || message.Body !== id || !message.ReceiptHandle) fail('PROBE_QUEUE_MISMATCH');
    await aws.call(signal => aws.sqs.send(new DeleteMessageCommand({ QueueUrl: dest.queue, ReceiptHandle: message!.ReceiptHandle! }), { abortSignal: signal }));
    await aws.call(signal => aws.scheduler.send(new CreateScheduleCommand({ Name: id, GroupName: dest.group, State: 'DISABLED',
      ScheduleExpression: `at(${new Date(Date.now() + 3600000).toISOString().slice(0, 19)})`, ScheduleExpressionTimezone: 'UTC',
      FlexibleTimeWindow: { Mode: 'OFF' }, ActionAfterCompletion: 'DELETE', ClientToken: id,
      Target: { Arn: dest.queueArn, RoleArn: dest.role, Input: JSON.stringify({ synthetic: id }), RetryPolicy: { MaximumRetryAttempts: 0, MaximumEventAgeInSeconds: 60 } } }), { abortSignal: signal }));
    scheduled = true;
  } finally {
    // Each cleanup is independent. A failed cleanup fails the invocation and is recorded by the harness.
    const cleanup = await Promise.allSettled([
      scheduled ? aws.call(signal => aws.scheduler.send(new DeleteScheduleCommand({ Name: id, GroupName: dest.group }), { abortSignal: signal })) : Promise.resolve(),
      uploaded ? aws.call(signal => aws.s3.send(new DeleteObjectCommand({ Bucket: dest.bucket, Key: key, VersionId: version }), { abortSignal: signal })) : Promise.resolve(),
    ]);
    if (cleanup.some(r => r.status === 'rejected')) fail('PROBE_CLEANUP_FAILED');
  }
}
async function mail(scope: InvocationScope, aws: InvocationAws, env: NodeJS.ProcessEnv): Promise<void> {
  if (!emailAddress(env.OPENSIGHT_PROBE_MAIL_TO) || !emailAddress(env.OPENSIGHT_PROBE_MAIL_FROM)) fail('PROBE_MAIL_CONFIG_INVALID');
  const secret = await aws.secret(env.OPENSIGHT_SMTP_SECRET_ARN, ['username', 'password']);
  const transport = smtpFromEnvironment({ OPENSIGHT_SMTP_HOST: aws.hosts.smtp, OPENSIGHT_SMTP_FROM: env.OPENSIGHT_PROBE_MAIL_FROM,
    OPENSIGHT_SMTP_PORT: '465', OPENSIGHT_SMTP_USER: secret.username, OPENSIGHT_SMTP_PASSWORD: secret.password }, {
    signal: scope.signal, timeoutMs: 10000, family: 6, ownSocket: socket => {
      const closed = new Promise<void>(resolve => socket.once('close', () => resolve()));
      scope.own({ force: () => socket.destroy(), close: async () => { socket.destroy(); await closed; } });
      socket.once('secureConnect', () => { if (socket.remoteFamily !== 'IPv6') socket.destroy(new Error('PROBE_IPV6_REQUIRED')); });
    },
  });
  await transport.send({ to: [env.OPENSIGHT_PROBE_MAIL_TO!], subject: 'OpenSight isolated platform validation', html: '<p>Synthetic SMTP transport check. No application data.</p>' });
}
export function probeRoleNames(env: NodeJS.ProcessEnv): { operator: string; tenant: string } {
  const deployment = env.OPENSIGHT_DEPLOYMENT;
  if (!deployment || !/^[a-z][a-z0-9-]{0,35}$/.test(deployment)) return fail('PROBE_CONFIG_INVALID');
  const prefix = deployment.replaceAll('-', '_');
  return { operator: `${prefix}_operator`, tenant: `${prefix}_tenant` };
}
async function bootstrap(scope: InvocationScope, aws: InvocationAws, source: NodeJS.ProcessEnv): Promise<void> {
  const env = await awsEnvironment(aws, source, true), names = probeRoleNames(env);
  const [operator, tenant] = await Promise.all([aws.secret(source.OPENSIGHT_OPERATOR_SECRET_ARN, operatorFields), aws.secret(source.OPENSIGHT_TENANT_SECRET_ARN, ['username', 'password'])]);
  if (operator.username !== names.operator || tenant.username !== names.tenant) fail('PROBE_ROLE_INVALID');
  const pool = new InvocationPool(scope, { connectionString: env.OPENSIGHT_POSTGRES_OPERATOR_URL, ssl: { ca: env.OPENSIGHT_POSTGRES_CA, rejectUnauthorized: true } }, 18000);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const control = (await client.query("SELECT to_regclass('public.sr_control') AS table")).rows[0]?.table;
    if (control) {
      const deployments = (await client.query('SELECT deployment, state FROM sr_control')).rows;
      if (deployments.length !== 1 || deployments[0]?.deployment !== env.OPENSIGHT_DEPLOYMENT || deployments[0]?.state !== 'maintenance') fail('PROBE_FOREIGN_DATABASE');
    } else if ((await client.query("SELECT 1 FROM pg_tables WHERE schemaname = 'public'")).rows.length) fail('PROBE_FOREIGN_DATABASE');
    for (const [kind, login] of [['operator', operator], ['tenant', tenant]] as const) {
      const name = login.username!, marker = `opensight:${env.OPENSIGHT_DEPLOYMENT}:${kind}`, bypass = kind === 'operator';
      const existing = (await client.query(`SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolinherit,
        shobj_description(oid, 'pg_authid') AS marker FROM pg_roles WHERE rolname = $1`, [name])).rows[0];
      if (existing && (existing.marker !== marker || !existing.rolcanlogin || existing.rolsuper || existing.rolcreatedb || existing.rolcreaterole || existing.rolreplication || existing.rolinherit || Boolean(existing.rolbypassrls) !== bypass)) fail('PROBE_ROLE_UNSAFE');
      if ((await client.query('SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = $1', [name])).rows.length) fail('PROBE_ROLE_UNSAFE');
      const password = (await client.query('SELECT quote_literal($1) AS literal', [login.password])).rows[0]?.literal;
      if (typeof password !== 'string') fail('PROBE_ROLE_INVALID');
      await client.query(`${existing ? 'ALTER' : 'CREATE'} ROLE "${name}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION ${bypass ? 'BYPASSRLS' : 'NOBYPASSRLS'} CONNECTION LIMIT 4 PASSWORD ${password}`);
      if (!existing) await client.query(`COMMENT ON ROLE "${name}" IS '${marker}'`);
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
  await migrateRuntime(new PostgresMetadataDatabase(pool), env);
  const grants = await pool.connect();
  try {
    await grants.query('BEGIN');
    await grants.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    for (const name of [names.operator, names.tenant]) {
      await grants.query(`GRANT USAGE ON SCHEMA public TO "${name}"`);
      if (name === names.operator) {
        await grants.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${name}"`);
        await grants.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${name}"`);
      } else {
        await grants.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON h1_tenants, h1_namespaces, h1_revisions, h1_resources, h1_links, h1_operations, h1_outbox TO "${name}"`);
        await grants.query(`GRANT SELECT ON sr_control TO "${name}"`);
      }
    }
    await grants.query('COMMIT');
  } catch (error) { await grants.query('ROLLBACK'); throw error; } finally { grants.release(); }
}
async function database(scope: InvocationScope, aws: InvocationAws, source: NodeJS.ProcessEnv): Promise<void> {
  const env = await awsEnvironment(aws, source);
  const pool = new InvocationPool(scope, { connectionString: env.OPENSIGHT_POSTGRES_TENANT_URL, ssl: { ca: env.OPENSIGHT_POSTGRES_CA, rejectUnauthorized: true } }, 18000);
  const client = await pool.connect(), id = `probe-${randomUUID()}`;
  try {
    if (!(await client.query('SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()')).rows[0]?.ssl) fail('PROBE_DATABASE_TLS_REQUIRED');
    const unsafe = await client.query(`SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication)
      UNION ALL SELECT 1 FROM pg_class WHERE relname LIKE 'h1_%' AND pg_has_role(current_user, relowner, 'MEMBER')
      UNION ALL SELECT 1 FROM pg_auth_members WHERE member = (SELECT oid FROM pg_roles WHERE rolname = current_user)`);
    if (unsafe.rows.length) fail('PROBE_ROLE_UNSAFE');
    if ((await client.query("SELECT state FROM sr_control WHERE deployment = $1", [env.OPENSIGHT_DEPLOYMENT])).rows[0]?.state !== 'maintenance') fail('PROBE_MAINTENANCE_REQUIRED');
    await client.query('BEGIN');
    for (const suffix of ['a', 'b']) {
      const tenant = `${id}-${suffix}`;
      await client.query("SELECT set_config('opensight.tenant_id',$1,true), set_config('opensight.namespace_id',$1,true)", [tenant]);
      await client.query("INSERT INTO h1_tenants (tenant_id,state,version) VALUES ($1,'active',1)", [tenant]);
      await client.query("INSERT INTO h1_namespaces VALUES ($1,$1,'synthetic')", [tenant]);
      await client.query("INSERT INTO h1_resources VALUES ($1,$1,'dashboard','',$1,'{}',1)", [tenant]);
    }
    await client.query("SELECT set_config('opensight.tenant_id',$1,true), set_config('opensight.namespace_id',$1,true)", [`${id}-a`]);
    const rows = (await client.query('SELECT resource_id FROM h1_resources')).rows;
    if (rows.length !== 1 || rows[0]?.resource_id !== `${id}-a`) fail('PROBE_RLS_BYPASS');
    await client.query('SAVEPOINT denied');
    let denied = false;
    try { await client.query("UPDATE h1_resources SET tenant_id = $1 WHERE resource_id = $2", [`${id}-b`, `${id}-a`]); }
    catch (error) { denied = (error as { code?: string }).code === '42501'; }
    await client.query('ROLLBACK TO SAVEPOINT denied');
    if (!denied) fail('PROBE_RLS_BYPASS');
    await client.query("SELECT set_config('opensight.namespace_id','',true)");
    if ((await client.query('SELECT resource_id FROM h1_resources')).rows.length) fail('PROBE_RLS_BYPASS');
    await client.query('ROLLBACK');
    if ((await client.query('SELECT resource_id FROM h1_resources')).rows.length) fail('PROBE_SCOPE_LEAK');
  } finally { try { await client.query('ROLLBACK'); } finally { client.release(); } }
}
async function native(scope: InvocationScope, env: NodeJS.ProcessEnv): Promise<void> {
  if (process.platform !== 'linux' || process.arch !== 'arm64') fail('PROBE_PLATFORM_INVALID');
  const budgets = new TenantBudgets(budgetEnvironment(env), () => {}), context = { tenantId: 'synthetic', namespaceId: 'synthetic', userId: 'probe', authorizationRevision: 1 };
  scope.own({ close: () => budgets.shutdown(), force: () => budgets.close() });
  const source = { id: 'native', connectorId: 'file', table: 'native_rows', columns: [{ name: 'amount', type: 'INTEGER' as const }], security: 'unrestricted' as const };
  const result = await budgets.run(context, false, async () => {}, () => containedWork(budgets.current(context), {
    kind: 'prep', pipeline: { version: 1, input: 'native', steps: [] }, sources: [source], datasets: [], id: 'prepared', tables: [{ source, rows: [[1], [2]] }],
  }, blazeLimits()), scope.signal);
  if (JSON.stringify(result.rows) !== '[[1],[2]]' || budgets.node().running || budgets.node().queued) fail('PROBE_NATIVE_FAILED');
  await writeFile(join(await scope.temporaryDirectory(), 'synthetic'), 'cleanup');
}
async function startup(scope: InvocationScope, aws: InvocationAws, source: NodeJS.ProcessEnv, context: InvocationContext): Promise<void> {
  const env = await awsEnvironment(aws, source), config = ingressConfig(env), [id, secret] = [...config.keys][0]!;
  const response = await createRuntime(() => env).lambda({ version: '2.0', routeKey: '$default', rawPath: '/api/api/startup', rawQueryString: '', isBase64Encoded: false, body: '{}',
    headers: { host: config.domain, 'content-type': 'application/json', 'cloudfront-viewer-address': '192.0.2.1:443',
      'x-opensight-ingress-key-id': id, 'x-opensight-ingress-secret': secret, 'x-opensight-ingress-origin': config.origin },
    requestContext: { routeKey: '$default', apiId: config.apiId, stage: config.stage, domainName: config.domain, timeEpoch: Date.now(),
      http: { method: 'POST', path: '/api/api/startup' }, authorizer: { lambda: { version: '1', canonicalOrigin: config.origin } } },
  }, context);
  scope.check();
  if (response.statusCode !== 503 || !['WORKSPACE_MAINTENANCE', 'WORKSPACE_STARTING'].includes(JSON.parse(response.body).errorCode)) fail('PROBE_STARTUP_UNEXPECTED');
}
/** IAM-only diagnostic entrypoint; no response ever includes service errors or credentials. */
export async function handler(raw: unknown, context: InvocationContext) {
  const started = Date.now();
  try {
    const command = probeCommand(raw, process.env);
    let temporary: string | undefined;
    await new InvocationScope(invocationDeadline(context, started, 110000)).run(async scope => {
      if (command === 'native') { await native(scope, process.env); temporary = await scope.temporaryDirectory(); return; }
      const aws = new InvocationAws(scope, process.env);
      if (command === 'network') await network(scope, aws, process.env);
      else if (command === 'mail') await mail(scope, aws, process.env);
      else if (command === 'bootstrap') await bootstrap(scope, aws, process.env);
      else if (command === 'database') await database(scope, aws, process.env);
      else await startup(scope, aws, process.env, context);
    });
    if (temporary) {
      let missing = false; try { await access(temporary); } catch (error) { missing = (error as NodeJS.ErrnoException).code === 'ENOENT'; }
      if (!missing) fail('PROBE_TEMPORARY_FILES_REMAIN');
    }
    return { version: 1, command, passed: true, durationMs: Date.now() - started };
  } catch (error) { throw probeFailure(error); }
}
