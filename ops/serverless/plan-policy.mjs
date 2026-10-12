/** Inspect a fully resolved saved plan. Unknown cost/security settings fail closed. */
export function checkPlan(plan, { allowPilot = false } = {}) {
  const runtime = plan.variables?.enable_runtime?.value ?? true;
  const input = Object.fromEntries(Object.entries(plan.variables ?? {}).map(([key, entry]) => [key, entry.value]));
  const profile = input.deployment_profile ?? 'validation', pilot = profile === 'pilot';
  const pilotRuntime = input.enable_pilot_runtime ?? false, consumers = input.enable_consumers ?? false;
  const issues = [], allowed = new Set([
    'aws_vpc', 'aws_subnet', 'aws_egress_only_internet_gateway', 'aws_route_table', 'aws_route_table_association', 'aws_vpc_endpoint',
    'aws_security_group', 'aws_vpc_security_group_ingress_rule', 'aws_vpc_security_group_egress_rule', 'aws_db_subnet_group',
    'aws_rds_cluster_parameter_group', 'aws_rds_cluster', 'aws_rds_cluster_instance', 'aws_secretsmanager_secret',
    'aws_s3_bucket', 'aws_s3_bucket_public_access_block', 'aws_s3_bucket_versioning', 'aws_s3_bucket_server_side_encryption_configuration', 'aws_s3_bucket_policy', 'aws_s3_bucket_lifecycle_configuration',
    'aws_iam_user', 'aws_iam_user_policy', 'aws_sesv2_email_identity', 'aws_ecr_repository', 'aws_ecr_lifecycle_policy', 'aws_sqs_queue', 'aws_scheduler_schedule_group', 'aws_iam_role', 'aws_iam_role_policy', 'aws_cloudwatch_log_group', 'aws_lambda_function', 'aws_budgets_budget',
  ]);
  if (pilot) for (const type of ['aws_lambda_event_source_mapping', 'aws_s3_bucket_cors_configuration']) allowed.add(type);
  const resources = (plan.resource_changes ?? []).filter(r => r.mode === 'managed');
  const check = (condition, code) => { if (!condition) issues.push(code); };
  check(typeof runtime === 'boolean', 'RUNTIME_STAGE');
  check(['validation', 'pilot'].includes(profile) && (!pilot || allowPilot), 'PILOT_OPERATOR_REQUIRED');
  check(typeof pilotRuntime === 'boolean' && typeof consumers === 'boolean' && (!pilotRuntime || pilot && runtime) && (!consumers || pilotRuntime), 'RUNTIME_STAGE');
  check(input.administration_image_uri == null || pilotRuntime && typeof input.administration_image_uri === 'string' && input.administration_image_uri.startsWith(`${input.account_id}.dkr.ecr.${input.region}.amazonaws.com/${input.deployment}@sha256:`)
    && /@sha256:[a-f0-9]{64}$/.test(input.administration_image_uri), 'ADMINISTRATION_IMAGE');
  check(resources.length > 0 && resources.length <= (pilot ? 100 : 70), 'RESOURCE_COUNT');
  for (const resource of resources) {
    const value = resource.change?.after ?? {}, type = resource.type;
    check(allowed.has(type), 'RESOURCE_TYPE');
    check(!resource.change.actions.includes('delete'), 'DESTRUCTIVE_PLAN');
    if (type === 'aws_lambda_function') {
      const name = /^aws_lambda_function\.(?:validation|application)\["(request|migration|probe|work|recovery)"\]$/.exec(resource.address)?.[1];
      const concurrency = pilotRuntime ? { request: 4, migration: 1, probe: 0, work: 2, recovery: 2 }[name] : 1;
      check(value.timeout <= 120 && value.memory_size === 2048 && value.reserved_concurrent_executions === concurrency, 'LAMBDA_CAP');
      if (pilot) check(name && value.timeout === (name === 'request' ? 28 : 120) && value.function_name === `${input.deployment}-${name}`
        && value.image_uri === (name === 'migration' ? input.administration_image_uri ?? input.image_uri : input.image_uri), 'PILOT_FUNCTION');
      check(value.architectures?.join() === 'arm64' && value.ephemeral_storage?.[0]?.size === 512, 'LAMBDA_PLATFORM');
      check(value.vpc_config?.[0]?.ipv6_allowed_for_dual_stack === true, 'LAMBDA_IPV6');
      check(/@sha256:[a-f0-9]{64}$/.test(value.image_uri ?? ''), 'IMAGE_PIN');
      const env = value.environment?.[0]?.variables;
      check(env?.OPENSIGHT_MAINTENANCE === 'frozen' && env.OPENSIGHT_RUNTIME === 'lambda', 'MAINTENANCE_GATE');
      check(!Object.keys(env ?? {}).some(k => /(?:PASSWORD|_KEY$|_URL$)/.test(k) && !['OPENSIGHT_PROBE_QUEUE_URL', ...(pilotRuntime ? ['OPENSIGHT_WORK_QUEUE_URL', 'OPENSIGHT_RECOVERY_QUEUE_URL'] : [])].includes(k)), 'SECRET_ENVIRONMENT');
      if (!resource.address.includes('["probe"]') && !resource.address.includes('["migration"]')) check(!env?.OPENSIGHT_BOOTSTRAP_SECRET_ARN, 'BOOTSTRAP_ACCESS');
      if (pilotRuntime && name !== 'probe') {
        check(env?.OPENSIGHT_SERVERLESS_DATA === 'durable' && env.OPENSIGHT_RELEASE_DIGEST === input.image_uri?.split('@')[1], 'DURABLE_RUNTIME');
        for (const queue of ['work', 'recovery']) {
          check(env?.[`OPENSIGHT_${queue.toUpperCase()}_QUEUE_ARN`] === `arn:aws:sqs:${input.region}:${input.account_id}:${input.deployment}-${queue}`, 'QUEUE_SCOPE');
          check(env?.[`OPENSIGHT_${queue.toUpperCase()}_QUEUE_URL`] === `https://sqs.${input.region}.amazonaws.com/${input.account_id}/${input.deployment}-${queue}`, 'QUEUE_SCOPE');
        }
      }
    }
    if (type === 'aws_iam_user') check(value.path === '/opensight-validation/' && value.force_destroy === false, 'SMTP_IDENTITY');
    if (type === 'aws_rds_cluster') {
      const scale = value.serverlessv2_scaling_configuration?.[0];
      check(scale?.min_capacity === 0 && scale?.max_capacity === 2 && scale?.seconds_until_auto_pause === 300, 'AURORA_CAP');
      check(value.deletion_protection === true && value.storage_encrypted === true && value.manage_master_user_password === true && !value.master_password && value.enable_http_endpoint === false, 'DATABASE_SECURITY');
      check(value.backup_retention_period === 1, 'BACKUP_CAP');
    }
    if (type === 'aws_rds_cluster_instance') check(value.instance_class === 'db.serverless' && value.publicly_accessible === false && value.monitoring_interval === 0 && value.performance_insights_enabled === false, 'WRITER_CAP');
    if (type === 'aws_vpc_endpoint') check(value.vpc_endpoint_type === 'Gateway' && value.service_name?.endsWith('.s3'), 'NETWORK_COST');
    if (type === 'aws_subnet') check(value.map_public_ip_on_launch === false, 'PUBLIC_IP');
    if (type === 'aws_route_table') check((value.route ?? []).every(r => r.ipv6_cidr_block === '::/0' && !r.cidr_block && !r.nat_gateway_id && !r.gateway_id), 'NETWORK_ROUTE');
    if (type === 'aws_cloudwatch_log_group') check(value.retention_in_days === 3, 'LOG_CAP');
    if (type === 'aws_s3_bucket') check(value.force_destroy === false, 'DATA_DESTRUCTION');
    if (type === 'aws_s3_bucket_public_access_block') check(['block_public_acls', 'block_public_policy', 'ignore_public_acls', 'restrict_public_buckets'].every(k => value[k] === true), 'PUBLIC_BUCKET');
    if (pilot && type === 'aws_rds_cluster') check(value.tags_all?.OpenSightStage === 'pilot' && value.cluster_identifier === input.deployment, 'PILOT_CUSTODY');
    if (pilot && type === 'aws_sqs_queue' && resource.address.startsWith('aws_sqs_queue.business')) {
      const source = resource.address.startsWith('aws_sqs_queue.business['), name = /\["(work|recovery|scheduler)"\]$/.exec(resource.address)?.[1];
      check(name && value.name === `${input.deployment}-${name}${source ? '' : '-dead'}` && value.sqs_managed_sse_enabled === true
        && value.message_retention_seconds === (source ? 345600 : 1209600), 'QUEUE_CAP');
      if (source) {
        let redrive; try { redrive = JSON.parse(value.redrive_policy); } catch { /* Rejected below. */ }
        check(value.visibility_timeout_seconds === 720 && redrive?.maxReceiveCount === 5
          && redrive?.deadLetterTargetArn === `arn:aws:sqs:${input.region}:${input.account_id}:${input.deployment}-${name}-dead`, 'QUEUE_REDRIVE');
      }
    }
    if (type === 'aws_lambda_event_source_mapping') {
      const name = /^aws_lambda_event_source_mapping\.business\["(work|recovery)"\]$/.exec(resource.address)?.[1];
      check(pilotRuntime && name && value.enabled === consumers && value.batch_size === 1 && value.maximum_batching_window_in_seconds === 0
        && value.function_response_types?.join() === 'ReportBatchItemFailures' && value.scaling_config?.[0]?.maximum_concurrency === 2
        && !value.provisioned_poller_config?.length && value.event_source_arn === `arn:aws:sqs:${input.region}:${input.account_id}:${input.deployment}-${name}`
        && value.function_name === `arn:aws:lambda:${input.region}:${input.account_id}:function:${input.deployment}-${name}`, 'CONSUMER_CAP');
    }
    if (type === 'aws_s3_bucket_cors_configuration') {
      const rule = value.cors_rule?.[0], equal = (a, b) => Array.isArray(a) && [...a].sort().join() === [...b].sort().join();
      check(pilot && resource.address === 'aws_s3_bucket_cors_configuration.artifacts[0]' && value.cors_rule?.length === 1 && value.bucket === input.artifact_bucket
        && equal(rule?.allowed_origins, [input.runtime_environment?.OPENSIGHT_PUBLIC_ORIGIN]) && equal(rule?.allowed_methods, ['GET', 'PUT', 'HEAD'])
        && equal(rule?.allowed_headers, ['content-type', 'content-length', 'x-amz-checksum-sha256', 'if-none-match', 'x-amz-server-side-encryption']) && rule?.max_age_seconds === 300, 'OBJECT_CORS');
    }
  }
  const functions = runtime ? pilotRuntime ? 5 : 3 : 0;
  for (const [type, count] of [['aws_rds_cluster', 1], ['aws_rds_cluster_instance', 1], ['aws_lambda_function', functions], ['aws_subnet', 2],
    ...(pilot ? [['aws_sqs_queue', 7], ['aws_scheduler_schedule_group', 2], ['aws_lambda_event_source_mapping', pilotRuntime ? 2 : 0], ['aws_s3_bucket_cors_configuration', 1]] : [])]) check(resources.filter(r => r.type === type).length === count, 'INVENTORY');
  if (issues.length) throw new Error(`PLAN_REJECTED:${[...new Set(issues)].sort().join(',')}`);
  return { resources: resources.length, database: '0–2 ACU / 300s pause', functions, profile, consumers, publicIngress: false };
}
