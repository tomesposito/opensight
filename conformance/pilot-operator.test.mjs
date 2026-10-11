import test from 'node:test';
import assert from 'node:assert/strict';
import { initialCredentials, safeInitialResult, activationRequired, administrationImage, initialBudgetChange } from '../ops/serverless/pilot-operator.mjs';
import { checkPlan } from '../ops/serverless/plan-policy.mjs';

test('SR4b1 private tester generation produces independent workspace and authentication material', () => {
  const first = initialCredentials('Owner@Example.Invalid'), second = initialCredentials('Owner@Example.Invalid');
  assert.equal(first.testers[0].email, 'owner@example.invalid');
  assert.equal(first.testers[1].email, 'automation@example.invalid');
  assert.notEqual(first.operationId, second.operationId);
  const identities = [...first.testers, ...second.testers];
  assert.equal(new Set(identities.flatMap(t => [t.tenantId, t.namespaceId, t.userId, t.subject])).size, 16);
  assert.equal(new Set(identities.map(t => t.password)).size, 4);
  assert.equal(new Set(identities.map(t => t.totpSecret)).size, 4);
  for (const tester of identities) {
    assert.equal(Buffer.from(tester.password, 'base64url').length, 32);
    assert.equal(Buffer.from(tester.totpSecret, 'base64').length, 20);
  }
  for (const email of [undefined, '', 'bad', 'automation@example.invalid']) assert.throws(() => initialCredentials(email), /TESTER_EMAIL_INVALID/);
});
test('SR4b1 operator accepts only exact administration results and release-bound activation', () => {
  const active = { state: 'active', epoch: 1 };
  assert.deepEqual(safeInitialResult('activate-initial', active), active);
  safeInitialResult('migrate', { state: 'migrated', maintenance: true });
  safeInitialResult('bootstrap-initial', { state: 'bootstrapped', epoch: 1, tenants: 2 });
  safeInitialResult('repair-initial-locks', { state: 'locks-repaired', epoch: 1 });
  safeInitialResult('tune-initial-budgets', { state: 'budgets-configured', epoch: 1, budgetVersion: 2 });
  for (const result of [{ ...active, secret: 'synthetic' }, { ...active, epoch: 2 }, null, {}]) assert.throws(() => safeInitialResult('activate-initial', result), /INITIAL_RESULT_INVALID/);
  const release = { image_uri: `synthetic@sha256:${'a'.repeat(64)}` }, receipt = { version: 1, account: '000000000000', deployment: 'synthetic', imageUri: release.image_uri, operationId: 'initial', result: active };
  activationRequired(receipt, release, receipt.account, receipt.deployment, 'initial');
  for (const change of [{ account: '111111111111' }, { deployment: 'other' }, { operationId: 'changed' }, { imageUri: 'new-image' }, { result: { state: 'active', epoch: 2 } }])
    assert.throws(() => activationRequired({ ...receipt, ...change }, release, receipt.account, receipt.deployment, 'initial'), /INITIAL_ACTIVATION_REQUIRED/);
});
test('SR4b3 initial budget change input carries only distinct canonical digests', () => {
  const change = { previousBudgetDigest: 'a'.repeat(64), targetBudgetDigest: 'b'.repeat(64) };
  assert.deepEqual(initialBudgetChange(change), change);
  for (const value of [null, {}, { ...change, body: {} }, { ...change, targetBudgetDigest: change.previousBudgetDigest }, { ...change, previousBudgetDigest: 'invalid' }])
    assert.throws(() => initialBudgetChange(value), /INITIAL_BUDGET_CHANGE_INVALID/);
  assert.throws(() => safeInitialResult('tune-initial-budgets', { state: 'budgets-configured', epoch: 1, budgetVersion: 3 }), /INITIAL_RESULT_INVALID/);
});
test('SR4b4 connection repair preserves activation provenance and binds the exact replacement', () => {
  const account = '000000000000', deployment = 'synthetic', operationId = 'bootstrap';
  const image = `${account}.dkr.ecr.us-east-1.amazonaws.com/${deployment}@sha256:`;
  const release = { image_uri: image + 'b'.repeat(64), source_commit: 'c'.repeat(40) };
  const record = { version: 1, account, deployment, operationId, imageUri: image + 'a'.repeat(64), result: { state: 'active', epoch: 1 } };
  const patch = { version: 1, account, deployment, operationId, activationImageUri: record.imageUri, imageUri: release.image_uri,
    sourceCommit: release.source_commit, purpose: 'release-idle-preflight-clients' };
  const original = structuredClone(record);
  activationRequired(record, release, account, deployment, operationId, patch); assert.deepEqual(record, original);
  assert.throws(() => activationRequired(record, release, account, deployment, operationId), /INITIAL_ACTIVATION_REQUIRED/);
  for (const change of [{ imageUri: record.imageUri }, { sourceCommit: 'd'.repeat(40) }, { operationId: 'other' }, { account: '111111111111' },
    { activationImageUri: image + 'd'.repeat(64) }, { purpose: 'arbitrary-upgrade' }, { unknown: true }])
    assert.throws(() => activationRequired(record, release, account, deployment, operationId, { ...patch, ...change }));
  const foreign = image.replace('/synthetic@', '/foreign@') + 'b'.repeat(64);
  assert.throws(() => activationRequired(record, { ...release, image_uri: foreign }, account, deployment, operationId, { ...patch, imageUri: foreign }), /PINNED_ADMINISTRATION_REQUIRED/);
});
test('SR4b2 administration artifacts stay pinned to the same deployment and do not replace the application', () => {
  const plan = fixture(true, true), image = plan.variables.image_uri.value.replace(/a{64}$/, 'b'.repeat(64));
  assert.equal(administrationImage({ image_uri: image }, '000000000000', 'synthetic'), image);
  for (const candidate of [image.replace('000000000000', '111111111111'), image.replace('/synthetic@', '/foreign@'), image.replace(/@sha256:.+$/, ':latest'), undefined])
    assert.throws(() => administrationImage({ image_uri: candidate }, '000000000000', 'synthetic'), /PINNED_ADMINISTRATION_REQUIRED/);
  plan.variables.administration_image_uri = { value: image };
  plan.resource_changes.find(r => r.address === 'aws_lambda_function.validation["migration"]').change.after.image_uri = image;
  checkPlan(plan, { allowPilot: true });
  const request = plan.resource_changes.find(r => r.address === 'aws_lambda_function.validation["request"]').change.after;
  request.image_uri = image;
  assert.throws(() => checkPlan(plan, { allowPilot: true }), /PILOT_FUNCTION/);
  request.image_uri = plan.variables.image_uri.value;
  plan.variables.administration_image_uri.value = image.replace('/synthetic@', '/foreign@');
  assert.throws(() => checkPlan(plan, { allowPilot: true }), /ADMINISTRATION_IMAGE/);
});
function fixture(runtime = true, consumers = false) {
  const input = { deployment_profile: 'pilot', enable_runtime: true, enable_pilot_runtime: runtime, enable_consumers: consumers, region: 'us-east-1', account_id: '000000000000', deployment: 'synthetic',
    image_uri: `000000000000.dkr.ecr.us-east-1.amazonaws.com/synthetic@sha256:${'a'.repeat(64)}`, artifact_bucket: 'synthetic-artifacts', runtime_environment: { OPENSIGHT_PUBLIC_ORIGIN: 'https://workspace.example.invalid' } };
  const changes = [], queueArn = name => `arn:aws:sqs:us-east-1:000000000000:synthetic-${name}`;
  const add = (address, after) => changes.push({ mode: 'managed', type: address.split('.')[0], address, change: { actions: ['create'], after } });
  add('aws_rds_cluster.validation', { cluster_identifier: 'synthetic', tags_all: { OpenSightStage: 'pilot' }, serverlessv2_scaling_configuration: [{ min_capacity: 0, max_capacity: 2, seconds_until_auto_pause: 300 }], deletion_protection: true, storage_encrypted: true, manage_master_user_password: true, enable_http_endpoint: false, backup_retention_period: 1 });
  add('aws_rds_cluster_instance.writer', { instance_class: 'db.serverless', publicly_accessible: false, monitoring_interval: 0, performance_insights_enabled: false });
  for (const name of ['request', 'migration', 'probe', ...(runtime ? ['work', 'recovery'] : [])]) {
    const env = { OPENSIGHT_MAINTENANCE: 'frozen', OPENSIGHT_RUNTIME: 'lambda' };
    if (runtime && name !== 'probe') {
      Object.assign(env, { OPENSIGHT_SERVERLESS_DATA: 'durable', OPENSIGHT_RELEASE_DIGEST: input.image_uri.split('@')[1] });
      for (const queue of ['work', 'recovery']) Object.assign(env, { [`OPENSIGHT_${queue.toUpperCase()}_QUEUE_ARN`]: queueArn(queue), [`OPENSIGHT_${queue.toUpperCase()}_QUEUE_URL`]: `https://sqs.us-east-1.amazonaws.com/000000000000/synthetic-${queue}` });
    }
    add(`aws_lambda_function.validation["${name}"]`, { function_name: `synthetic-${name}`, image_uri: input.image_uri, timeout: name === 'request' ? 28 : 120, memory_size: 2048,
      reserved_concurrent_executions: runtime ? { request: 4, migration: 1, probe: 0, work: 2, recovery: 2 }[name] : 1, architectures: ['arm64'], ephemeral_storage: [{ size: 512 }], vpc_config: [{ ipv6_allowed_for_dual_stack: true }], environment: [{ variables: env }] });
  }
  for (const name of ['a', 'b']) add(`aws_subnet.${name}`, { map_public_ip_on_launch: false });
  for (const name of ['work', 'recovery', 'scheduler']) add(`aws_sqs_queue.business_dead["${name}"]`, { name: `synthetic-${name}-dead`, message_retention_seconds: 1209600, sqs_managed_sse_enabled: true });
  for (const name of ['work', 'recovery']) {
    add(`aws_sqs_queue.business["${name}"]`, { name: `synthetic-${name}`, message_retention_seconds: 345600, visibility_timeout_seconds: 720, sqs_managed_sse_enabled: true, redrive_policy: JSON.stringify({ maxReceiveCount: 5, deadLetterTargetArn: queueArn(`${name}-dead`) }) });
    if (runtime) add(`aws_lambda_event_source_mapping.business["${name}"]`, { function_name: `arn:aws:lambda:us-east-1:000000000000:function:synthetic-${name}`, event_source_arn: queueArn(name), enabled: consumers, batch_size: 1, maximum_batching_window_in_seconds: 0, function_response_types: ['ReportBatchItemFailures'], scaling_config: [{ maximum_concurrency: 2 }] });
  }
  for (const name of ['probe', 'dead']) add(`aws_sqs_queue.${name}`, {});
  for (const name of ['probe', 'business[0]']) add(`aws_scheduler_schedule_group.${name}`, {});
  add('aws_s3_bucket_cors_configuration.artifacts[0]', { bucket: input.artifact_bucket, cors_rule: [{ allowed_origins: [input.runtime_environment.OPENSIGHT_PUBLIC_ORIGIN], allowed_methods: ['GET', 'PUT', 'HEAD'], allowed_headers: ['content-type', 'content-length', 'x-amz-checksum-sha256', 'if-none-match', 'x-amz-server-side-encryption'], max_age_seconds: 300 }] });
  return { variables: Object.fromEntries(Object.entries(input).map(([key, value]) => [key, { value }])), resource_changes: changes };
}
test('SR4b1 pilot plan stages keep consumers off until selected and require the promotion operator', () => {
  for (const [runtime, consumers, count] of [[false, false, 3], [true, false, 5], [true, true, 5]]) {
    const plan = fixture(runtime, consumers);
    assert.throws(() => checkPlan(plan), /PILOT_OPERATOR_REQUIRED/);
    assert.equal(checkPlan(plan, { allowPilot: true }).functions, count);
  }
});
test('SR4b1 pilot plan rejects premature consumers, queue substitution, unbounded capacity and public object CORS', () => {
  const reject = (address, mutate) => {
    const plan = fixture(); mutate(plan.resource_changes.find(change => change.address === address).change.after);
    assert.throws(() => checkPlan(plan, { allowPilot: true }), /PLAN_REJECTED/);
  };
  reject('aws_rds_cluster.validation', value => { value.tags_all = {}; });
  reject('aws_lambda_function.validation["probe"]', value => { value.reserved_concurrent_executions = 1; });
  reject('aws_lambda_function.validation["work"]', value => { value.reserved_concurrent_executions = 20; });
  reject('aws_lambda_function.validation["request"]', value => { value.image_uri = 'mutable:latest'; });
  reject('aws_lambda_function.validation["work"]', value => { value.environment[0].variables.OPENSIGHT_WORK_QUEUE_URL = 'https://foreign.invalid/queue'; });
  reject('aws_lambda_event_source_mapping.business["work"]', value => { value.enabled = true; });
  reject('aws_lambda_event_source_mapping.business["work"]', value => { value.function_name = 'foreign-function'; });
  reject('aws_lambda_event_source_mapping.business["work"]', value => { value.event_source_arn = 'foreign-queue'; });
  reject('aws_lambda_event_source_mapping.business["work"]', value => { value.provisioned_poller_config = [{ minimum_pollers: 2 }]; });
  reject('aws_sqs_queue.business["work"]', value => { value.redrive_policy = '{}'; });
  reject('aws_sqs_queue.business["work"]', value => { value.visibility_timeout_seconds = 30; });
  reject('aws_s3_bucket_cors_configuration.artifacts[0]', value => { value.cors_rule[0].allowed_origins = ['*']; });
  reject('aws_s3_bucket_cors_configuration.artifacts[0]', value => { value.cors_rule[0].allowed_headers = ['*']; });
  const invalid = fixture(false, true); assert.throws(() => checkPlan(invalid, { allowPilot: true }), /RUNTIME_STAGE/);
});
