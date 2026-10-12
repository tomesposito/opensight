variable "deployment" {
  type        = string
  description = "Short deployment identifier used in resource names."
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,35}$", var.deployment))
    error_message = "Use a short deployment identifier."
  }
}

variable "region" {
  type        = string
  description = "AWS region."
}

variable "account_id" {
  type        = string
  description = "AWS account ID."
  sensitive   = true
  validation {
    condition     = can(regex("^[0-9]{12}$", var.account_id))
    error_message = "An explicit account is required."
  }
}

variable "public_origin" {
  type        = string
  description = "Exact HTTPS DNS origin of the public site, without port or path."
  validation {
    condition     = can(regex("^https://[a-z0-9][a-z0-9.-]{1,250}[a-z0-9]$", var.public_origin))
    error_message = "Supply an exact HTTPS DNS origin, without a port or path."
  }
}

variable "origin_domain" {
  type        = string
  description = "API origin subdomain of the public site."
  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]{1,250}[a-z0-9]$", var.origin_domain))
    error_message = "Supply the API origin subdomain."
  }
}

variable "zone_id" {
  type        = string
  description = "Existing public hosted zone ID for the site apex."
  validation {
    condition     = can(regex("^Z[A-Z0-9]{1,32}$", var.zone_id))
    error_message = "Supply the existing public hosted zone ID."
  }
}

variable "frontend_bucket" {
  type        = string
  description = "Private globally unique bucket name for the hosted frontend."
  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$", var.frontend_bucket))
    error_message = "Supply a private globally unique bucket name."
  }
}

variable "request_function_name" {
  type        = string
  description = "Name of the existing request Lambda function receiving ingress."
}

variable "request_function_version" {
  type        = string
  description = "Published numeric function version to select."
  validation {
    condition     = can(regex("^[1-9][0-9]*$", var.request_function_version))
    error_message = "Publish and review a numeric function version before selecting it."
  }
}

variable "image_uri" {
  type        = string
  description = "Immutable regional ECR image digest for the authorizer."
  validation {
    condition     = can(regex("^[0-9]{12}\\.dkr\\.ecr\\.[a-z0-9-]+\\.amazonaws\\.com/[a-z0-9-]+@sha256:[a-f0-9]{64}$", var.image_uri))
    error_message = "An immutable regional ECR digest is required."
  }
}

variable "ingress_key_id" {
  type        = string
  description = "Current private ingress key ID (protected input)."
  sensitive   = true
}

variable "ingress_secret" {
  type        = string
  description = "Current private ingress secret (protected input)."
  sensitive   = true
}

variable "publish_site" {
  type        = bool
  description = "Enable only after free-plan and live application acceptance."
  default     = false
}

variable "authorizer_concurrency" {
  type        = number
  description = "Reserved concurrency for the authorizer."
  default     = 2
  validation {
    condition     = var.authorizer_concurrency >= 1 && var.authorizer_concurrency <= 4
    error_message = "Use a small bounded authorizer concurrency."
  }
}

variable "waf_rate_limit" {
  type        = number
  description = "WAF per-IP request limit per evaluation window."
  default     = 600
}

variable "enable_free_plan" {
  type        = bool
  description = "Create the CloudFront free-plan subscription stack; cutover requires it ACTIVE when enabled."
  default     = true
}

variable "tags" {
  type        = map(string)
  description = "Additional tags merged onto every resource."
  default     = {}
}
