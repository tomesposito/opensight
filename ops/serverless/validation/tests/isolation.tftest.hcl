mock_provider "aws" {
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::000000000000:role/synthetic" }
  }
  mock_resource "aws_rds_cluster" {
    defaults = { master_user_secret = [{ secret_arn = "arn:aws:secretsmanager:us-east-1:000000000000:secret:synthetic-master", secret_status = "active", kms_key_id = "synthetic" }] }
  }
  mock_resource "aws_vpc" {
    defaults = { ipv6_cidr_block = "2001:db8::/56" }
  }
}
variables {
  region             = "us-east-1"
  account_id         = "000000000000"
  deployment         = "synthetic"
  availability_zones = ["us-east-1a", "us-east-1b"]
  artifact_bucket    = "synthetic-validation-artifacts"
  image_uri          = "000000000000.dkr.ecr.us-east-1.amazonaws.com/synthetic@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  alert_email        = "operator@example.invalid"
  runtime_environment = {
    OPENSIGHT_PUBLIC_ORIGIN  = "https://workspace.example.invalid"
    OPENSIGHT_INGRESS_DOMAIN = "ingress.example.invalid"
  }
}
run "isolated_validation" {
  command = plan
  assert {
    condition     = aws_rds_cluster.validation.serverlessv2_scaling_configuration[0].min_capacity == 0 && aws_rds_cluster.validation.serverlessv2_scaling_configuration[0].max_capacity == 2 && aws_rds_cluster.validation.serverlessv2_scaling_configuration[0].seconds_until_auto_pause == 300
    error_message = "Aurora must pause after five idle minutes with at most two ACUs."
  }
  assert {
    condition     = aws_rds_cluster.validation.manage_master_user_password && aws_rds_cluster.validation.deletion_protection && aws_rds_cluster.validation.storage_encrypted && !aws_rds_cluster.validation.enable_http_endpoint && !aws_rds_cluster_instance.writer.publicly_accessible
    error_message = "Database security/protection must remain enabled."
  }
  assert {
    condition     = length(aws_lambda_function.validation) == 3 && alltrue([for f in aws_lambda_function.validation : f.reserved_concurrent_executions == 1 && f.memory_size == 2048 && f.timeout <= 120 && f.ephemeral_storage[0].size == 512 && f.architectures == tolist(["arm64"]) && f.vpc_config[0].ipv6_allowed_for_dual_stack])
    error_message = "The isolated functions must retain their concurrency and runtime caps."
  }
  assert {
    condition     = aws_vpc_endpoint.s3.vpc_endpoint_type == "Gateway" && length(aws_subnet.private) == 2 && alltrue([for subnet in aws_subnet.private : !subnet.map_public_ip_on_launch])
    error_message = "Use only private subnets and a free S3 gateway endpoint."
  }
  assert {
    condition     = length(aws_secretsmanager_secret.runtime) == 3 && alltrue([for log in aws_cloudwatch_log_group.lambda : log.retention_in_days == 3]) && !aws_s3_bucket.artifacts.force_destroy
    error_message = "Secret, log, and data retention must match the experiment."
  }
}
run "least_privilege_secrets" {
  command = plan
  assert {
    condition     = !strcontains(aws_iam_role_policy.lambda["request"].policy, "synthetic-master") && !strcontains(aws_iam_role_policy.lambda["scheduler"].policy, "synthetic-master") && strcontains(aws_iam_role_policy.lambda["probe"].policy, "synthetic-master")
    error_message = "Only the private probe role may read the bootstrap credential."
  }
  assert {
    condition     = !contains(keys(aws_lambda_function.validation["request"].environment[0].variables), "OPENSIGHT_BOOTSTRAP_SECRET_ARN") && !contains(keys(aws_lambda_function.validation["scheduler"].environment[0].variables), "OPENSIGHT_BOOTSTRAP_SECRET_ARN")
    error_message = "Ordinary entrypoints must not receive bootstrap secret references."
  }
}
run "forbid_plaintext_environment" {
  command = plan
  variables { runtime_environment = { OPENSIGHT_OPERATOR_KEY = "synthetic-forbidden" } }
  expect_failures = [var.runtime_environment]
}
run "forbid_unpinned_image" {
  command = plan
  variables { image_uri = "000000000000.dkr.ecr.us-east-1.amazonaws.com/synthetic:latest" }
  expect_failures = [var.image_uri]
}
