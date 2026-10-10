/** Inspect a fully resolved saved plan. Unknown cost/security settings fail closed. */
export function checkPlan(plan) {
  const issues = [], allowed = new Set([
    'aws_vpc', 'aws_subnet', 'aws_egress_only_internet_gateway', 'aws_route_table', 'aws_route_table_association', 'aws_vpc_endpoint',
    'aws_security_group', 'aws_vpc_security_group_ingress_rule', 'aws_vpc_security_group_egress_rule', 'aws_db_subnet_group',
    'aws_rds_cluster_parameter_group', 'aws_rds_cluster', 'aws_rds_cluster_instance', 'aws_secretsmanager_secret',
    'aws_s3_bucket', 'aws_s3_bucket_public_access_block', 'aws_s3_bucket_versioning', 'aws_s3_bucket_server_side_encryption_configuration', 'aws_s3_bucket_policy', 'aws_s3_bucket_lifecycle_configuration',
    'aws_iam_user', 'aws_iam_user_policy', 'aws_sesv2_email_identity', 'aws_ecr_repository', 'aws_ecr_lifecycle_policy', 'aws_sqs_queue', 'aws_scheduler_schedule_group', 'aws_iam_role', 'aws_iam_role_policy', 'aws_cloudwatch_log_group', 'aws_lambda_function', 'aws_budgets_budget',
  ]);
  const resources = (plan.resource_changes ?? []).filter(r => r.mode === 'managed');
  const check = (condition, code) => { if (!condition) issues.push(code); };
  check(resources.length > 0 && resources.length <= 70, 'RESOURCE_COUNT');
  for (const resource of resources) {
    const value = resource.change?.after ?? {}, type = resource.type;
    check(allowed.has(type), 'RESOURCE_TYPE');
    check(!resource.change.actions.includes('delete'), 'DESTRUCTIVE_PLAN');
    if (type === 'aws_lambda_function') {
      check(value.timeout <= 120 && value.memory_size === 2048 && value.reserved_concurrent_executions === 1, 'LAMBDA_CAP');
      check(value.architectures?.join() === 'arm64' && value.ephemeral_storage?.[0]?.size === 512, 'LAMBDA_PLATFORM');
      check(value.vpc_config?.[0]?.ipv6_allowed_for_dual_stack === true, 'LAMBDA_IPV6');
      check(/@sha256:[a-f0-9]{64}$/.test(value.image_uri ?? ''), 'IMAGE_PIN');
      const env = value.environment?.[0]?.variables;
      check(env?.OPENSIGHT_MAINTENANCE === 'frozen' && env.OPENSIGHT_RUNTIME === 'lambda', 'MAINTENANCE_GATE');
      check(!Object.keys(env ?? {}).some(k => /(?:PASSWORD|_KEY$|_URL$)/.test(k) && !['OPENSIGHT_PROBE_QUEUE_URL'].includes(k)), 'SECRET_ENVIRONMENT');
      if (!resource.address.includes('["probe"]') && !resource.address.includes('["migration"]')) check(!env?.OPENSIGHT_BOOTSTRAP_SECRET_ARN, 'BOOTSTRAP_ACCESS');
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
  }
  for (const [type, count] of [['aws_rds_cluster', 1], ['aws_rds_cluster_instance', 1], ['aws_lambda_function', 3], ['aws_subnet', 2]]) check(resources.filter(r => r.type === type).length === count, 'INVENTORY');
  if (issues.length) throw new Error(`PLAN_REJECTED:${[...new Set(issues)].sort().join(',')}`);
  return { resources: resources.length, database: '0–2 ACU / 300s pause', functions: 3, publicIngress: false };
}
