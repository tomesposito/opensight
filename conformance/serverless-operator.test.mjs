import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, chmod, rm, mkdir, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { privateDirectory, reserveInvocation, owned, safeProbeResult } from '../ops/serverless/operator.mjs';
import { checkPlan } from '../ops/serverless/plan-policy.mjs';

test('SR4a private operator paths exclude the checkout, relative paths, symlinks and permissive directories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opensight-operator-'));
  try {
    await chmod(root, 0o700);
    assert.equal(privateDirectory(root), await realpath(root));
    assert.throws(() => privateDirectory('.'));
    assert.throws(() => privateDirectory(root, root));
    await mkdir(join(root, 'open'), { mode: 0o755 });
    await chmod(join(root, 'open'), 0o755);
    assert.throws(() => privateDirectory(join(root, 'open')));
    await symlink(root, join(root, 'alias'));
    assert.throws(() => privateDirectory(join(root, 'alias')));
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('SR4a invocation ledger reserves every attempt and cannot exceed 72 hours or 1000 calls', () => {
  const ledger = { startedAt: 100000, invocations: 999, retired: false };
  assert.equal(reserveInvocation(ledger, 'native', 100001).invocations, 1000);
  for (const bad of [{ ...ledger, invocations: 1000 }, { ...ledger, invocations: -1 }, { ...ledger, startedAt: NaN }, { ...ledger, retired: true }]) assert.throws(() => reserveInvocation(bad, 'native', 100001));
  assert.throws(() => reserveInvocation(ledger, 'native', 100000 + 72 * 3600000));
  assert.throws(() => reserveInvocation(ledger, 'native', 99999));
  assert.throws(() => reserveInvocation(ledger, 'arbitrary-sql', 100001));
  assert.equal(ledger.invocations, 999);
});
test('SR4a cleanup ownership and probe output reject foreign resources and secret-bearing responses', () => {
  owned([{ Key: 'OpenSightDeployment', Value: 'synthetic' }, { Key: 'OpenSightPurpose', Value: 'isolated-validation' }], 'synthetic');
  for (const tags of [null, {}, { OpenSightDeployment: 'foreign', OpenSightPurpose: 'isolated-validation' }, { OpenSightDeployment: 'synthetic', OpenSightPurpose: 'protected-state' }]) assert.throws(() => owned(tags, 'synthetic'));
  const response = { version: 1, command: 'native', passed: true, durationMs: 42 };
  assert.deepEqual(safeProbeResult(response), response);
  for (const bad of [{ ...response, password: 'synthetic' }, { ...response, passed: false }, { ...response, durationMs: -1 }, { ...response, errorMessage: 'provider details' }]) assert.throws(() => safeProbeResult(bad));
});
function plan() {
  const resources = [];
  const add = (type, name, after) => resources.push({ mode: 'managed', address: `${type}.${name}`, type, change: { actions: ['create'], after } });
  add('aws_rds_cluster', 'validation', { serverlessv2_scaling_configuration: [{ min_capacity: 0, max_capacity: 2, seconds_until_auto_pause: 300 }], deletion_protection: true, storage_encrypted: true, manage_master_user_password: true, enable_http_endpoint: false, backup_retention_period: 1 });
  add('aws_rds_cluster_instance', 'writer', { instance_class: 'db.serverless', publicly_accessible: false, monitoring_interval: 0, performance_insights_enabled: false });
  for (const name of ['request', 'scheduler', 'probe']) add('aws_lambda_function', `validation["${name}"]`, { timeout: 120, memory_size: 2048, reserved_concurrent_executions: 1, architectures: ['arm64'], ephemeral_storage: [{ size: 512 }], vpc_config: [{ ipv6_allowed_for_dual_stack: true }], image_uri: `image@sha256:${'a'.repeat(64)}`, environment: [{ variables: { OPENSIGHT_MAINTENANCE: 'frozen', OPENSIGHT_RUNTIME: 'lambda' } }] });
  for (const name of ['a', 'b']) add('aws_subnet', name, { map_public_ip_on_launch: false });
  return { resource_changes: resources };
}
test('SR4a saved-plan policy rejects cost, public access, secret and destruction regressions', () => {
  assert.equal(checkPlan(plan()).functions, 3);
  const mutate = change => { const value = plan(); change(value.resource_changes); assert.throws(() => checkPlan(value), /PLAN_REJECTED/); };
  mutate(r => { r[0].change.after.serverlessv2_scaling_configuration[0].max_capacity = 8; });
  mutate(r => { r[0].change.after.serverlessv2_scaling_configuration[0].min_capacity = 0.5; });
  mutate(r => { r[1].change.after.publicly_accessible = true; });
  mutate(r => { r[2].change.after.reserved_concurrent_executions = -1; });
  mutate(r => { r[2].change.after.environment[0].variables.OPENSIGHT_OPERATOR_KEY = 'synthetic'; });
  mutate(r => { r[2].change.after.environment[0].variables.OPENSIGHT_BOOTSTRAP_SECRET_ARN = 'synthetic'; });
  mutate(r => { r[0].change.actions = ['delete', 'create']; });
  for (const type of ['aws_nat_gateway', 'aws_lambda_function_url', 'aws_apigatewayv2_api', 'aws_cloudfront_distribution', 'aws_lambda_event_source_mapping', 'aws_scheduler_schedule', 'aws_secretsmanager_secret_version']) mutate(r => r.push({ mode: 'managed', address: `${type}.forbidden`, type, change: { actions: ['create'], after: {} } }));
  mutate(r => r.push({ mode: 'managed', address: 'aws_vpc_endpoint.bad', type: 'aws_vpc_endpoint', change: { actions: ['create'], after: { vpc_endpoint_type: 'Interface' } } }));
});
