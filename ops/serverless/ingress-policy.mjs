import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = value => /^[a-f0-9]{64}$/.test(value ?? '');
const allowed = new Set([
  'aws_acm_certificate.site', 'aws_acm_certificate_validation.site',
  'aws_secretsmanager_secret.ingress', 'aws_secretsmanager_secret_version.ingress',
  'aws_iam_role.authorizer', 'aws_iam_role_policy.authorizer', 'aws_cloudwatch_log_group.authorizer',
  'aws_lambda_function.authorizer', 'aws_lambda_alias.request', 'aws_lambda_permission.authorizer', 'aws_lambda_permission.request',
  'aws_apigatewayv2_api.application', 'aws_apigatewayv2_authorizer.ingress', 'aws_apigatewayv2_integration.request',
  'aws_apigatewayv2_stage.application', 'aws_apigatewayv2_domain_name.origin', 'aws_apigatewayv2_api_mapping.origin', 'aws_cloudwatch_log_group.api',
  'aws_s3_bucket.frontend', 'aws_s3_bucket_public_access_block.frontend', 'aws_s3_bucket_ownership_controls.frontend',
  'aws_s3_bucket_versioning.frontend', 'aws_s3_bucket_server_side_encryption_configuration.frontend', 'aws_s3_bucket_policy.frontend',
  'aws_cloudfront_origin_access_control.frontend', 'aws_cloudfront_function.viewer', 'aws_wafv2_web_acl.application',
  'aws_cloudfront_distribution.application', 'aws_cloudformation_stack.plan',
]);
/** Known security/cost fields must resolve at plan time. Computed ARNs are bound
 * by the reviewed source digest, provider lock and remote state receipt. */
export function checkIngressPlan(plan, inputs) {
  const changes = (plan.resource_changes ?? []).filter(r => r.mode === 'managed'), issues = [];
  const check = (ok, code) => { if (!ok) issues.push(code); };
  check(changes.length >= 25 && changes.length <= 45, 'INVENTORY');
  for (const r of changes) {
    const v = r.change?.after ?? {}, address = r.address;
    check(allowed.has(address) || ['aws_route53_record.certificate', 'aws_route53_record.origin', 'aws_route53_record.site', 'aws_apigatewayv2_route.request'].includes(address.split('[')[0]), 'RESOURCE_SCOPE');
    check(r.change.actions.every(a => ['create', 'update', 'no-op', 'read'].includes(a)), 'DESTRUCTIVE_PLAN');
    if (r.type === 'aws_route53_record') {
      check(v.zone_id === inputs.zone_id && v.allow_overwrite !== true, 'DNS_SCOPE');
      if (address.startsWith('aws_route53_record.site')) check(inputs.publish_site === true && v.name === new URL(inputs.public_origin).hostname, 'DNS_CUTOVER');
    }
    if (r.type === 'aws_lambda_function') check(v.function_name === `${inputs.deployment}-ingress` && v.timeout === 10 && v.memory_size === 256 && v.reserved_concurrent_executions === 2 && v.architectures?.join() === 'arm64' && !(v.vpc_config?.length) && v.image_uri === inputs.image_uri, 'AUTHORIZER_CAP');
    if (r.type === 'aws_lambda_alias') check(v.function_name === inputs.request_function_name && v.function_version === inputs.request_function_version && v.name === 'live', 'REQUEST_VERSION');
    if (r.type === 'aws_apigatewayv2_api') check(v.disable_execute_api_endpoint === true && v.protocol_type === 'HTTP', 'ORIGIN_BYPASS');
    if (r.type === 'aws_apigatewayv2_authorizer') check(v.authorizer_result_ttl_in_seconds === 0 && v.authorizer_type === 'REQUEST', 'AUTHORIZER_CACHE');
    if (r.type === 'aws_apigatewayv2_route') check(v.authorization_type === 'CUSTOM' && ['$default', 'POST /api/api/startup'].includes(v.route_key), 'ROUTE_AUTH');
    if (r.type === 'aws_apigatewayv2_stage') check(v.default_route_settings?.[0]?.throttling_rate_limit === 5 && v.default_route_settings[0].throttling_burst_limit === 10
      && v.route_settings?.length === 1 && v.route_settings[0].route_key === 'POST /api/api/startup' && v.route_settings[0].throttling_rate_limit === 0.1 && v.route_settings[0].throttling_burst_limit === 2, 'GLOBAL_STARTUP_CAP');
    if (r.type === 'aws_cloudwatch_log_group') check(v.retention_in_days === 3, 'LOG_CAP');
    if (r.type === 'aws_wafv2_web_acl') {
      const rule = v.rule?.[0], rate = rule?.statement?.[0]?.rate_based_statement?.[0];
      check(v.rule?.length === 1 && rule.name === 'all_ip' && rule.action?.[0]?.block?.length === 1
        && rate?.aggregate_key_type === 'IP' && rate.limit === 600 && rate.evaluation_window_sec === 300
        && !rate.scope_down_statement?.length && rule.visibility_config?.[0]?.sampled_requests_enabled === false, 'EDGE_IP_CAP');
    }
    if (r.type === 'aws_s3_bucket') check(v.bucket === inputs.frontend_bucket && v.force_destroy === false, 'BUCKET_CUSTODY');
    if (r.type === 'aws_s3_bucket_public_access_block') check(['block_public_acls', 'block_public_policy', 'ignore_public_acls', 'restrict_public_buckets'].every(k => v[k] === true), 'PUBLIC_BUCKET');
    if (r.type === 'aws_s3_bucket_versioning') check(v.versioning_configuration?.[0]?.status === 'Enabled', 'BUCKET_VERSIONS');
    if (r.type === 'aws_cloudfront_distribution') {
      check(v.enabled === true && v.retain_on_delete === true && v.aliases?.join() === new URL(inputs.public_origin).hostname && v.ordered_cache_behavior?.length === 3 && !v.custom_error_response?.length, 'EDGE_SCOPE');
      for (const behavior of v.ordered_cache_behavior ?? []) if (behavior.target_origin_id === 'api') check(behavior.cache_policy_id === '4135ea2d-6df8-44a3-9df3-4b5a84be39ad' && behavior.origin_request_policy_id === 'b689b0a8-53d0-40ab-baf2-68738e2966ac' && behavior.viewer_protocol_policy === 'https-only' && !behavior.response_headers_policy_id, 'DYNAMIC_CACHE');
    }
    if (r.type === 'aws_cloudformation_stack') {
      // Resource ARNs make the initial template unknown; the source-bound
      // template is checked offline and the live subscription before cutover.
      if (v.template_body) {
        const template = JSON.parse(v.template_body), resources = Object.values(template.Resources ?? {});
        check(resources.length === 1 && resources[0].Type === 'AWS::PricingPlanManager::Subscription' && resources[0].Properties.PlanTier === 'FREE', 'PAID_PLAN');
      } else check(r.change.after_unknown?.template_body === true, 'PLAN_TEMPLATE');
    }
  }
  if (issues.length) throw Error(`INGRESS_PLAN_REJECTED:${[...new Set(issues)].sort().join(',')}`);
  return { resources: changes.length, publicDns: inputs.publish_site, planTier: 'FREE' };
}
export function checkReceipt(receipt, actual, now = Date.now()) {
  if (receipt.version !== 1 || !Number.isSafeInteger(receipt.createdAt) || now < receipt.createdAt || now - receipt.createdAt > 3600000) throw Error('PLAN_EXPIRED');
  for (const key of ['plan', 'source', 'configuration']) if (!digest(receipt[key]) || receipt[key] !== actual[key]) throw Error('PLAN_CHANGED');
  for (const key of ['account', 'deployment', 'state']) if (JSON.stringify(receipt[key]) !== JSON.stringify(actual[key])) throw Error('PLAN_CONTEXT_CHANGED');
}
export function checkFreeSubscription(subscription, expected) {
  if (subscription?.status !== 'ACTIVE' || subscription.planTier !== 'FREE' || subscription.planFamily !== 'CloudFront'
    || JSON.stringify([...(subscription.resourceArns ?? [])].sort()) !== JSON.stringify([...expected].sort()) || subscription.scheduledChange) throw Error('FREE_SUBSCRIPTION_REQUIRED');
}
export function checkFailedSubscriptionStack(stack, resources, subscriptions, expectedName, associatedArns) {
  if (stack?.StackName !== expectedName || stack.StackStatus !== 'ROLLBACK_COMPLETE' || !Array.isArray(resources) || resources.length !== 1
    || resources[0].LogicalResourceId !== 'Subscription' || resources[0].ResourceType !== 'AWS::PricingPlanManager::Subscription'
    || resources[0].ResourceStatus !== 'DELETE_COMPLETE' || resources[0].PhysicalResourceId
    || !Array.isArray(subscriptions) || subscriptions.some(subscription => !Array.isArray(subscription.resourceArns) || subscription.resourceArns.some(arn => associatedArns.includes(arn)))) throw Error('EMPTY_FAILED_STACK_REQUIRED');
}
/** Validate every build byte before any S3 write. No links or extra files. */
export function frontendFiles(directory, manifestDigest) {
  if (!digest(manifestDigest) || !directory.startsWith('/') || realpathSync(directory) !== resolve(directory) || !lstatSync(directory).isDirectory()) throw Error('FRONTEND_PATH_UNSAFE');
  const manifestPath = join(directory, 'manifest.json');
  if (!lstatSync(manifestPath).isFile() || lstatSync(manifestPath).isSymbolicLink()) throw Error('FRONTEND_PATH_UNSAFE');
  const bytes = readFileSync(manifestPath), manifest = JSON.parse(bytes);
  if (sha256(bytes) !== manifestDigest || manifest.version !== 1 || manifest.kind !== 'frontend' || manifest.platform !== 'browser' || !manifest.files?.['index.html']) throw Error('FRONTEND_MANIFEST_INVALID');
  const files = [];
  const walk = (prefix = '') => {
    for (const name of readdirSync(join(directory, prefix))) {
      const key = prefix ? `${prefix}/${name}` : name, path = join(directory, key), stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw Error('FRONTEND_PATH_UNSAFE');
      if (stat.isDirectory()) { if (key !== 'assets') throw Error('FRONTEND_PATH_UNSAFE'); walk(key); continue; }
      if (!stat.isFile()) throw Error('FRONTEND_PATH_UNSAFE');
      if (key === 'manifest.json') continue;
      if (!/^(?:index\.html|opensight-embed(?:-preview|-session)?\.html|assets\/[A-Za-z0-9_-]+-[A-Za-z0-9_-]{8,}\.(?:js|css|woff2|png|svg))$/.test(key)) throw Error('FRONTEND_PATH_UNSAFE');
      if (!digest(manifest.files[key]) || sha256(readFileSync(path)) !== manifest.files[key]) throw Error('FRONTEND_BYTES_CHANGED');
      files.push({ key, path, sha256: manifest.files[key], immutable: key.startsWith('assets/') });
    }
  };
  walk();
  if (files.length !== Object.keys(manifest.files).length) throw Error('FRONTEND_MANIFEST_INVALID');
  return files.sort((a, b) => a.key === 'index.html' ? 1 : b.key === 'index.html' ? -1 : Number(b.immutable) - Number(a.immutable) || a.key.localeCompare(b.key));
}
