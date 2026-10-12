resource "aws_sesv2_email_identity" "alert" {
  email_identity = var.alert_email
}

resource "aws_iam_user" "smtp" {
  name          = "${var.deployment}-smtp"
  path          = var.iam_path
  force_destroy = false
  tags          = var.tags
  lifecycle { prevent_destroy = true }
}

resource "aws_iam_user_policy" "smtp" {
  name = "approved-synthetic-mail-only"
  user = aws_iam_user.smtp.name
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect   = "Allow"
    Action   = "ses:SendRawEmail"
    Resource = aws_sesv2_email_identity.alert.arn
    Condition = {
      StringEquals                = { "ses:FromAddress" = var.alert_email }
      "ForAllValues:StringEquals" = { "ses:Recipients" = [var.alert_email] }
    }
  }] })
}

# No aws_iam_access_key or secret-version resource: key material never enters state.
