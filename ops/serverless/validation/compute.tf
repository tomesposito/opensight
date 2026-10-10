locals {
  functions = {
    request   = { timeout = 28, handler = "packages/api/dist/aws-lambda.handler" }
    scheduler = { timeout = 120, handler = "packages/api/dist/aws-lambda.scheduler" }
    probe     = { timeout = 120, handler = "packages/api/dist/platform-probe.handler" }
  }
  assume_lambda = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }] })
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
  for_each = local.functions
  role     = aws_iam_role.lambda[each.key].id
  policy = jsonencode({ Version = "2012-10-17", Statement = concat([
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.lambda[each.key].arn}:*" },
    { Effect = "Allow", Action = ["ec2:CreateNetworkInterface", "ec2:DescribeNetworkInterfaces", "ec2:DescribeSubnets", "ec2:DeleteNetworkInterface", "ec2:AssignPrivateIpAddresses", "ec2:UnassignPrivateIpAddresses"], Resource = "*" },
    # Lambda's service needs ENI permissions; application code may not use them.
    { Effect = "Deny", Action = ["ec2:CreateNetworkInterface", "ec2:DeleteNetworkInterface", "ec2:AssignPrivateIpAddresses", "ec2:UnassignPrivateIpAddresses"], Resource = "*", Condition = { ArnEquals = { "lambda:SourceFunctionArn" = "arn:aws:lambda:${var.region}:${var.account_id}:function:${var.deployment}-${each.key}" } } },
    { Effect = "Allow", Action = "secretsmanager:GetSecretValue", Resource = [aws_secretsmanager_secret.runtime["operator"].arn, aws_secretsmanager_secret.runtime["tenant"].arn] }
    ], [for statement in [
      { Effect = "Allow", Action = "secretsmanager:GetSecretValue", Resource = [aws_rds_cluster.validation.master_user_secret[0].secret_arn, aws_secretsmanager_secret.runtime["smtp"].arn] },
      { Effect = "Allow", Action = ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject", "s3:DeleteObject", "s3:DeleteObjectVersion"], Resource = "${aws_s3_bucket.artifacts.arn}/probe/*" },
      { Effect = "Allow", Action = ["sqs:SendMessage", "sqs:ReceiveMessage", "sqs:DeleteMessage"], Resource = aws_sqs_queue.probe.arn },
      { Effect = "Allow", Action = ["scheduler:CreateSchedule", "scheduler:DeleteSchedule"], Resource = "arn:aws:scheduler:${var.region}:${var.account_id}:schedule/${aws_scheduler_schedule_group.probe.name}/*" },
      { Effect = "Allow", Action = "iam:PassRole", Resource = aws_iam_role.schedule.arn, Condition = { StringEquals = { "iam:PassedToService" = "scheduler.amazonaws.com" } } }
  ] : statement if each.key == "probe"]) })
}
resource "aws_lambda_function" "validation" {
  for_each                       = local.functions
  function_name                  = "${var.deployment}-${each.key}"
  role                           = aws_iam_role.lambda[each.key].arn
  package_type                   = "Image"
  image_uri                      = var.image_uri
  architectures                  = ["arm64"]
  timeout                        = each.value.timeout
  memory_size                    = 2048
  reserved_concurrent_executions = 1
  ephemeral_storage { size = 512 }
  image_config { command = [each.value.handler] }
  vpc_config {
    subnet_ids                  = aws_subnet.private[*].id
    security_group_ids          = [aws_security_group.lambda.id]
    ipv6_allowed_for_dual_stack = true
  }
  environment {
    variables = merge(local.environment, each.key == "probe" ? {
      OPENSIGHT_VALIDATION              = "isolated"
      OPENSIGHT_BOOTSTRAP_SECRET_ARN    = aws_rds_cluster.validation.master_user_secret[0].secret_arn
      OPENSIGHT_ARTIFACT_BUCKET         = aws_s3_bucket.artifacts.id
      OPENSIGHT_PROBE_QUEUE_URL         = aws_sqs_queue.probe.url
      OPENSIGHT_PROBE_SCHEDULE_GROUP    = aws_scheduler_schedule_group.probe.name
      OPENSIGHT_PROBE_SCHEDULE_ROLE_ARN = aws_iam_role.schedule.arn
      OPENSIGHT_SMTP_SECRET_ARN         = aws_secretsmanager_secret.runtime["smtp"].arn
      OPENSIGHT_PROBE_MAIL_FROM         = var.alert_email
      OPENSIGHT_PROBE_MAIL_TO           = var.alert_email
    } : {})
  }
  depends_on = [aws_iam_role_policy.lambda, aws_cloudwatch_log_group.lambda, aws_route_table_association.private]
  lifecycle {
    precondition {
      condition     = startswith(var.image_uri, "${var.account_id}.dkr.ecr.${var.region}.amazonaws.com/${var.deployment}@sha256:")
      error_message = "The image must belong to this exact deployment repository and account."
    }
  }
}
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
