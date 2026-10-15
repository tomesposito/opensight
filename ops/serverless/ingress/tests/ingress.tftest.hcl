mock_provider "aws" {
  mock_data "aws_route53_zone" {
    defaults = { name = "opensight.example." }
  }
  mock_resource "aws_apigatewayv2_api" {
    defaults = { id = "synthetic", execution_arn = "arn:aws:execute-api:us-east-1:000000000000:synthetic" }
  }
  mock_resource "aws_cloudwatch_log_group" {
    defaults = { arn = "arn:aws:logs:us-east-1:000000000000:log-group:synthetic" }
  }
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::000000000000:role/synthetic-ingress" }
  }
  mock_resource "aws_acm_certificate" {
    defaults = {
      arn = "arn:aws:acm:us-east-1:000000000000:certificate/00000000-0000-4000-8000-000000000000"
      domain_validation_options = [
        { domain_name = "opensight.example", resource_record_name = "_synthetic.opensight.example", resource_record_type = "CNAME", resource_record_value = "_synthetic.acm-validations.aws." },
        { domain_name = "api.opensight.example", resource_record_name = "_synthetic.api.opensight.example", resource_record_type = "CNAME", resource_record_value = "_synthetic.acm-validations.aws." }
      ]
    }
  }
  mock_resource "aws_secretsmanager_secret" {
    defaults = { arn = "arn:aws:secretsmanager:us-east-1:000000000000:secret:synthetic" }
  }
  mock_resource "aws_lambda_function" {
    defaults = { arn = "arn:aws:lambda:us-east-1:000000000000:function:synthetic-ingress", invoke_arn = "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:000000000000:function:synthetic-ingress/invocations" }
  }
  mock_resource "aws_cloudfront_function" {
    defaults = { arn = "arn:aws:cloudfront::000000000000:function/synthetic-viewer" }
  }
  mock_resource "aws_wafv2_web_acl" {
    defaults = { arn = "arn:aws:wafv2:us-east-1:000000000000:global/webacl/synthetic/00000000-0000-4000-8000-000000000000" }
  }
  mock_resource "aws_cloudfront_distribution" {
    defaults = { arn = "arn:aws:cloudfront::000000000000:distribution/SYNTHETIC" }
  }
  mock_resource "aws_cloudformation_stack" {
    defaults = { outputs = { Arn = "arn:aws:pricingplanmanager::000000000000:subscription:synthetic", Status = "ACTIVE", Tier = "FREE" } }
  }
}
variables {
  region                   = "us-east-1"
  account_id               = "000000000000"
  deployment               = "synthetic"
  public_origin            = "https://opensight.example"
  origin_domain            = "api.opensight.example"
  zone_id                  = "ZSYNTHETIC"
  frontend_bucket          = "synthetic-frontend-test"
  request_function_name    = "synthetic-request"
  request_function_version = "1"
  image_uri                = "000000000000.dkr.ecr.us-east-1.amazonaws.com/synthetic@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  ingress_key_id           = "synthetic"
  ingress_secret           = join("", [for unused in range(43) : "s"])
}
run "closed_until_acceptance" {
  command = plan
  assert {
    condition     = length(aws_route53_record.site) == 0 && aws_apigatewayv2_api.application.disable_execute_api_endpoint && length(aws_apigatewayv2_route.request) == 2 && alltrue([for route in aws_apigatewayv2_route.request : route.authorization_type == "CUSTOM"])
    error_message = "DNS cutover and unguarded API access must remain closed."
  }
  assert {
    condition     = aws_apigatewayv2_authorizer.ingress.authorizer_result_ttl_in_seconds == 0 && aws_lambda_alias.request.function_version == "1" && aws_lambda_permission.request.qualifier == "live"
    error_message = "Use current-key checks and a pinned request alias."
  }
  assert {
    condition     = aws_lambda_function.authorizer.timeout == 10 && aws_lambda_function.authorizer.memory_size == 256 && aws_lambda_function.authorizer.reserved_concurrent_executions == 2 && length(aws_lambda_function.authorizer.vpc_config) == 0
    error_message = "The bounded authorizer must remain outside the database network."
  }
  assert {
    condition     = keys(aws_lambda_function.authorizer.environment[0].variables) == sort(["OPENSIGHT_PUBLIC_ORIGIN", "OPENSIGHT_INGRESS_DOMAIN", "OPENSIGHT_INGRESS_API_ID", "OPENSIGHT_INGRESS_STAGE", "OPENSIGHT_INGRESS_PEER", "OPENSIGHT_INGRESS_STARTUP_ROUTE", "OPENSIGHT_INGRESS_SECRET_ARN"]) && length(jsondecode(aws_iam_role_policy.authorizer.policy).Statement) == 2 && jsondecode(aws_iam_role_policy.authorizer.policy).Statement[1].Action == "secretsmanager:GetSecretValue" && jsondecode(aws_iam_role_policy.authorizer.policy).Statement[1].Resource == aws_secretsmanager_secret.ingress.arn
    error_message = "The authorizer must receive only public ingress settings and its exact secret reference."
  }
  assert {
    condition     = length(aws_cloudfront_distribution.application.ordered_cache_behavior) == 3 && alltrue([for behavior in aws_cloudfront_distribution.application.ordered_cache_behavior : behavior.target_origin_id != "api" || (behavior.cache_policy_id == data.aws_cloudfront_cache_policy.disabled.id && behavior.viewer_protocol_policy == "https-only" && length(behavior.function_association) == 1 && behavior.response_headers_policy_id == null)])
    error_message = "Dynamic responses must not be cached, exposed over HTTP or assigned a static iframe-blocking policy."
  }
  assert {
    condition     = aws_s3_bucket_public_access_block.frontend.block_public_acls && aws_s3_bucket_public_access_block.frontend.block_public_policy && !aws_s3_bucket.frontend.force_destroy && aws_s3_bucket_versioning.frontend.versioning_configuration[0].status == "Enabled"
    error_message = "Frontend storage must remain private and retained."
  }
  assert {
    condition     = jsondecode(aws_cloudformation_stack.plan.template_body).Resources.Subscription.Properties.PlanTier == "FREE" && jsondecode(aws_cloudformation_stack.plan.template_body).Resources.Subscription.Properties.PlanFamily == "CloudFront" && length(aws_wafv2_web_acl.application.rule) == 1 && alltrue([for rule in aws_wafv2_web_acl.application.rule : !rule.visibility_config[0].sampled_requests_enabled && rule.statement[0].rate_based_statement[0].aggregate_key_type == "IP" && rule.statement[0].rate_based_statement[0].limit == 600 && rule.statement[0].rate_based_statement[0].evaluation_window_sec == 300 && length(rule.statement[0].rate_based_statement[0].scope_down_statement) == 0]) && one(aws_apigatewayv2_stage.application.route_settings).throttling_rate_limit == 0.1 && one(aws_apigatewayv2_stage.application.route_settings).throttling_burst_limit == 2
    error_message = "No paid tier, missing rate controls or sampled request bodies may enter the initial profile."
  }
}
run "reject_unpinned_code" {
  command = plan
  variables { request_function_version = "$LATEST" }
  expect_failures = [var.request_function_version]
}
run "reject_other_origin" {
  command = plan
  variables { origin_domain = "unrelated.example" }
  expect_failures = [var.origin_domain]
}

run "pilot_authorizer_capacity" {
  command = plan
  variables { authorizer_concurrency = 4 }
  assert {
    condition     = aws_lambda_function.authorizer.reserved_concurrent_executions == 4 && aws_lambda_function.authorizer.memory_size == 256 && aws_lambda_function.authorizer.timeout == 10
    error_message = "Pilot ingress adds bounded concurrency without provisioned capacity."
  }
}
run "reject_unbounded_authorizer" {
  command = plan
  variables { authorizer_concurrency = 5 }
  expect_failures = [var.authorizer_concurrency]
}
run "shared_marketing_edge" {
  command = plan
  variables {
    public_origin            = "https://app.opensight.example"
    marketing_origin         = "https://opensight.example"
    frontend_certificate_arn = "arn:aws:acm:us-east-1:000000000000:certificate/11111111-1111-4111-8111-111111111111"
    publish_site             = true
  }
  assert {
    condition     = aws_acm_certificate.site.domain_name == "opensight.example" && aws_acm_certificate.site.subject_alternative_names == toset(["api.opensight.example"]) && aws_apigatewayv2_domain_name.origin.domain_name == "api.opensight.example"
    error_message = "The API origin and its existing certificate must be retained."
  }
  assert {
    condition     = aws_cloudfront_distribution.application.aliases == toset(["opensight.example", "app.opensight.example"]) && length(aws_route53_record.site) == 2 && length(aws_route53_record.app) == 2 && aws_cloudfront_distribution.application.viewer_certificate[0].acm_certificate_arn == var.frontend_certificate_arn
    error_message = "One existing distribution serves both aliases with the reviewed shared certificate."
  }
  assert {
    condition     = length(aws_cloudfront_distribution.application.default_cache_behavior[0].function_association) == 1 && length(aws_cloudfront_distribution.application.ordered_cache_behavior[0].function_association) == 1 && strcontains(aws_cloudfront_function.static[0].code, "app.opensight.example") && strcontains(aws_cloudfront_function.viewer.code, "https://app.opensight.example") && aws_lambda_function.authorizer.environment[0].variables["OPENSIGHT_PUBLIC_ORIGIN"] == var.public_origin
    error_message = "Both static behaviors require host isolation; dynamic ingress accepts only the product origin."
  }
}
run "reject_marketing_without_certificate" {
  command = plan
  variables {
    public_origin    = "https://app.opensight.example"
    marketing_origin = "https://opensight.example"
  }
  expect_failures = [var.marketing_origin]
}
run "reject_unrelated_app" {
  command = plan
  variables {
    public_origin            = "https://other.example"
    marketing_origin         = "https://opensight.example"
    frontend_certificate_arn = "arn:aws:acm:us-east-1:000000000000:certificate/11111111-1111-4111-8111-111111111111"
  }
  expect_failures = [var.marketing_origin]
}
