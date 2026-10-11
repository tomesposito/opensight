import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkFailedSubscriptionStack, checkFreeSubscription, checkIngressPlan, checkReceipt, frontendFiles, sha256 } from '../ops/serverless/ingress-policy.mjs';

test('SR4a ingress receipt rejects expiry, source/configuration changes and remote state movement', () => {
  const now = Date.now(), actual = { plan: sha256('plan'), source: sha256('source'), configuration: sha256('private inputs'), account: '000000000000', deployment: 'synthetic', state: { lineage: 'synthetic', serial: 2, version: 'two' } };
  const receipt = { ...actual, version: 1, createdAt: now };
  checkReceipt(receipt, actual, now + 1000);
  for (const key of ['plan', 'source', 'configuration']) assert.throws(() => checkReceipt(receipt, { ...actual, [key]: sha256('changed') }, now), /PLAN_CHANGED/);
  for (const [key, value] of [['account', '111111111111'], ['deployment', 'other'], ['state', null], ['state', { ...actual.state, serial: 3 }], ['state', { ...actual.state, version: 'three' }]]) assert.throws(() => checkReceipt(receipt, { ...actual, [key]: value }, now), /PLAN_CONTEXT_CHANGED/);
  assert.throws(() => checkReceipt(receipt, actual, now + 3600001), /PLAN_EXPIRED/);
  assert.throws(() => checkReceipt(receipt, actual, now - 1), /PLAN_EXPIRED/);
});
test('SR4a Free subscription must be active, exact and without a scheduled paid change', () => {
  const resources = ['distribution', 'acl', 'zone'], subscription = { status: 'ACTIVE', planTier: 'FREE', planFamily: 'CloudFront', resourceArns: resources };
  checkFreeSubscription(subscription, [...resources].reverse());
  for (const changed of [{ status: 'PENDING' }, { planTier: 'PRO' }, { scheduledChange: { planTier: 'PRO' } }, { resourceArns: ['distribution', 'acl'] }, { resourceArns: [...resources, 'other'] }]) assert.throws(() => checkFreeSubscription({ ...subscription, ...changed }, resources), /FREE_SUBSCRIPTION_REQUIRED/);
});
test('SR4a frontend manifest rejects tampering, missing files, extras and symbolic links; index is last', () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'opensight-ingress-')));
  try {
    mkdirSync(join(directory, 'assets'));
    const asset = 'assets/index-synthetic123.js', files = { 'index.html': sha256('html'), [asset]: sha256('js') };
    writeFileSync(join(directory, 'index.html'), 'html'); writeFileSync(join(directory, asset), 'js');
    writeFileSync(join(directory, 'manifest.json'), JSON.stringify({ version: 1, kind: 'frontend', platform: 'browser', files }));
    const manifest = sha256(readFileSync(join(directory, 'manifest.json')));
    assert.deepEqual(frontendFiles(directory, manifest).map(file => file.key), [asset, 'index.html']);
    assert.throws(() => frontendFiles(directory, sha256('wrong')), /FRONTEND_MANIFEST_INVALID/);
    writeFileSync(join(directory, asset), 'tampered');
    assert.throws(() => frontendFiles(directory, manifest), /FRONTEND_BYTES_CHANGED/);
    rmSync(join(directory, asset));
    assert.throws(() => frontendFiles(directory, manifest), /FRONTEND_MANIFEST_INVALID/);
    symlinkSync(join(directory, 'index.html'), join(directory, asset));
    assert.throws(() => frontendFiles(directory, manifest), /FRONTEND_PATH_UNSAFE/);
    rmSync(join(directory, asset)); writeFileSync(join(directory, asset), 'js'); writeFileSync(join(directory, 'unexpected.txt'), 'extra');
    assert.throws(() => frontendFiles(directory, manifest), /FRONTEND_PATH_UNSAFE/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('SR4a failed-subscription repair refuses live subscriptions, foreign stacks and retained resources', () => {
  const stack = { StackName: 'synthetic-free-edge', StackStatus: 'ROLLBACK_COMPLETE' }, resources = [{ LogicalResourceId: 'Subscription', ResourceType: 'AWS::PricingPlanManager::Subscription', ResourceStatus: 'DELETE_COMPLETE' }], arns = ['distribution', 'acl'];
  checkFailedSubscriptionStack(stack, resources, [], stack.StackName, arns);
  for (const changed of [{ StackStatus: 'CREATE_COMPLETE' }, { StackName: 'foreign' }]) assert.throws(() => checkFailedSubscriptionStack({ ...stack, ...changed }, resources, [], stack.StackName, arns), /EMPTY_FAILED_STACK_REQUIRED/);
  for (const changed of [{ PhysicalResourceId: 'subscription' }, { ResourceStatus: 'CREATE_FAILED' }, { ResourceType: 'AWS::S3::Bucket' }]) assert.throws(() => checkFailedSubscriptionStack(stack, [{ ...resources[0], ...changed }], [], stack.StackName, arns), /EMPTY_FAILED_STACK_REQUIRED/);
  assert.throws(() => checkFailedSubscriptionStack(stack, resources, [{ resourceArns: arns }], stack.StackName, arns), /EMPTY_FAILED_STACK_REQUIRED/);
  assert.throws(() => checkFailedSubscriptionStack(stack, [...resources, resources[0]], [], stack.StackName, arns), /EMPTY_FAILED_STACK_REQUIRED/);
});
test('SR4a ingress plan rejects replacing data, paid plans, caches, unguarded routes and unreviewed DNS', () => {
  const inputs = { deployment: 'synthetic', image_uri: 'synthetic@sha256:digest', request_function_name: 'synthetic-request', request_function_version: '1', frontend_bucket: 'synthetic-frontend', public_origin: 'https://opensight.example', zone_id: 'ZSYNTHETIC', publish_site: false };
  const change = (address, after) => ({ mode: 'managed', address, type: address.split('.')[0], change: { actions: ['create'], after } });
  const resources = [
    change('aws_lambda_function.authorizer', { function_name: 'synthetic-ingress', timeout: 10, memory_size: 256, reserved_concurrent_executions: 2, architectures: ['arm64'], vpc_config: [], image_uri: inputs.image_uri }),
    change('aws_lambda_alias.request', { name: 'live', function_name: inputs.request_function_name, function_version: '1' }),
    change('aws_apigatewayv2_api.application', { disable_execute_api_endpoint: true, protocol_type: 'HTTP' }),
    change('aws_apigatewayv2_authorizer.ingress', { authorizer_result_ttl_in_seconds: 0, authorizer_type: 'REQUEST' }),
    change('aws_apigatewayv2_route.request["$default"]', { authorization_type: 'CUSTOM', route_key: '$default' }),
    change('aws_s3_bucket.frontend', { bucket: inputs.frontend_bucket, force_destroy: false }),
    change('aws_s3_bucket_public_access_block.frontend', { block_public_acls: true, block_public_policy: true, ignore_public_acls: true, restrict_public_buckets: true }),
    change('aws_s3_bucket_versioning.frontend', { versioning_configuration: [{ status: 'Enabled' }] }),
    change('aws_cloudfront_distribution.application', { enabled: true, retain_on_delete: true, aliases: ['opensight.example'], ordered_cache_behavior: [{ target_origin_id: 'frontend' }, ...Array.from({ length: 2 }, () => ({ target_origin_id: 'api', cache_policy_id: '4135ea2d-6df8-44a3-9df3-4b5a84be39ad', origin_request_policy_id: 'b689b0a8-53d0-40ab-baf2-68738e2966ac', viewer_protocol_policy: 'https-only' }))] }),
    change('aws_cloudformation_stack.plan', { template_body: JSON.stringify({ Resources: { Subscription: { Type: 'AWS::PricingPlanManager::Subscription', Properties: { PlanTier: 'FREE' } } } }) }),
    change('aws_apigatewayv2_stage.application', { default_route_settings: [{ throttling_rate_limit: 5, throttling_burst_limit: 10 }], route_settings: [{ route_key: 'POST /api/api/startup', throttling_rate_limit: 0.1, throttling_burst_limit: 2 }] }),
    change('aws_wafv2_web_acl.application', { rule: [{ name: 'all_ip', action: [{ block: [{}] }], visibility_config: [{ sampled_requests_enabled: false }], statement: [{ rate_based_statement: [{ aggregate_key_type: 'IP', limit: 600, evaluation_window_sec: 300, scope_down_statement: [] }] }] }] }),
    ...['aws_acm_certificate.site', 'aws_acm_certificate_validation.site', 'aws_secretsmanager_secret.ingress', 'aws_secretsmanager_secret_version.ingress', 'aws_iam_role.authorizer', 'aws_iam_role_policy.authorizer', 'aws_lambda_permission.authorizer', 'aws_lambda_permission.request', 'aws_apigatewayv2_integration.request', 'aws_apigatewayv2_domain_name.origin', 'aws_apigatewayv2_api_mapping.origin', 'aws_s3_bucket_ownership_controls.frontend', 'aws_s3_bucket_policy.frontend', 'aws_cloudfront_function.viewer'].map(address => change(address, {})),
  ];
  checkIngressPlan({ resource_changes: resources }, inputs);
  const reject = mutate => { const copy = structuredClone(resources); mutate(copy); assert.throws(() => checkIngressPlan({ resource_changes: copy }, inputs), /INGRESS_PLAN_REJECTED/); };
  reject(r => { r[0].change.after.memory_size = 2048; });
  reject(r => { r[0].change.after.vpc_config = [{}]; });
  reject(r => { r[1].change.after.function_version = '$LATEST'; });
  reject(r => { r[2].change.after.disable_execute_api_endpoint = false; });
  reject(r => { r[3].change.after.authorizer_result_ttl_in_seconds = 300; });
  reject(r => { r[4].change.after.authorization_type = 'NONE'; });
  reject(r => { r[5].change.actions = ['delete', 'create']; });
  reject(r => { r[8].change.after.ordered_cache_behavior[1].cache_policy_id = 'cached'; });
  reject(r => { r[9].change.after.template_body = r[9].change.after.template_body.replace('FREE', 'PRO'); });
  reject(r => { r[10].change.after.route_settings[0].throttling_rate_limit = 5; });
  reject(r => { r[11].change.after.rule[0].statement[0].rate_based_statement[0].scope_down_statement = [{}]; });
  reject(r => { r[11].change.after.rule[0].statement[0].rate_based_statement[0].limit = 10000; });
  reject(r => { r.push(change('aws_route53_record.site["A"]', { zone_id: inputs.zone_id, name: 'opensight.example' })); });
  reject(r => { r.push(change('aws_rds_cluster.database', {})); });
});
