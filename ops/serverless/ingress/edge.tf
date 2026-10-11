resource "aws_s3_bucket" "frontend" {
  bucket        = var.frontend_bucket
  force_destroy = false
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
    { Sid = "RequireTLS", Effect = "Deny", Principal = "*", Action = "s3:*", Resource = [aws_s3_bucket.frontend.arn, "${aws_s3_bucket.frontend.arn}/*"], Condition = { Bool = { "aws:SecureTransport" = "false" } } },
    { Sid = "OnlyThisDistribution", Effect = "Allow", Principal = { Service = "cloudfront.amazonaws.com" }, Action = "s3:GetObject", Resource = "${aws_s3_bucket.frontend.arn}/frontend/*", Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.application.arn } } }
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
  code    = replace(replace(file("${path.module}/../edge-viewer.js"), "__OPENSIGHT_ORIGIN__", jsonencode(var.public_origin)), "__OPENSIGHT_HOST__", jsonencode(local.site_host))
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
  dynamic "rule" {
    for_each = { startup_ip = { priority = 0, aggregate = "IP", limit = 30 }, startup_global = { priority = 1, aggregate = "CONSTANT", limit = 300 } }
    content {
      name     = rule.key
      priority = rule.value.priority
      action {
        block {}
      }
      statement {
        rate_based_statement {
          aggregate_key_type    = rule.value.aggregate
          limit                 = rule.value.limit
          evaluation_window_sec = 300
          scope_down_statement {
            byte_match_statement {
              positional_constraint = "EXACTLY"
              search_string         = "/api/api/startup"
              field_to_match {
                uri_path {}
              }
              text_transformation {
                priority = 0
                type     = "NONE"
              }
            }
          }
        }
      }
      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = "${var.deployment}-${rule.key}"
        sampled_requests_enabled   = false
      }
    }
  }
  rule {
    name     = "dynamic_ip"
    priority = 2
    action {
      block {}
    }
    statement {
      rate_based_statement {
        aggregate_key_type    = "IP"
        limit                 = 600
        evaluation_window_sec = 300
        scope_down_statement {
          or_statement {
            dynamic "statement" {
              for_each = ["/api/", "/embed/sessions/"]
              content {
                byte_match_statement {
                  positional_constraint = "STARTS_WITH"
                  search_string         = statement.value
                  field_to_match {
                    uri_path {}
                  }
                  text_transformation {
                    priority = 0
                    type     = "NONE"
                  }
                }
              }
            }
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.deployment}-dynamic-ip"
      sampled_requests_enabled   = false
    }
  }
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
}
resource "aws_cloudformation_stack" "plan" {
  name = "${var.deployment}-free-edge"
  template_body = jsonencode({ AWSTemplateFormatVersion = "2010-09-09", Resources = {
    Subscription = { Type = "AWS::PricingPlanManager::Subscription", Properties = { PlanFamily = "CloudFront", PlanTier = "FREE", UsageLevel = "DEFAULT", ResourceArns = [aws_cloudfront_distribution.application.arn, aws_wafv2_web_acl.application.arn, "arn:aws:route53:::hostedzone/${var.zone_id}"] } }
    }, Outputs = {
    Arn = { Value = { Ref = "Subscription" } }, Status = { Value = { "Fn::GetAtt" = ["Subscription", "Status"] } }, Tier = { Value = { "Fn::GetAtt" = ["Subscription", "CurrentPlanTier"] } }
  } })
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
      condition     = try(aws_cloudformation_stack.plan.outputs["Status"] == "ACTIVE" && aws_cloudformation_stack.plan.outputs["Tier"] == "FREE", false)
      error_message = "Public cutover requires the active Free subscription and separate operator acceptance."
    }
  }
}
