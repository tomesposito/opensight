terraform {
  required_version = "= 1.13.1"
  required_providers {
    aws = { source = "registry.terraform.io/hashicorp/aws", version = "= 6.68.0" }
  }
  backend "s3" {}
}
variable "account_id" { type = string }
variable "region" { type = string }
variable "deployment" { type = string }
variable "trust_json" { type = string }
variable "policies" { type = map(string) }
variable "create_provider" { type = bool }
provider "aws" {
  region              = var.region
  allowed_account_ids = [var.account_id]
  default_tags { tags = { OpenSightDeployment = var.deployment, OpenSightPurpose = "ci-access", ManagedBy = "OpenTofu" } }
}
resource "aws_iam_openid_connect_provider" "github" {
  count          = var.create_provider ? 1 : 0
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
  lifecycle { prevent_destroy = true }
}
resource "aws_iam_role" "ci" {
  for_each             = var.policies
  name                 = "${var.deployment}-ci-${each.key}"
  assume_role_policy   = var.trust_json
  max_session_duration = 3600
  depends_on           = [aws_iam_openid_connect_provider.github]
  lifecycle { prevent_destroy = true }
}
resource "aws_iam_role_policy" "ci" {
  for_each = var.policies
  name     = "OpenSightCiScope"
  role     = aws_iam_role.ci[each.key].id
  policy   = each.value
}
output "roles" { value = { for name, role in aws_iam_role.ci : name => role.arn } }
# Emergency inline denies are deliberately outside Terraform ownership. A normal
# apply cannot remove an incident shutoff. Recovery is a separate operator action.
