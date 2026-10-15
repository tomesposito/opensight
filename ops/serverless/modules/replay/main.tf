# D-79: the caller can invoke only this published replay version. It has no
# administration endpoint, function URL, bootstrap credential or SMTP privilege.
terraform {
  required_version = "= 1.13.1"
  required_providers {
    aws = { source = "hashicorp/aws", version = "= 6.68.0" }
  }
}
variable "deployment" { type = string }
variable "region" { type = string }
variable "account_id" { type = string }
variable "operator_principal_arn" { type = string }
variable "image_uri" {
  type = string
  validation {
    condition     = can(regex("@sha256:[a-f0-9]{64}$", var.image_uri))
    error_message = "Use the reviewed immutable release image."
  }
}
variable "subnet_ids" { type = list(string) }
variable "security_group_ids" { type = list(string) }
variable "runtime_environment" { type = map(string) }
variable "runtime_secret_arns" { type = list(string) }
variable "bootstrap_secret_arn" { type = string }
variable "smtp_secret_arn" { type = string }
variable "queue_arns" { type = list(string) }
variable "scheduler_group" { type = string }
variable "scheduler_role_arn" { type = string }
locals {
  name = "${var.deployment}-replay"
  environment = { for k, v in var.runtime_environment : k => v if !contains([
    "OPENSIGHT_BOOTSTRAP_SECRET_ARN", "OPENSIGHT_SMTP_SECRET_ARN", "OPENSIGHT_SMTP_PASSWORD", "OPENSIGHT_SMTP_USERNAME"
  ], k) }
}
resource "aws_cloudwatch_log_group" "replay" {
  name              = "/aws/lambda/${local.name}"
  retention_in_days = 3
}
resource "aws_iam_role" "execution" {
  name = local.name
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }
  ] })
}
resource "aws_iam_role_policy" "execution" {
  role = aws_iam_role.execution.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.replay.arn}:*" },
    { Effect = "Allow", Action = ["ec2:CreateNetworkInterface", "ec2:DescribeNetworkInterfaces", "ec2:DescribeSubnets", "ec2:DeleteNetworkInterface", "ec2:AssignPrivateIpAddresses", "ec2:UnassignPrivateIpAddresses"], Resource = "*" },
    { Effect = "Deny", Action = ["ec2:CreateNetworkInterface", "ec2:DeleteNetworkInterface", "ec2:AssignPrivateIpAddresses", "ec2:UnassignPrivateIpAddresses"], Resource = "*", Condition = { ArnEquals = { "lambda:SourceFunctionArn" = "arn:aws:lambda:${var.region}:${var.account_id}:function:${local.name}" } } },
    { Effect = "Allow", Action = "secretsmanager:GetSecretValue", Resource = var.runtime_secret_arns },
    { Effect = "Deny", Action = "secretsmanager:GetSecretValue", Resource = [var.bootstrap_secret_arn, var.smtp_secret_arn] },
    { Effect = "Allow", Action = "sqs:SendMessage", Resource = var.queue_arns },
    { Effect = "Allow", Action = ["scheduler:CreateSchedule", "scheduler:GetSchedule"], Resource = "arn:aws:scheduler:${var.region}:${var.account_id}:schedule/${var.scheduler_group}/*" },
    { Effect = "Allow", Action = "iam:PassRole", Resource = var.scheduler_role_arn, Condition = { StringEquals = { "iam:PassedToService" = "scheduler.amazonaws.com" } } }
  ] })
}
resource "aws_lambda_function" "replay" {
  function_name                  = local.name
  role                           = aws_iam_role.execution.arn
  package_type                   = "Image"
  image_uri                      = var.image_uri
  architectures                  = ["arm64"]
  timeout                        = 120
  memory_size                    = 2048
  reserved_concurrent_executions = 1
  publish                        = true
  image_config { command = ["packages/api/dist/replay-lambda.handler"] }
  environment { variables = local.environment }
  vpc_config {
    subnet_ids                  = var.subnet_ids
    security_group_ids          = var.security_group_ids
    ipv6_allowed_for_dual_stack = true
  }
  depends_on = [aws_iam_role_policy.execution, aws_cloudwatch_log_group.replay]
  lifecycle {
    precondition {
      condition = startswith(var.image_uri, "${var.account_id}.dkr.ecr.${var.region}.amazonaws.com/${var.deployment}@sha256:") && length(var.runtime_secret_arns) == 2 && alltrue([
        for arn in var.runtime_secret_arns : !contains([var.bootstrap_secret_arn, var.smtp_secret_arn], arn)
      ])
      error_message = "Replay needs the exact deployment image and separate runtime credentials."
    }
  }
}
resource "aws_iam_role" "caller" {
  name                 = "${local.name}-caller"
  max_session_duration = 3600
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Principal = { AWS = var.operator_principal_arn }, Action = "sts:AssumeRole" }
  ] })
}
resource "aws_iam_role_policy" "caller" {
  role = aws_iam_role.caller.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = "lambda:InvokeFunction", Resource = aws_lambda_function.replay.qualified_arn }
  ] })
}
output "qualified_function_arn" { value = aws_lambda_function.replay.qualified_arn }
output "caller_role_arn" { value = aws_iam_role.caller.arn }
