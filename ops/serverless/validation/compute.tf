locals {
  pilot = var.deployment_profile == "pilot"
  functions = merge({
    request   = { timeout = 28, concurrency = var.enable_pilot_runtime ? 4 : 1, handler = "packages/api/dist/aws-lambda.handler" }
    migration = { timeout = 120, concurrency = 1, handler = var.enable_pilot_runtime ? "packages/api/dist/aws-lambda.administration" : "packages/api/dist/aws-lambda.migration" }
    probe     = { timeout = 120, concurrency = var.enable_pilot_runtime ? 0 : 1, handler = "packages/api/dist/platform-probe.handler" }
    }, local.pilot ? {
    work     = { timeout = 120, concurrency = 2, handler = "packages/api/dist/aws-lambda.scheduler" }
    recovery = { timeout = 120, concurrency = 2, handler = "packages/api/dist/aws-lambda.scheduler" }
  } : {})
  active_functions = { for name, settings in local.functions : name => settings if !contains(["work", "recovery"], name) || var.enable_pilot_runtime }
  assume_lambda    = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }] })
  environment = merge(var.runtime_environment, {
    OPENSIGHT_RUNTIME             = "lambda"
    OPENSIGHT_MODE                = "hosted"
    OPENSIGHT_DEPLOYMENT          = var.deployment
    OPENSIGHT_MAINTENANCE         = "frozen"
    OPENSIGHT_DB_HOST             = aws_rds_cluster.validation.endpoint
    OPENSIGHT_DB_PORT             = "5432"
    OPENSIGHT_DB_NAME             = aws_rds_cluster.validation.database_name
    OPENSIGHT_OPERATOR_SECRET_ARN = aws_secretsmanager_secret.runtime["operator"].arn
    OPENSIGHT_TENANT_SECRET_ARN   = aws_secretsmanager_secret.runtime["tenant"].arn
  })
  pilot_environment = var.enable_pilot_runtime ? merge(local.environment, {
    OPENSIGHT_SERVERLESS_DATA    = "durable"
    OPENSIGHT_EGRESS_PROFILE     = "ipv6"
    OPENSIGHT_SMTP_HOST          = "email-smtp.${var.region}.api.aws"
    OPENSIGHT_SMTP_PORT          = "465"
    OPENSIGHT_SMTP_FROM          = var.alert_email
    OPENSIGHT_SMTP_SECRET_ARN    = aws_secretsmanager_secret.runtime["smtp"].arn
    OPENSIGHT_RELEASE_DIGEST     = split("@", var.image_uri)[1]
    OPENSIGHT_ARTIFACT_BUCKET    = aws_s3_bucket.artifacts.id
    OPENSIGHT_WORK_QUEUE_URL     = aws_sqs_queue.business["work"].url
    OPENSIGHT_WORK_QUEUE_ARN     = aws_sqs_queue.business["work"].arn
    OPENSIGHT_RECOVERY_QUEUE_URL = aws_sqs_queue.business["recovery"].url
    OPENSIGHT_RECOVERY_QUEUE_ARN = aws_sqs_queue.business["recovery"].arn
    OPENSIGHT_SCHEDULER_GROUP    = aws_scheduler_schedule_group.business[0].name
    OPENSIGHT_SCHEDULER_ROLE_ARN = aws_iam_role.business_schedule[0].arn
    OPENSIGHT_SCHEDULER_DLQ_ARN  = aws_sqs_queue.business_dead["scheduler"].arn
  }) : local.environment
  # Keep each function's credential references explicit and separate.
  function_environment = {
    request  = local.pilot_environment
    work     = local.pilot_environment
    recovery = local.pilot_environment
    migration = merge(local.pilot_environment, {
      OPENSIGHT_BOOTSTRAP_SECRET_ARN = aws_rds_cluster.validation.master_user_secret[0].secret_arn
    })
    probe = merge(local.environment, {
      OPENSIGHT_VALIDATION              = "isolated"
      OPENSIGHT_BOOTSTRAP_SECRET_ARN    = aws_rds_cluster.validation.master_user_secret[0].secret_arn
      OPENSIGHT_ARTIFACT_BUCKET         = aws_s3_bucket.artifacts.id
      OPENSIGHT_PROBE_QUEUE_URL         = aws_sqs_queue.probe.url
      OPENSIGHT_PROBE_SCHEDULE_GROUP    = aws_scheduler_schedule_group.probe.name
      OPENSIGHT_PROBE_SCHEDULE_ROLE_ARN = aws_iam_role.schedule.arn
      OPENSIGHT_SMTP_SECRET_ARN         = aws_secretsmanager_secret.runtime["smtp"].arn
      OPENSIGHT_PROBE_MAIL_FROM         = var.alert_email
      OPENSIGHT_PROBE_MAIL_TO           = var.alert_email
    })
  }
}
resource "aws_sqs_queue" "dead" {
  name                      = "${var.deployment}-probe-dead"
  message_retention_seconds = 86400
  sqs_managed_sse_enabled   = true
}
resource "aws_sqs_queue" "probe" {
  name                       = "${var.deployment}-probe"
  message_retention_seconds  = 3600
  visibility_timeout_seconds = 360
  sqs_managed_sse_enabled    = true
  redrive_policy             = jsonencode({ deadLetterTargetArn = aws_sqs_queue.dead.arn, maxReceiveCount = 2 })
}
resource "aws_scheduler_schedule_group" "probe" { name = "${var.deployment}-probe" }
resource "aws_iam_role" "schedule" {
  name               = "${var.deployment}-schedule"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "scheduler.amazonaws.com" }, Action = "sts:AssumeRole", Condition = { StringEquals = { "aws:SourceAccount" = var.account_id }, ArnEquals = { "aws:SourceArn" = aws_scheduler_schedule_group.probe.arn } } }] })
}
resource "aws_iam_role_policy" "schedule" {
  role   = aws_iam_role.schedule.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = "sqs:SendMessage", Resource = aws_sqs_queue.probe.arn }] })
}
resource "aws_iam_role" "lambda" {
  for_each           = local.functions
  name               = "${var.deployment}-${each.key}"
  assume_role_policy = local.assume_lambda
}
resource "aws_cloudwatch_log_group" "lambda" {
  for_each          = local.functions
  name              = "/aws/lambda/${var.deployment}-${each.key}"
  retention_in_days = 3
}
resource "aws_iam_role_policy" "lambda" {
  for_each = local.active_functions
  role     = aws_iam_role.lambda[each.key].id
  policy = jsonencode({ Version = "2012-10-17", Statement = concat([
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.lambda[each.key].arn}:*" },
    { Effect = "Allow", Action = ["ec2:CreateNetworkInterface", "ec2:DescribeNetworkInterfaces", "ec2:DescribeSubnets", "ec2:DeleteNetworkInterface", "ec2:AssignPrivateIpAddresses", "ec2:UnassignPrivateIpAddresses"], Resource = "*" },
    # Lambda's service needs ENI permissions; application code may not use them.
    { Effect = "Deny", Action = ["ec2:CreateNetworkInterface", "ec2:DeleteNetworkInterface", "ec2:AssignPrivateIpAddresses", "ec2:UnassignPrivateIpAddresses"], Resource = "*", Condition = { ArnEquals = { "lambda:SourceFunctionArn" = "arn:aws:lambda:${var.region}:${var.account_id}:function:${var.deployment}-${each.key}" } } },
    { Effect = "Allow", Action = "secretsmanager:GetSecretValue", Resource = concat([aws_secretsmanager_secret.runtime["operator"].arn, aws_secretsmanager_secret.runtime["tenant"].arn], each.key == "migration" ? [aws_rds_cluster.validation.master_user_secret[0].secret_arn] : [], each.key == "work" ? [aws_secretsmanager_secret.runtime["smtp"].arn] : []) }
    ], [for statement in [
      { Effect = "Allow", Action = "secretsmanager:GetSecretValue", Resource = [aws_rds_cluster.validation.master_user_secret[0].secret_arn, aws_secretsmanager_secret.runtime["smtp"].arn] },
      { Effect = "Allow", Action = ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject", "s3:DeleteObject", "s3:DeleteObjectVersion"], Resource = "${aws_s3_bucket.artifacts.arn}/probe/*" },
      { Effect = "Allow", Action = ["sqs:SendMessage", "sqs:ReceiveMessage", "sqs:DeleteMessage"], Resource = aws_sqs_queue.probe.arn },
      { Effect = "Allow", Action = ["scheduler:CreateSchedule", "scheduler:DeleteSchedule"], Resource = "arn:aws:scheduler:${var.region}:${var.account_id}:schedule/${aws_scheduler_schedule_group.probe.name}/*" },
      { Effect = "Allow", Action = "iam:PassRole", Resource = aws_iam_role.schedule.arn, Condition = { StringEquals = { "iam:PassedToService" = "scheduler.amazonaws.com" } } }
      ] : statement if each.key == "probe"], jsondecode(var.enable_pilot_runtime && contains(["request", "work", "recovery"], each.key) ? jsonencode([
        { Effect = "Allow", Action = ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject", "s3:DeleteObjectVersion"], Resource = ["${aws_s3_bucket.artifacts.arn}/objects/v1/*", "${aws_s3_bucket.artifacts.arn}/artifacts/v1/*"] },
        { Effect = "Allow", Action = "s3:ListBucket", Resource = aws_s3_bucket.artifacts.arn },
        { Effect = "Allow", Action = "sqs:SendMessage", Resource = [aws_sqs_queue.business["work"].arn, aws_sqs_queue.business["recovery"].arn] },
        { Effect = "Allow", Action = ["scheduler:CreateSchedule", "scheduler:GetSchedule"], Resource = "arn:aws:scheduler:${var.region}:${var.account_id}:schedule/${aws_scheduler_schedule_group.business[0].name}/*" },
        { Effect = "Allow", Action = "iam:PassRole", Resource = aws_iam_role.business_schedule[0].arn, Condition = { StringEquals = { "iam:PassedToService" = "scheduler.amazonaws.com" } } }
        ]) : "[]"), jsondecode(var.enable_pilot_runtime && contains(["work", "recovery"], each.key) ? jsonencode([
        { Effect = "Allow", Action = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"], Resource = aws_sqs_queue.business[each.key].arn }
  ]) : "[]")) })
}
resource "aws_lambda_function" "validation" {
  for_each                       = { for name, value in local.active_functions : name => value if var.enable_runtime && !contains(["request", "work", "recovery"], name) }
  function_name                  = "${var.deployment}-${each.key}"
  role                           = aws_iam_role.lambda[each.key].arn
  package_type                   = "Image"
  image_uri                      = each.key == "migration" && var.administration_image_uri != null ? var.administration_image_uri : var.image_uri
  architectures                  = ["arm64"]
  timeout                        = each.value.timeout
  memory_size                    = 2048
  reserved_concurrent_executions = each.value.concurrency
  ephemeral_storage { size = 512 }
  image_config { command = [each.value.handler] }
  vpc_config {
    subnet_ids                  = aws_subnet.private[*].id
    security_group_ids          = [aws_security_group.lambda.id]
    ipv6_allowed_for_dual_stack = true
  }
  environment {
    variables = local.function_environment[each.key]
  }
  depends_on = [aws_iam_role_policy.lambda, aws_cloudwatch_log_group.lambda, aws_route_table_association.private]
  lifecycle {
    precondition {
      condition     = startswith(var.image_uri, "${var.account_id}.dkr.ecr.${var.region}.amazonaws.com/${var.deployment}@sha256:") && (var.administration_image_uri == null ? true : startswith(var.administration_image_uri, "${var.account_id}.dkr.ecr.${var.region}.amazonaws.com/${var.deployment}@sha256:"))
      error_message = "The image must belong to this exact deployment repository and account."
    }
  }
}
resource "aws_lambda_function" "application" {
  for_each                       = { for name, value in local.active_functions : name => value if var.enable_runtime && contains(["request", "work", "recovery"], name) }
  function_name                  = "${var.deployment}-${each.key}"
  role                           = aws_iam_role.lambda[each.key].arn
  package_type                   = "Image"
  image_uri                      = each.key == "migration" && var.administration_image_uri != null ? var.administration_image_uri : var.image_uri
  architectures                  = ["arm64"]
  timeout                        = each.value.timeout
  memory_size                    = 2048
  reserved_concurrent_executions = each.value.concurrency
  ephemeral_storage { size = 512 }
  image_config { command = [each.value.handler] }
  vpc_config {
    subnet_ids                  = aws_subnet.private[*].id
    security_group_ids          = [aws_security_group.lambda.id]
    ipv6_allowed_for_dual_stack = true
  }
  environment {
    variables = local.function_environment[each.key]
  }
  depends_on = [aws_iam_role_policy.lambda, aws_cloudwatch_log_group.lambda, aws_route_table_association.private]
  lifecycle {
    ignore_changes = [image_uri]
    precondition {
      condition     = startswith(var.image_uri, "${var.account_id}.dkr.ecr.${var.region}.amazonaws.com/${var.deployment}@sha256:") && (var.administration_image_uri == null ? true : startswith(var.administration_image_uri, "${var.account_id}.dkr.ecr.${var.region}.amazonaws.com/${var.deployment}@sha256:"))
      error_message = "The image must belong to this exact deployment repository and account."
    }
  }
}
moved {
  from = aws_lambda_function.validation["request"]
  to   = aws_lambda_function.application["request"]
}

moved {
  from = aws_lambda_function.validation["work"]
  to   = aws_lambda_function.application["work"]
}

moved {
  from = aws_lambda_function.validation["recovery"]
  to   = aws_lambda_function.application["recovery"]
}
locals { deployed_functions = merge(aws_lambda_function.validation, aws_lambda_function.application) }
resource "aws_budgets_budget" "validation" {
  name         = var.deployment
  budget_type  = "COST"
  limit_amount = "25"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"
  dynamic "notification" {
    for_each = [10, 20]
    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = notification.value
      threshold_type             = "ABSOLUTE_VALUE"
      notification_type          = "ACTUAL"
      subscriber_email_addresses = [var.alert_email]
    }
  }
}
