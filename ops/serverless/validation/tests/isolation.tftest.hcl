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
    condition     = !strcontains(aws_iam_role_policy.lambda["request"].policy, "synthetic-master") && strcontains(aws_iam_role_policy.lambda["migration"].policy, "synthetic-master") && strcontains(aws_iam_role_policy.lambda["probe"].policy, "synthetic-master")
    error_message = "Only the migration and probe roles may read the bootstrap credential."
  }
  assert {
    condition     = !contains(keys(aws_lambda_function.validation["request"].environment[0].variables), "OPENSIGHT_BOOTSTRAP_SECRET_ARN") && contains(keys(aws_lambda_function.validation["migration"].environment[0].variables), "OPENSIGHT_BOOTSTRAP_SECRET_ARN")
    error_message = "Only private migration/probe entrypoints receive bootstrap references."
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

run "restrict_synthetic_mail" {
  command = plan
  assert {
    condition     = aws_iam_user.smtp.path == "/opensight-validation/" && !aws_iam_user.smtp.force_destroy && jsondecode(aws_iam_user_policy.smtp.policy).Statement[0].Action == "ses:SendRawEmail" && jsondecode(aws_iam_user_policy.smtp.policy).Statement[0].Condition.StringEquals["ses:FromAddress"] == var.alert_email && jsondecode(aws_iam_user_policy.smtp.policy).Statement[0].Condition["ForAllValues:StringEquals"]["ses:Recipients"] == [var.alert_email]
    error_message = "The isolated SMTP identity may send only the approved synthetic message."
  }
}

run "pilot_dependencies" {
  command = plan
  variables { deployment_profile = "pilot" }
  assert {
    condition     = length(aws_lambda_function.validation) == 3 && aws_lambda_function.validation["probe"].reserved_concurrent_executions == 1 && length(aws_sqs_queue.business) == 2 && length(aws_sqs_queue.business_dead) == 3 && length(aws_lambda_event_source_mapping.business) == 0
    error_message = "Dependencies must preserve the isolated probe and keep consumers absent."
  }
  assert {
    condition     = aws_rds_cluster.validation.tags.OpenSightStage == "pilot" && aws_s3_bucket_lifecycle_configuration.synthetic.rule[0].filter[0].prefix == "probe/"
    error_message = "Promoted data must be protected from validation cleanup and synthetic expiration."
  }
}
run "pilot_runtime_disabled_consumers" {
  command = plan
  variables {
    deployment_profile   = "pilot"
    enable_pilot_runtime = true
  }
  assert {
    condition     = length(aws_lambda_function.validation) == 5 && aws_lambda_function.validation["request"].reserved_concurrent_executions == 4 && aws_lambda_function.validation["probe"].reserved_concurrent_executions == 0 && aws_lambda_function.validation["migration"].image_config[0].command == tolist(["packages/api/dist/aws-lambda.administration"])
    error_message = "Pilot caps must allow four requests and retire the synthetic probe."
  }
  assert {
    condition     = alltrue([for name in ["work", "recovery"] : aws_lambda_function.validation[name].reserved_concurrent_executions == 2 && aws_lambda_function.validation[name].timeout == 120 && aws_lambda_event_source_mapping.business[name].batch_size == 1 && !aws_lambda_event_source_mapping.business[name].enabled && aws_lambda_event_source_mapping.business[name].scaling_config[0].maximum_concurrency == 2])
    error_message = "Consumers must remain disabled with bounded per-queue concurrency."
  }
  assert {
    condition     = alltrue([for queue in aws_sqs_queue.business : queue.visibility_timeout_seconds == 720 && queue.message_retention_seconds == 345600 && queue.sqs_managed_sse_enabled && jsondecode(queue.redrive_policy).maxReceiveCount == 5]) && alltrue([for queue in aws_sqs_queue.business_dead : queue.message_retention_seconds == 1209600 && queue.sqs_managed_sse_enabled])
    error_message = "Queue retention, encryption and redrive must match the pilot contract."
  }
  assert {
    condition     = one(aws_s3_bucket_cors_configuration.artifacts[0].cors_rule).allowed_origins == toset([var.runtime_environment.OPENSIGHT_PUBLIC_ORIGIN]) && !contains(one(aws_s3_bucket_cors_configuration.artifacts[0].cors_rule).allowed_headers, "*")
    error_message = "Object transfers must allow only the exact origin and signed headers."
  }
}
run "pilot_consumers_selected" {
  command = plan
  variables {
    deployment_profile   = "pilot"
    enable_pilot_runtime = true
    enable_consumers     = true
  }
  assert {
    condition     = alltrue([for mapping in aws_lambda_event_source_mapping.business : mapping.enabled && mapping.function_response_types == toset(["ReportBatchItemFailures"])])
    error_message = "Activation selects both partial-failure consumers."
  }
}
run "reject_consumers_without_runtime" {
  command = plan
  variables { enable_consumers = true }
  expect_failures = [var.enable_consumers]
}

run "pilot_least_privilege" {
  command = plan
  variables {
    deployment_profile   = "pilot"
    enable_pilot_runtime = true
  }
  assert {
    condition     = alltrue([for name in ["request", "work", "recovery"] : !strcontains(aws_iam_role_policy.lambda[name].policy, "synthetic-master") && !strcontains(aws_iam_role_policy.lambda[name].policy, aws_secretsmanager_secret.runtime["smtp"].arn) && !strcontains(aws_iam_role_policy.lambda[name].policy, "\"s3:DeleteObject\"") && jsondecode(aws_iam_role_policy.lambda[name].policy).Statement[3].Resource == [aws_secretsmanager_secret.runtime["operator"].arn, aws_secretsmanager_secret.runtime["tenant"].arn]])
    error_message = "Runtime roles must not acquire bootstrap/SMTP credentials or unversioned object deletion."
  }
  assert {
    condition     = alltrue([for name in ["work", "recovery"] : jsondecode(aws_iam_role_policy.lambda[name].policy).Statement[9].Resource == aws_sqs_queue.business[name].arn]) && !strcontains(aws_iam_role_policy.lambda["request"].policy, "sqs:ReceiveMessage") && !strcontains(aws_iam_role_policy.lambda["migration"].policy, "s3:")
    error_message = "Only workers receive messages from their own queues; administration has no artifact access."
  }
  assert {
    condition     = jsondecode(aws_iam_role_policy.business_schedule[0].policy).Statement[0].Resource == ["arn:aws:sqs:us-east-1:000000000000:synthetic-work", "arn:aws:sqs:us-east-1:000000000000:synthetic-scheduler-dead"] && jsondecode(aws_iam_role.business_schedule[0].assume_role_policy).Statement[0].Condition.ArnEquals["aws:SourceArn"] == "arn:aws:scheduler:us-east-1:000000000000:schedule-group/synthetic-business"
    error_message = "Scheduler may send only through the exact group to work and its DLQ."
  }
}

override_resource {
  target = aws_secretsmanager_secret.runtime["operator"]
  values = { arn = "arn:aws:secretsmanager:us-east-1:000000000000:secret:fixture-op" }
}
override_resource {
  target = aws_secretsmanager_secret.runtime["tenant"]
  values = { arn = "arn:aws:secretsmanager:us-east-1:000000000000:secret:fixture-tenant" }
}
override_resource {
  target = aws_secretsmanager_secret.runtime["smtp"]
  values = { arn = "arn:aws:secretsmanager:us-east-1:000000000000:secret:fixture-smtp" }
}
