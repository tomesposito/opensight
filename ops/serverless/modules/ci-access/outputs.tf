output "roles" {
  description = "Map of CI role name to ARN."
  value       = { for name, role in aws_iam_role.ci : name => role.arn }
}

output "oidc_provider_arn" {
  description = "ARN of the GitHub OIDC provider, or null when not created."
  value       = var.create_provider ? aws_iam_openid_connect_provider.github[0].arn : null
}
