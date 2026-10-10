import test from 'node:test';
import assert from 'node:assert/strict';
import { InvocationScope } from '../dist/runtime-scope.js';
import { InvocationAws, awsRegion, secretArn, secretObject, databaseUrl, awsEnvironment } from '../dist/runtime-aws.js';
import { probeCommand, probeRoleNames, probeFailure } from '../dist/platform-probe.js';
const arn = 'arn:aws:secretsmanager:us-east-1:000000000000:secret:synthetic-abcdef';
const base = { AWS_ACCESS_KEY_ID: 'synthetic', AWS_SECRET_ACCESS_KEY: 'synthetic', AWS_SESSION_TOKEN: 'synthetic', AWS_REGION: 'us-east-1', OPENSIGHT_VALIDATION: 'isolated', OPENSIGHT_MAINTENANCE: 'frozen', OPENSIGHT_RUNTIME: 'lambda', OPENSIGHT_MODE: 'hosted', OPENSIGHT_DEPLOYMENT: 'synthetic' };
const scope = () => new InvocationScope(Date.now() + 12000);

test('SR4a SQL diagnostics retain only a validated SQLSTATE, never statement or credential detail', () => {
  const failure = probeFailure({ severity: 'ERROR', code: '42501', message: 'private statement', detail: 'private password' });
  assert.equal(failure.code, 'PROBE_SQL_42501');
  assert.equal(failure.message, 'PROBE_SQL_42501');
  for (const error of [new Error('private error'), { code: 'EPERM' }, { severity: 'ERROR', code: '42501:private' }, { severity: 'ERROR', code: '42501\n' }]) assert.equal(probeFailure(error).code, 'PROBE_FAILED');
});

test('SR4a strict secret schemas reject oversized, ignored, nested and prototype fields', () => {
  assert.deepEqual({ ...secretObject('{"username":"synthetic","password":"fake"}', ['username', 'password']) }, { username: 'synthetic', password: 'fake' });
  for (const raw of ['null', '[]', '{}', '{"username":"x","password":3}', '{"username":"x","password":"x","__proto__":{}}', '{"username":"x","password":"x","ignored":"x"}', ' '.repeat(65537), '{"username":"x","password":"\\n"}']) {
    assert.throws(() => secretObject(raw, ['username', 'password']), { code: 'AWS_SECRET_INVALID' });
  }
});
test('SR4a region, ARN and database URL cannot redirect credentials', () => {
  assert.equal(awsRegion(base), 'us-east-1');
  for (const region of ['', 'us-east-1.evil.invalid', 'us-east-1/?', 'cn-north-1']) assert.throws(() => awsRegion({ AWS_REGION: region }));
  assert.equal(secretArn(arn, 'us-east-1'), arn);
  const managed = 'arn:aws:secretsmanager:us-east-1:000000000000:secret:rds!cluster-00000000-0000-0000-0000-000000000000-abcdef';
  assert.equal(secretArn(managed, 'us-east-1'), managed);
  for (const invalid of [managed.replace('us-east-1', 'us-west-2'), managed.replace('rds!cluster-', 'foreign!'), `${managed}:password`, `${managed}\n`, `${managed}/redirect`]) assert.throws(() => secretArn(invalid, 'us-east-1'));
  assert.throws(() => secretArn(arn, 'us-west-2'));
  assert.throws(() => secretArn('synthetic', 'us-east-1'));
  const env = { OPENSIGHT_DB_HOST: 'database.invalid', OPENSIGHT_DB_NAME: 'synthetic' };
  const url = new URL(databaseUrl(env, { username: 'synthetic', password: 'fake:/?#@' }));
  assert.equal(decodeURIComponent(url.password), 'fake:/?#@');
  assert.equal(url.hostname, 'database.invalid');
  for (const host of ['database.invalid/?sslmode=disable', 'database.invalid@evil.invalid', 'database.invalid:123']) assert.throws(() => databaseUrl({ ...env, OPENSIGHT_DB_HOST: host }, { username: 'synthetic', password: 'fake' }));
});
test('SR4a clients pin regional endpoints, one attempt and queue routing; close prevents reuse', async () => {
  assert.throws(() => new InvocationAws(scope(), { AWS_REGION: 'us-east-1' }), { code: 'AWS_CREDENTIALS_REQUIRED' });
  let aws;
  await scope().run(async invocation => {
    aws = new InvocationAws(invocation, base);
    for (const client of [aws.secrets, aws.s3, aws.sqs, aws.scheduler]) assert.equal(await client.config.maxAttempts(), 1);
    assert.equal((await aws.sqs.config.endpoint()).hostname, 'sqs.us-east-1.api.aws');
    assert.equal((await aws.scheduler.config.endpoint()).hostname, 'scheduler.us-east-1.api.aws');
    assert.equal(aws.sqs.config.useQueueUrlAsEndpoint, false);
    for (const client of [aws.secrets, aws.sqs, aws.scheduler]) {
      const config = await client.config.requestHandler.configProvider;
      assert.equal(config.httpsAgent.options.family, 6);
      assert.equal(config.httpsAgent.options.rejectUnauthorized, true);
      assert.equal(config.httpsAgent.options.keepAlive, false);
    }
    assert.equal((await aws.s3.config.requestHandler.configProvider).httpsAgent.options.family, 4);
  });
  await assert.rejects(aws.call(async () => 1));
});
test('SR4a reads AWSCURRENT each time and never emits a provider error or retired secret', async t => {
  await scope().run(async invocation => {
    const aws = new InvocationAws(invocation, base), versions = [];
    t.mock.method(aws.secrets, 'send', async command => { versions.push(command.input.VersionStage); return { ARN: arn, VersionStages: ['AWSCURRENT'], SecretString: JSON.stringify({ password: `synthetic-${versions.length}` }) }; });
    assert.equal((await aws.secret(arn, ['password'])).password, 'synthetic-1');
    assert.equal((await aws.secret(arn, ['password'])).password, 'synthetic-2');
    assert.deepEqual(versions, ['AWSCURRENT', 'AWSCURRENT']);
    t.mock.method(aws.secrets, 'send', async () => { throw new Error('private credential must not escape'); });
    await assert.rejects(aws.secret(arn, ['password']), error => error.code === 'AWS_REQUEST_FAILED' && !error.message.includes('private'));
    t.mock.method(aws.secrets, 'send', async () => ({ ARN: arn, VersionStages: ['AWSPREVIOUS'], SecretString: '{"password":"old"}' }));
    await assert.rejects(aws.secret(arn, ['password']), { code: 'AWS_SECRET_INVALID' });
  });
});
test('SR4a cancellation aborts the actual operation before scope returns', async () => {
  let aborted = false;
  await scope().run(async invocation => {
    const aws = new InvocationAws(invocation, base);
    await assert.rejects(aws.call(signal => new Promise((resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(Error('aborted')); }, { once: true })), 15), { code: 'AWS_REQUEST_TIMEOUT' });
  });
  assert.equal(aborted, true);
});
test('SR4a secret loading does not mutate shared environment and rotates invocation-local keys', async t => {
  const env = { ...base, OPENSIGHT_OPERATOR_SECRET_ARN: arn, OPENSIGHT_TENANT_SECRET_ARN: `${arn}-tenant`, OPENSIGHT_POSTGRES_CA: 'synthetic-ca', OPENSIGHT_DB_HOST: 'database.invalid', OPENSIGHT_DB_NAME: 'synthetic' };
  const original = structuredClone(env);
  await scope().run(async invocation => {
    const aws = new InvocationAws(invocation, env);
    t.mock.method(aws, 'secret', async ref => ref === arn ? { username: 'synthetic_operator', password: 'fake', operatorKey: Buffer.alloc(32, 1).toString('base64'), signingKey: Buffer.alloc(32, 2).toString('base64'), encryptionKey: Buffer.alloc(32, 3).toString('base64'), ingressKeys: '[]' } : { username: 'synthetic_tenant', password: 'fake' });
    const local = await awsEnvironment(aws, env);
    assert.equal(new URL(local.OPENSIGHT_POSTGRES_OPERATOR_URL).username, 'synthetic_operator');
    assert.notEqual(local.OPENSIGHT_AUTH_SIGNING_KEY, local.OPENSIGHT_OPERATOR_KEY);
  });
  assert.deepEqual(env, original);
});
test('SR4a probe rejects public/unfrozen use, arbitrary SQL, extra fields and foreign roles', () => {
  for (const command of ['network', 'mail', 'bootstrap', 'database', 'native', 'startup']) assert.equal(probeCommand({ version: 1, command }, base), command);
  for (const raw of [null, [], { version: 1, command: 'sql' }, { version: 1, command: 'mail', to: 'someone@example.invalid' }, { version: 2, command: 'network' }]) assert.throws(() => probeCommand(raw, base));
  for (const field of ['OPENSIGHT_VALIDATION', 'OPENSIGHT_MAINTENANCE', 'OPENSIGHT_RUNTIME', 'OPENSIGHT_MODE']) assert.throws(() => probeCommand({ version: 1, command: 'network' }, { ...base, [field]: '' }), { code: 'PROBE_DISABLED' });
  assert.deepEqual(probeRoleNames(base), { operator: 'synthetic_operator', tenant: 'synthetic_tenant' });
  assert.throws(() => probeRoleNames({ OPENSIGHT_DEPLOYMENT: 'foreign";DROP ROLE x' }));
});
