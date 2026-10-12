# Additive dependencies can be reviewed before enabling the pilot runtime.
resource "aws_sqs_queue" "business_dead" {
  for_each                  = local.pilot ? toset(["work", "recovery", "scheduler"]) : toset([])
  name                      = "${var.deployment}-${each.key}-dead"
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true
}
resource "aws_sqs_queue" "business" {
  for_each                   = local.pilot ? toset(["work", "recovery"]) : toset([])
  name                       = "${var.deployment}-${each.key}"
  message_retention_seconds  = 345600
  visibility_timeout_seconds = 720
  sqs_managed_sse_enabled    = true
  depends_on                 = [aws_sqs_queue.business_dead]
  redrive_policy             = jsonencode({ deadLetterTargetArn = "arn:aws:sqs:${var.region}:${var.account_id}:${var.deployment}-${each.key}-dead", maxReceiveCount = 5 })
}
resource "aws_scheduler_schedule_group" "business" {
  count = local.pilot ? 1 : 0
  name  = "${var.deployment}-business"
}
resource "aws_iam_role" "business_schedule" {
  count = local.pilot ? 1 : 0
  name  = "${var.deployment}-business-schedule"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "scheduler.amazonaws.com" }, Action = "sts:AssumeRole", Condition = {
    StringEquals = { "aws:SourceAccount" = var.account_id }, ArnEquals = { "aws:SourceArn" = "arn:aws:scheduler:${var.region}:${var.account_id}:schedule-group/${var.deployment}-business" }
  } }] })
}
resource "aws_iam_role_policy" "business_schedule" {
  count = local.pilot ? 1 : 0
  role  = aws_iam_role.business_schedule[0].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = "sqs:SendMessage", Resource = [
    "arn:aws:sqs:${var.region}:${var.account_id}:${var.deployment}-work",
    "arn:aws:sqs:${var.region}:${var.account_id}:${var.deployment}-scheduler-dead"
  ] }] })
}
resource "aws_lambda_event_source_mapping" "business" {
  for_each                           = var.enable_pilot_runtime ? toset(["work", "recovery"]) : toset([])
  event_source_arn                   = aws_sqs_queue.business[each.key].arn
  function_name                      = "arn:aws:lambda:${var.region}:${var.account_id}:function:${var.deployment}-${each.key}"
  enabled                            = var.enable_consumers
  batch_size                         = 1
  maximum_batching_window_in_seconds = 0
  function_response_types            = ["ReportBatchItemFailures"]
  scaling_config { maximum_concurrency = 2 }
  depends_on = [aws_lambda_function.validation, aws_lambda_function.application]
}
resource "aws_s3_bucket_cors_configuration" "artifacts" {
  count  = local.pilot ? 1 : 0
  bucket = aws_s3_bucket.artifacts.id
  cors_rule {
    allowed_origins = [var.runtime_environment["OPENSIGHT_PUBLIC_ORIGIN"]]
    allowed_methods = ["PUT", "GET", "HEAD"]
    allowed_headers = ["content-type", "content-length", "x-amz-checksum-sha256", "if-none-match", "x-amz-server-side-encryption"]
    expose_headers  = ["ETag", "x-amz-version-id", "x-amz-checksum-sha256", "Content-Length", "Content-Type"]
    max_age_seconds = 300
  }
}
