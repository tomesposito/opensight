mock_provider "aws" {
  mock_resource "aws_iam_role" { defaults = { arn = "arn:aws:iam::000000000000:role/synthetic-replay" } }
}
variables {
  deployment             = "synthetic"
  region                 = "us-east-1"
  account_id             = "000000000000"
  operator_principal_arn = "arn:aws:iam::000000000000:user/operator"
  image_uri              = "000000000000.dkr.ecr.us-east-1.amazonaws.com/synthetic@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  subnet_ids             = ["subnet-synthetic"]
  security_group_ids     = ["sg-synthetic"]
  runtime_secret_arns    = ["arn:aws:secretsmanager:us-east-1:000000000000:secret:operator-abcdef", "arn:aws:secretsmanager:us-east-1:000000000000:secret:tenant-abcdef"]
  bootstrap_secret_arn   = "arn:aws:secretsmanager:us-east-1:000000000000:secret:bootstrap-abcdef"
  smtp_secret_arn        = "arn:aws:secretsmanager:us-east-1:000000000000:secret:smtp-abcdef"
  queue_arns             = ["arn:aws:sqs:us-east-1:000000000000:synthetic-work", "arn:aws:sqs:us-east-1:000000000000:synthetic-recovery"]
  scheduler_group        = "synthetic-business"
  scheduler_role_arn     = "arn:aws:iam::000000000000:role/synthetic-schedule"
  runtime_environment = {
    OPENSIGHT_RUNTIME              = "lambda"
    OPENSIGHT_BOOTSTRAP_SECRET_ARN = "must-be-removed"
    OPENSIGHT_SMTP_SECRET_ARN      = "must-be-removed"
  }
}
run "private_replay_only" {
  command = plan
  assert {
    condition     = aws_lambda_function.replay.publish && aws_lambda_function.replay.reserved_concurrent_executions == 1 && aws_lambda_function.replay.image_config[0].command[0] == "packages/api/dist/replay-lambda.handler"
    error_message = "Replay must be a bounded, version-published, separate entrypoint."
  }
  assert {
    condition     = !contains(keys(aws_lambda_function.replay.environment[0].variables), "OPENSIGHT_BOOTSTRAP_SECRET_ARN") && !contains(keys(aws_lambda_function.replay.environment[0].variables), "OPENSIGHT_SMTP_SECRET_ARN")
    error_message = "Replay must not receive bootstrap or mail credential references."
  }
}
run "reject_inline_credentials" {
  command = plan
  variables { runtime_environment = { OPENSIGHT_POSTGRES_OPERATOR_URL = "postgresql://forbidden" } }
  expect_failures = [var.runtime_environment]
}
run "reject_root_principal" {
  command = plan
  variables { operator_principal_arn = "arn:aws:iam::000000000000:root" }
  expect_failures = [var.operator_principal_arn]
}
