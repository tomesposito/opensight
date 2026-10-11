output "inventory" {
  sensitive = true
  value = {
    deployment          = var.deployment
    public_origin       = var.public_origin
    origin_domain       = var.origin_domain
    api_id              = aws_apigatewayv2_api.application.id
    distribution_id     = aws_cloudfront_distribution.application.id
    distribution_arn    = aws_cloudfront_distribution.application.arn
    distribution_host   = aws_cloudfront_distribution.application.domain_name
    web_acl_arn         = aws_wafv2_web_acl.application.arn
    subscription_arn    = aws_cloudformation_stack.plan.outputs["Arn"]
    frontend_bucket     = aws_s3_bucket.frontend.id
    request_alias       = aws_lambda_alias.request.arn
    authorizer          = aws_lambda_function.authorizer.function_name
    authorizer_id       = aws_apigatewayv2_authorizer.ingress.id
    ingress_secret_arn  = aws_secretsmanager_secret.ingress.arn
    runtime_environment = local.ingress_environment
    public_dns          = var.publish_site
  }
}
