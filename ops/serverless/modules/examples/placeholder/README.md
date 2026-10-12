# Placeholder example — NOT a real deployment

This example shows how an operator wires the reusable modules. Every
account/network/secret/identity value arrives through variables, typically
injected from the operator's private environment at plan/apply time.

Copy this directory, rename it per environment, and supply real values
through `-var`, a private `.tfvars.json` (never committed), or the
private workflow's environment. See `docs/sr4b-operator-runbook.md`.

```hcl
module "network" {
  source              = "../../modules/network"
  deployment          = var.deployment
  region              = var.region
  availability_zones  = var.availability_zones
  artifacts_bucket_arn = module.data.artifacts_bucket_arn
  tags                = var.tags
}

module "data" {
  source                   = "../../modules/data"
  deployment               = var.deployment
  subnet_ids               = module.network.private_subnet_ids
  database_security_group_id = module.network.database_security_group_id
  artifact_bucket          = var.artifact_bucket
  tags                     = var.tags
}

module "mail" {
  source      = "../../modules/mail"
  deployment  = var.deployment
  alert_email = var.alert_email # sensitive; private input only
  tags        = var.tags
}

module "compute" {
  source                   = "../../modules/compute"
  deployment               = var.deployment
  region                   = var.region
  account_id               = var.account_id # sensitive; private input only
  pilot                    = var.pilot
  subnet_ids               = module.network.private_subnet_ids
  lambda_security_group_id = module.network.lambda_security_group_id
  cluster_endpoint         = module.data.cluster_endpoint
  cluster_database_name    = module.data.cluster_database_name
  master_secret_arn        = module.data.master_secret_arn
  secret_arns              = module.data.secret_arns
  artifacts_bucket_id      = module.data.artifacts_bucket_id
  artifacts_bucket_arn     = module.data.artifacts_bucket_arn
  image_uri                = var.image_uri
  alert_email              = var.alert_email
  runtime_environment      = var.runtime_environment
  tags                     = var.tags
}

module "edge" {
  source                 = "../../modules/edge"
  deployment             = var.deployment
  region                 = var.region
  account_id             = var.account_id
  public_origin          = var.public_origin
  origin_domain          = var.origin_domain
  zone_id                = var.zone_id
  frontend_bucket        = var.frontend_bucket
  request_function_name  = module.compute.function_names["request"]
  request_function_version = var.request_function_version
  image_uri              = var.image_uri
  ingress_key_id         = var.ingress_key_id     # sensitive; private input only
  ingress_secret         = var.ingress_secret     # sensitive; private input only
  publish_site           = false                  # operator enables after acceptance
  tags                   = var.tags
}

module "ci_access" {
  source        = "../../modules/ci-access"
  deployment    = var.deployment
  region        = var.region
  account_id    = var.account_id
  trust_json    = var.oidc_trust_json  # built by ops/serverless/ci-policy.mjs
  policies      = var.ci_policies      # built by ops/serverless/ci-policy.mjs
  enable_watchdog = var.enable_watchdog
  tags          = var.tags
}
```
