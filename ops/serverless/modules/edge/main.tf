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
  tags                      = var.tags
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
  tags                    = var.tags
  lifecycle { prevent_destroy = true }
}

# Secret values arrive via protected inputs only; never committed files.
resource "aws_secretsmanager_secret_version" "ingress" {
  secret_id     = aws_secretsmanager_secret.ingress.id
  secret_string = jsonencode({ ingressKeys = jsonencode([{ id = var.ingress_key_id, secret = var.ingress_secret }]) })
}

resource "aws_iam_role" "authorizer" {
  name               = "${var.deployment}-ingress"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }] })
  tags               = var.tags
}

resource "aws_cloudwatch_log_group" "authorizer" {
  name              = "/aws/lambda/${var.deployment}-ingress"
  retention_in_days = 3
  tags              = var.tags
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
  lifecycle { ignore_changes = [image_uri] }
  depends_on = [aws_iam_role_policy.authorizer, aws_secretsmanager_secret_version.ingress]
  tags       = var.tags
}

resource "aws_lambda_alias" "request" {
  name             = "live"
  function_name    = var.request_function_name
  function_version = var.request_function_version
  # The release controller owns alias versions; Terraform must not undo a release.
  lifecycle { ignore_changes = [function_version] }
}

resource "aws_apigatewayv2_api" "application" {
  name                         = "${var.deployment}-application"
  protocol_type                = "HTTP"
  ip_address_type              = "dualstack"
  disable_execute_api_endpoint = true
  tags                         = var.tags
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
  tags              = var.tags
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
  tags       = var.tags
}

resource "aws_apigatewayv2_domain_name" "origin" {
  domain_name = var.origin_domain
  domain_name_configuration {
    certificate_arn = aws_acm_certificate_validation.site.certificate_arn
    endpoint_type   = "REGIONAL"
    ip_address_type = "dualstack"
    security_policy = "TLS_1_2"
  }
  tags = var.tags
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

resource "aws_s3_bucket" "frontend" {
  bucket        = var.frontend_bucket
  force_destroy = false
  tags          = var.tags
  lifecycle { prevent_destroy = true }
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket                  = aws_s3_bucket.frontend.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  rule { object_ownership = "BucketOwnerEnforced" }
}

resource "aws_s3_bucket_versioning" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_policy" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Sid = "RequireTLS", Effect = "Deny", Principal = "*", Action = "s3:*",
      Resource = [aws_s3_bucket.frontend.arn, "${aws_s3_bucket.frontend.arn}/*"],
      Condition = { Bool = { "aws:SecureTransport" = "false" } } },
    { Sid = "OnlyThisDistribution", Effect = "Allow", Principal = { Service = "cloudfront.amazonaws.com" },
      Action = "s3:GetObject", Resource = "${aws_s3_bucket.frontend.arn}/frontend/*",
      Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.application.arn } } }
  ] })
}

resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "${var.deployment}-frontend"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

data "aws_cloudfront_cache_policy" "disabled" { name = "Managed-CachingDisabled" }
data "aws_cloudfront_cache_policy" "assets" { name = "Managed-CachingOptimized" }
data "aws_cloudfront_origin_request_policy" "api" { name = "Managed-AllViewerExceptHostHeader" }
data "aws_cloudfront_response_headers_policy" "static" { name = "Managed-SecurityHeadersPolicy" }

resource "aws_cloudfront_function" "viewer" {
  name    = "${var.deployment}-viewer"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = replace(replace(file("${path.module}/edge-viewer.js"), "__OPENSIGHT_ORIGIN__", jsonencode(var.public_origin)), "__OPENSIGHT_HOST__", jsonencode(local.site_host))
}

resource "aws_wafv2_web_acl" "application" {
  name  = "${var.deployment}-application"
  scope = "CLOUDFRONT"
  default_action {
    allow {}
  }
  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.deployment}-edge"
    sampled_requests_enabled   = false
  }
  rule {
    name     = "all_ip"
    priority = 0
    action {
      block {}
    }
    statement {
      rate_based_statement {
        aggregate_key_type    = "IP"
        limit                 = var.waf_rate_limit
        evaluation_window_sec = 300
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.deployment}-all-ip"
      sampled_requests_enabled   = false
    }
  }
  tags = var.tags
}

resource "aws_cloudfront_distribution" "application" {
  enabled             = true
  is_ipv6_enabled     = true
  aliases             = [local.site_host]
  default_root_object = "index.html"
  http_version        = "http2and3"
  price_class         = "PriceClass_All"
  web_acl_id          = aws_wafv2_web_acl.application.arn
  wait_for_deployment = true
  retain_on_delete    = true
  origin {
    origin_id                = "frontend"
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_path              = "/frontend"
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }
  origin {
    origin_id           = "api"
    domain_name         = var.origin_domain
    connection_attempts = 1
    connection_timeout  = 5
    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_protocol_policy   = "https-only"
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_read_timeout      = 30
      origin_keepalive_timeout = 5
    }
    custom_header {
      name  = "x-opensight-ingress-key-id"
      value = var.ingress_key_id
    }
    custom_header {
      name  = "x-opensight-ingress-secret"
      value = var.ingress_secret
    }
    custom_header {
      name  = "x-opensight-ingress-origin"
      value = var.public_origin
    }
  }
  default_cache_behavior {
    target_origin_id           = "frontend"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = data.aws_cloudfront_cache_policy.disabled.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.static.id
    compress                   = true
  }
  ordered_cache_behavior {
    path_pattern               = "/assets/*"
    target_origin_id           = "frontend"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = data.aws_cloudfront_cache_policy.assets.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.static.id
    compress                   = true
  }
  dynamic "ordered_cache_behavior" {
    for_each = ["/api/*", "/embed/sessions/*"]
    content {
      path_pattern             = ordered_cache_behavior.value
      target_origin_id         = "api"
      viewer_protocol_policy   = "https-only"
      allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
      cached_methods           = ["GET", "HEAD"]
      cache_policy_id          = data.aws_cloudfront_cache_policy.disabled.id
      origin_request_policy_id = data.aws_cloudfront_origin_request_policy.api.id
      compress                 = true
      function_association {
        event_type   = "viewer-request"
        function_arn = aws_cloudfront_function.viewer.arn
      }
    }
  }
  restrictions {
    geo_restriction { restriction_type = "none" }
  }
  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.site.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
  depends_on = [aws_apigatewayv2_api_mapping.origin, aws_route53_record.origin]
  lifecycle { prevent_destroy = true }
  tags = var.tags
}

resource "aws_cloudformation_stack" "plan" {
  count = var.enable_free_plan ? 1 : 0
  name  = "${var.deployment}-free-edge"
  template_body = jsonencode({ AWSTemplateFormatVersion = "2010-09-09", Resources = {
    Subscription = { Type = "AWS::PricingPlanManager::Subscription", Properties = { PlanFamily = "CloudFront", PlanTier = "FREE", UsageLevel = "DEFAULT", ResourceArns = [aws_cloudfront_distribution.application.arn, aws_wafv2_web_acl.application.arn, "arn:aws:route53:::hostedzone/${var.zone_id}"] } }
    }, Outputs = {
    Arn = { Value = { Ref = "Subscription" } }, Status = { Value = { "Fn::GetAtt" = ["Subscription", "Status"] } }, Tier = { Value = { "Fn::GetAtt" = ["Subscription", "CurrentPlanTier"] } }
  } })
  tags = var.tags
  lifecycle { prevent_destroy = true }
}

resource "aws_route53_record" "site" {
  for_each = var.publish_site ? toset(["A", "AAAA"]) : toset([])
  zone_id  = var.zone_id
  name     = local.site_host
  type     = each.value
  alias {
    name                   = aws_cloudfront_distribution.application.domain_name
    zone_id                = aws_cloudfront_distribution.application.hosted_zone_id
    evaluate_target_health = false
  }
  lifecycle {
    precondition {
      condition     = !var.enable_free_plan || try(aws_cloudformation_stack.plan[0].outputs["Status"] == "ACTIVE" && aws_cloudformation_stack.plan[0].outputs["Tier"] == "FREE", false)
      error_message = "Public cutover requires the active Free subscription and separate operator acceptance."
    }
  }
}
