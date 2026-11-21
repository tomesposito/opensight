mock_provider "aws" {
  mock_resource "aws_sesv2_email_identity" {
    defaults = { arn = "arn:aws:ses:us-east-1:000000000000:identity/owner@example.org" }
  }
}
variables {
  deployment  = "synthetic"
  alert_email = "owner@example.org"
}
run "independent_sender_keeps_single_recipient" {
  command = plan
  variables {
    smtp_from_address = "support@example.org"
    smtp_identity_arn = "arn:aws:ses:us-east-1:000000000000:identity/example.org"
  }
  assert {
    condition     = jsondecode(aws_iam_user_policy.smtp.policy).Statement[0].Condition.StringEquals["ses:FromAddress"] == "support@example.org" && jsondecode(aws_iam_user_policy.smtp.policy).Statement[0].Condition["ForAllValues:StringEquals"]["ses:Recipients"] == ["owner@example.org"] && jsondecode(aws_iam_user_policy.smtp.policy).Statement[0].Resource == "arn:aws:ses:us-east-1:000000000000:identity/example.org"
    error_message = "Sender separation must preserve the sandbox recipient restriction."
  }
}
run "address_requires_identity" {
  command = plan
  variables { smtp_from_address = "support@example.org" }
  expect_failures = [aws_iam_user_policy.smtp]
}
run "identity_requires_address" {
  command = plan
  variables { smtp_identity_arn = "arn:aws:ses:us-east-1:000000000000:identity/example.org" }
  expect_failures = [aws_iam_user_policy.smtp]
}
