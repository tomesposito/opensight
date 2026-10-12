output "vpc_id" {
  description = "The VPC ID."
  value       = aws_vpc.this.id
}

output "private_subnet_ids" {
  description = "The two private subnet IDs."
  value       = aws_subnet.private[*].id
}

output "lambda_security_group_id" {
  description = "Security group for Lambda functions."
  value       = aws_security_group.lambda.id
}

output "database_security_group_id" {
  description = "Security group for the database; only reachable from the Lambda group."
  value       = aws_security_group.database.id
}

output "s3_prefix_list_id" {
  description = "Prefix list ID of the S3 gateway endpoint."
  value       = aws_vpc_endpoint.s3.prefix_list_id
}
