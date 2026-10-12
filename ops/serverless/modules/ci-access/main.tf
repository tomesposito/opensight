resource "aws_iam_openid_connect_provider" "github" {
  count          = var.create_provider ? 1 : 0
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
  tags           = var.tags
  lifecycle { prevent_destroy = true }
}

resource "aws_iam_role" "ci" {
  for_each             = var.policies
  name                 = "${var.deployment}-ci-${each.key}"
  assume_role_policy   = var.trust_json
  max_session_duration = var.max_session_duration
  depends_on           = [aws_iam_openid_connect_provider.github]
  tags                 = var.tags
  lifecycle { prevent_destroy = true }
}

resource "aws_iam_role_policy" "ci" {
  for_each = var.policies
  name     = "OpenSightCiScope"
  role     = aws_iam_role.ci[each.key].id
  policy   = each.value
}

locals {
  guard_functions = [for suffix in ["request", "work", "recovery", "ingress"] : "arn:aws:lambda:${var.region}:${var.account_id}:function:${var.deployment}-${suffix}"]
  guard_group     = "${var.deployment}-ci-release"
}

resource "aws_scheduler_schedule_group" "release" {
  count = var.enable_watchdog ? 1 : 0
  name  = local.guard_group
  tags  = var.tags
}

resource "aws_iam_role" "watchdog" {
  count              = var.enable_watchdog ? 1 : 0
  name               = "${var.deployment}-ci-watchdog"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }] })
  tags               = var.tags
}

resource "aws_iam_role_policy" "watchdog" {
  count = var.enable_watchdog ? 1 : 0
  role  = aws_iam_role.watchdog[0].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = "s3:GetObject", Resource = "arn:aws:s3:::${var.operations_bucket}/ci/operations/active.json" },
    # S3 requires ListBucket to distinguish a missing lock (404) from denied access.
    # This guard has no GetObject grant for any other key, including state files.
    { Effect = "Allow", Action = "s3:ListBucket", Resource = "arn:aws:s3:::${var.operations_bucket}" },
    { Effect = "Allow", Action = "kms:Decrypt", Resource = var.operations_kms_key, Condition = { StringEquals = { "kms:ViaService" = "s3.${var.region}.amazonaws.com", "kms:EncryptionContext:aws:s3:arn" = "arn:aws:s3:::${var.operations_bucket}" } } },
    { Effect = "Allow", Action = "lambda:PutFunctionConcurrency", Resource = local.guard_functions },
    { Effect = "Allow", Action = "lambda:UpdateEventSourceMapping", Resource = [for id in var.event_mappings : "arn:aws:lambda:${var.region}:${var.account_id}:event-source-mapping:${id}"] },
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.watchdog[0].arn}:*" }
  ] })
}

resource "aws_cloudwatch_log_group" "watchdog" {
  count             = var.enable_watchdog ? 1 : 0
  name              = "/aws/lambda/${var.deployment}-ci-watchdog"
  retention_in_days = 7
  tags              = var.tags
}

resource "aws_lambda_function" "watchdog" {
  count                          = var.enable_watchdog ? 1 : 0
  function_name                  = "${var.deployment}-ci-watchdog"
  role                           = aws_iam_role.watchdog[0].arn
  runtime                        = "nodejs24.x"
  handler                        = "release-watchdog.handler"
  architectures                  = ["arm64"]
  memory_size                    = 128
  timeout                        = 30
  reserved_concurrent_executions = 1
  filename                       = var.watchdog_zip
  source_code_hash               = var.watchdog_zip != null ? filebase64sha256(var.watchdog_zip) : null
  environment { variables = { OPENSIGHT_GUARD_CONFIG = jsonencode({ bucket = var.operations_bucket, functions = local.guard_functions, mappings = var.event_mappings }) } }
  depends_on = [aws_iam_role_policy.watchdog]
  tags       = var.tags
}

resource "aws_iam_role" "watchdog_invoke" {
  count              = var.enable_watchdog ? 1 : 0
  name               = "${var.deployment}-ci-watchdog-invoke"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "scheduler.amazonaws.com" }, Action = "sts:AssumeRole", Condition = { StringEquals = { "aws:SourceAccount" = var.account_id }, ArnEquals = { "aws:SourceArn" = aws_scheduler_schedule_group.release[0].arn } } }] })
  tags               = var.tags
}

resource "aws_iam_role_policy" "watchdog_invoke" {
  count  = var.enable_watchdog ? 1 : 0
  role   = aws_iam_role.watchdog_invoke[0].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = "lambda:InvokeFunction", Resource = aws_lambda_function.watchdog[0].arn }] })
}

# Emergency inline denies are deliberately outside Terraform ownership. A normal
# apply cannot remove an incident shutoff. Recovery is a separate operator action.
