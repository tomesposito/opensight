output "email_identity_arn" {
  description = "ARN of the SES email identity."
  value       = aws_sesv2_email_identity.alert.arn
}

output "smtp_user_name" {
  description = "Name of the locked-down SMTP IAM user."
  value       = aws_iam_user.smtp.name
}
