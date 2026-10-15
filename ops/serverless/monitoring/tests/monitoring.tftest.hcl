mock_provider "aws" {}
variables {
  region     = "us-east-1"
  account_id = "000000000000"
  deployment = "synthetic"
}
run "bounded_service_metrics" {
  command = plan
  assert {
    condition     = length(aws_cloudwatch_metric_alarm.dead) == 3 && alltrue([for kind, alarm in aws_cloudwatch_metric_alarm.dead : alarm.dimensions.QueueName == "synthetic-${kind}-dead" && alarm.namespace == "AWS/SQS" && alarm.metric_name == "ApproximateNumberOfMessagesVisible" && alarm.threshold == 0 && alarm.period == 60 && alarm.evaluation_periods == 1 && alarm.datapoints_to_alarm == 1 && alarm.statistic == "Maximum"])
    error_message = "Every exact DLQ needs a visible-message alarm."
  }
  assert {
    condition     = alltrue([for alarm in concat(values(aws_cloudwatch_metric_alarm.dead), [aws_cloudwatch_metric_alarm.backlog]) : !alarm.actions_enabled && alarm.treat_missing_data == "notBreaching" && alarm.comparison_operator == "GreaterThanThreshold"])
    error_message = "Quiet queues must not trigger recovery or notification side effects."
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.backlog.threshold == 900 && aws_cloudwatch_metric_alarm.backlog.evaluation_periods == 3 && aws_cloudwatch_metric_alarm.backlog.datapoints_to_alarm == 2 && length(aws_cloudwatch_metric_alarm.backlog.metric_query) == 3 && length([for q in aws_cloudwatch_metric_alarm.backlog.metric_query : q if q.return_data && q.expression == "MAX([work,recovery])"]) == 1 && alltrue([for q in aws_cloudwatch_metric_alarm.backlog.metric_query : q.return_data || (length(q.metric) == 1 && q.metric[0].namespace == "AWS/SQS" && q.metric[0].metric_name == "ApproximateAgeOfOldestMessage" && q.metric[0].dimensions.QueueName == "synthetic-${q.id}" && q.metric[0].period == 60 && q.metric[0].stat == "Maximum")])
    error_message = "Backlog evaluation must use only the two exact source-queue service metrics."
  }
}
run "reject_region" {
  command = plan
  variables { region = "us-west-2" }
  expect_failures = [var.region]
}
