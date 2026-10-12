output "cluster_endpoint" {
  description = "Aurora cluster writer endpoint."
  value       = aws_rds_cluster.this.endpoint
}

output "cluster_database_name" {
  description = "Database name."
  value       = aws_rds_cluster.this.database_name
}

output "master_secret_arn" {
  description = "ARN of the RDS-managed master user secret."
  value       = aws_rds_cluster.this.master_user_secret[0].secret_arn
  sensitive   = true
}

output "secret_arns" {
  description = "Map of secret reference name to ARN."
  value       = { for k, s in aws_secretsmanager_secret.runtime : k => s.arn }
  sensitive   = true
}

output "artifacts_bucket_id" {
  description = "Artifacts bucket name."
  value       = aws_s3_bucket.artifacts.id
}

output "artifacts_bucket_arn" {
  description = "Artifacts bucket ARN."
  value       = aws_s3_bucket.artifacts.arn
}

output "ecr_repository_url" {
  description = "ECR repository URL (without tag/digest)."
  value       = aws_ecr_repository.runtime.repository_url
}
