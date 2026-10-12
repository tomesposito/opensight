terraform {
  required_version = "= 1.13.1"
  required_providers {
    aws = {
      source  = "registry.terraform.io/hashicorp/aws"
      version = "= 6.68.0"
    }
  }
}
