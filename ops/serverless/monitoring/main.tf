terraform {
  required_version = "= 1.13.1"
  required_providers {
    aws = {
      source  = "registry.terraform.io/hashicorp/aws"
      version = "= 6.68.0"
    }
  }
  backend "s3" {}
}
provider "aws" {
  region              = var.region
  allowed_account_ids = [var.account_id]
  default_tags {
    tags = { OpenSightDeployment = var.deployment, OpenSightPurpose = "queue-monitoring", ManagedBy = "OpenTofu" }
  }
}
variable "region" {
  type = string
  validation {
    condition     = var.region == "us-east-1"
    error_message = "The initial profile uses us-east-1."
  }
}
variable "account_id" {
  type      = string
  sensitive = true
  validation {
    condition     = can(regex("^[0-9]{12}$", var.account_id))
    error_message = "An explicit account is required."
  }
}
variable "deployment" {
  type = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,35}$", var.deployment))
    error_message = "Use the existing deployment identifier."
  }
}
# No notifications or automated recovery. Operators review retained evidence.
resource "aws_cloudwatch_metric_alarm" "dead" {
  for_each            = toset(["work", "recovery", "scheduler"])
  alarm_name          = "${var.deployment}-${each.key}-dead-visible"
  alarm_description   = "Retained dead-letter evidence requires operator review; never bulk redrive or delete."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = "${var.deployment}-${each.key}-dead" }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  actions_enabled     = false
}
resource "aws_cloudwatch_metric_alarm" "backlog" {
  alarm_name          = "${var.deployment}-queue-backlog-age"
  alarm_description   = "Source queue age exceeded 15 minutes; inspect service health and exact obligations. No database polling."
  evaluation_periods  = 3
  datapoints_to_alarm = 2
  threshold           = 900
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  actions_enabled     = false
  metric_query {
    id          = "oldest"
    expression  = "MAX([work,recovery])"
    label       = "Oldest source message age"
    return_data = true
  }
  dynamic "metric_query" {
    for_each = toset(["work", "recovery"])
    content {
      id          = metric_query.value
      return_data = false
      metric {
        namespace   = "AWS/SQS"
        metric_name = "ApproximateAgeOfOldestMessage"
        dimensions  = { QueueName = "${var.deployment}-${metric_query.value}" }
        period      = 60
        stat        = "Maximum"
      }
    }
  }
}
