locals {
  site_host   = trimprefix(var.public_origin, "https://")
  request_arn = "arn:aws:lambda:${var.region}:${var.account_id}:function:${var.request_function_name}"
  ingress_environment = {
    OPENSIGHT_PUBLIC_ORIGIN         = var.public_origin
    OPENSIGHT_INGRESS_DOMAIN        = var.origin_domain
    OPENSIGHT_INGRESS_API_ID        = aws_apigatewayv2_api.application.id
    OPENSIGHT_INGRESS_STAGE         = "$default"
    OPENSIGHT_INGRESS_PEER          = "viewer-function"
    OPENSIGHT_INGRESS_STARTUP_ROUTE = "separate"
  }
}
data "aws_route53_zone" "existing" {
  zone_id      = var.zone_id
  private_zone = false
}
resource "aws_acm_certificate" "site" {
  domain_name               = local.site_host
  subject_alternative_names = [var.origin_domain]
  validation_method         = "DNS"
  lifecycle {
    create_before_destroy = true
    precondition {
      condition     = !data.aws_route53_zone.existing.private_zone && trimsuffix(data.aws_route53_zone.existing.name, ".") == local.site_host
      error_message = "The explicit zone must be the site's existing public apex zone."
    }
  }
}
resource "aws_route53_record" "certificate" {
  for_each = { for record in aws_acm_certificate.site.domain_validation_options : record.domain_name => record }
  zone_id  = var.zone_id
  name     = each.value.resource_record_name
  type     = each.value.resource_record_type
  records  = [each.value.resource_record_value]
  ttl      = 300
}
resource "aws_acm_certificate_validation" "site" {
  certificate_arn         = aws_acm_certificate.site.arn
  validation_record_fqdns = [for record in aws_route53_record.certificate : record.fqdn]
}
resource "aws_secretsmanager_secret" "ingress" {
  name                    = "${var.deployment}/ingress"
  recovery_window_in_days = 7
  lifecycle { prevent_destroy = true }
}
resource "aws_secretsmanager_secret_version" "ingress" {
  secret_id     = aws_secretsmanager_secret.ingress.id
  secret_string = jsonencode({ ingressKeys = jsonencode([{ id = var.ingress_key_id, secret = var.ingress_secret }]) })
}
resource "aws_iam_role" "authorizer" {
  name               = "${var.deployment}-ingress"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }] })
}
resource "aws_cloudwatch_log_group" "authorizer" {
  name              = "/aws/lambda/${var.deployment}-ingress"
  retention_in_days = 3
}
resource "aws_iam_role_policy" "authorizer" {
  role = aws_iam_role.authorizer.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.authorizer.arn}:*" },
    { Effect = "Allow", Action = "secretsmanager:GetSecretValue", Resource = aws_secretsmanager_secret.ingress.arn }
  ] })
}
resource "aws_lambda_function" "authorizer" {
  function_name                  = "${var.deployment}-ingress"
  role                           = aws_iam_role.authorizer.arn
  package_type                   = "Image"
  image_uri                      = var.image_uri
  architectures                  = ["arm64"]
  timeout                        = 10
  memory_size                    = 256
  reserved_concurrent_executions = var.authorizer_concurrency
  image_config { command = ["packages/api/dist/aws-authorizer.handler"] }
  environment {
    variables = merge(local.ingress_environment, { OPENSIGHT_INGRESS_SECRET_ARN = aws_secretsmanager_secret.ingress.arn })
  }
  depends_on = [aws_iam_role_policy.authorizer, aws_secretsmanager_secret_version.ingress]
}
resource "aws_lambda_alias" "request" {
  name             = "live"
  function_name    = var.request_function_name
  function_version = var.request_function_version
}
resource "aws_apigatewayv2_api" "application" {
  name                         = "${var.deployment}-application"
  protocol_type                = "HTTP"
  ip_address_type              = "dualstack"
  disable_execute_api_endpoint = true
}
resource "aws_apigatewayv2_authorizer" "ingress" {
  api_id                            = aws_apigatewayv2_api.application.id
  name                              = "ingress"
  authorizer_type                   = "REQUEST"
  authorizer_uri                    = aws_lambda_function.authorizer.invoke_arn
  identity_sources                  = ["$request.header.x-opensight-ingress-secret", "$request.header.x-opensight-ingress-key-id"]
  authorizer_payload_format_version = "2.0"
  enable_simple_responses           = true
  authorizer_result_ttl_in_seconds  = 0
}
resource "aws_lambda_permission" "authorizer" {
  statement_id  = "OnlyApplicationAuthorizer"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.authorizer.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.application.execution_arn}/authorizers/${aws_apigatewayv2_authorizer.ingress.id}"
}
resource "aws_apigatewayv2_integration" "request" {
  api_id                 = aws_apigatewayv2_api.application.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_alias.request.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 29000
}
resource "aws_apigatewayv2_route" "request" {
  for_each           = toset(["$default", "POST /api/api/startup"])
  api_id             = aws_apigatewayv2_api.application.id
  route_key          = each.value
  target             = "integrations/${aws_apigatewayv2_integration.request.id}"
  authorization_type = "CUSTOM"
  authorizer_id      = aws_apigatewayv2_authorizer.ingress.id
}
resource "aws_lambda_permission" "request" {
  statement_id  = "OnlyApplicationApi"
  action        = "lambda:InvokeFunction"
  function_name = var.request_function_name
  qualifier     = aws_lambda_alias.request.name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.application.execution_arn}/*/*"
}
resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/apigateway/${var.deployment}"
  retention_in_days = 3
}
resource "aws_apigatewayv2_stage" "application" {
  api_id      = aws_apigatewayv2_api.application.id
  name        = "$default"
  auto_deploy = true
  default_route_settings {
    throttling_rate_limit  = 5
    throttling_burst_limit = 10
  }
  route_settings {
    route_key              = "POST /api/api/startup"
    throttling_rate_limit  = 0.1
    throttling_burst_limit = 2
  }
  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api.arn
    format          = jsonencode({ requestId = "$context.requestId", status = "$context.status", integrationStatus = "$context.integrationStatus", responseLength = "$context.responseLength" })
  }
  depends_on = [aws_apigatewayv2_route.request]
}
resource "aws_apigatewayv2_domain_name" "origin" {
  domain_name = var.origin_domain
  domain_name_configuration {
    certificate_arn = aws_acm_certificate_validation.site.certificate_arn
    endpoint_type   = "REGIONAL"
    ip_address_type = "dualstack"
    security_policy = "TLS_1_2"
  }
}
resource "aws_apigatewayv2_api_mapping" "origin" {
  api_id      = aws_apigatewayv2_api.application.id
  domain_name = aws_apigatewayv2_domain_name.origin.id
  stage       = aws_apigatewayv2_stage.application.id
}
resource "aws_route53_record" "origin" {
  for_each = toset(["A", "AAAA"])
  zone_id  = var.zone_id
  name     = var.origin_domain
  type     = each.value
  alias {
    name                   = aws_apigatewayv2_domain_name.origin.domain_name_configuration[0].target_domain_name
    zone_id                = aws_apigatewayv2_domain_name.origin.domain_name_configuration[0].hosted_zone_id
    evaluate_target_health = false
  }
}
