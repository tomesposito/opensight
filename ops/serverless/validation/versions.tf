terraform {
  required_version = "= 1.13.1"
  required_providers {
    aws = {
      source  = "registry.terraform.io/hashicorp/aws"
      version = "= 6.68.0"
    }
  }
  backend "s3" {}
}
provider "aws" {
  region              = var.region
  allowed_account_ids = [var.account_id]
  default_tags {
    tags = merge({ OpenSightDeployment = var.deployment, OpenSightPurpose = "isolated-validation", ManagedBy = "OpenTofu" }, var.deployment_profile == "pilot" ? { OpenSightStage = "pilot" } : {})
  }
}
