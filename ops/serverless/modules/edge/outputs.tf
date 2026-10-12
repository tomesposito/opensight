output "distribution_id" {
  description = "CloudFront distribution ID."
  value       = aws_cloudfront_distribution.application.id
}

output "distribution_arn" {
  description = "CloudFront distribution ARN."
  value       = aws_cloudfront_distribution.application.arn
}

output "frontend_bucket_id" {
  description = "Frontend bucket name."
  value       = aws_s3_bucket.frontend.id
}

output "api_id" {
  description = "API Gateway HTTP API ID."
  value       = aws_apigatewayv2_api.application.id
}

output "origin_domain" {
  description = "API origin domain name."
  value       = var.origin_domain
}

output "ingress_secret_arn" {
  description = "ARN of the ingress Secrets Manager secret (reference only)."
  value       = aws_secretsmanager_secret.ingress.arn
  sensitive   = true
}
