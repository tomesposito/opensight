variable "region" {
  type = string
  validation {
    condition     = var.region == "us-east-1"
    error_message = "The initial measured profile uses us-east-1."
  }
}
variable "account_id" {
  type      = string
  sensitive = true
  validation {
    condition     = can(regex("^[0-9]{12}$", var.account_id))
    error_message = "An explicit account is required."
  }
}
variable "deployment" {
  type = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,35}$", var.deployment))
    error_message = "Use the existing deployment identifier."
  }
}
variable "public_origin" {
  type = string
  validation {
    condition     = can(regex("^https://[a-z0-9][a-z0-9.-]{1,250}[a-z0-9]$", var.public_origin))
    error_message = "Supply an exact HTTPS DNS origin, without a port or path."
  }
}
variable "origin_domain" {
  type = string
  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]{1,250}[a-z0-9]$", var.origin_domain)) && var.origin_domain != trimprefix(var.public_origin, "https://") && endswith(var.origin_domain, ".${trimprefix(coalesce(var.marketing_origin, var.public_origin), "https://")}")
    error_message = "The API origin must be a separate subdomain of the public site."
  }
}
variable "zone_id" {
  type = string
  validation {
    condition     = can(regex("^Z[A-Z0-9]{1,32}$", var.zone_id))
    error_message = "Supply the existing public hosted zone ID."
  }
}
variable "frontend_bucket" {
  type = string
  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$", var.frontend_bucket))
    error_message = "Supply a private globally unique bucket name."
  }
}
variable "request_function_name" {
  type = string
  validation {
    condition     = var.request_function_name == "${var.deployment}-request"
    error_message = "Only the existing deployment request function may receive ingress."
  }
}
variable "request_function_version" {
  type = string
  validation {
    condition     = can(regex("^[1-9][0-9]*$", var.request_function_version))
    error_message = "Publish and review a numeric function version before selecting it."
  }
}
variable "image_uri" {
  type = string
  validation {
    condition     = can(regex("^[0-9]{12}\\.dkr\\.ecr\\.us-east-1\\.amazonaws\\.com/[a-z0-9-]+@sha256:[a-f0-9]{64}$", var.image_uri)) && startswith(var.image_uri, "${var.account_id}.dkr.ecr.${var.region}.amazonaws.com/${var.deployment}@sha256:")
    error_message = "Use the exact owned, reviewed ECR digest."
  }
}
variable "ingress_key_id" {
  type      = string
  sensitive = true
  validation {
    condition     = can(regex("^[A-Za-z0-9_-]{1,80}$", var.ingress_key_id))
    error_message = "Supply the current private ingress key ID."
  }
}
variable "ingress_secret" {
  type      = string
  sensitive = true
  validation {
    condition     = can(regex("^[A-Za-z0-9_-]{43,128}$", var.ingress_secret))
    error_message = "Supply the current private ingress secret through protected inputs."
  }
}
variable "publish_site" {
  type        = bool
  default     = false
  description = "Private release operator enables this only after Free-plan and live application acceptance."
}
variable "authorizer_concurrency" {
  type    = number
  default = 2
  validation {
    condition     = contains([2, 4], var.authorizer_concurrency)
    error_message = "Use two validation slots or four pilot slots."
  }
}

variable "marketing_origin" {
  type        = string
  default     = null
  description = "Optional apex marketing origin; public_origin then selects the app subdomain."
  validation {
    condition = var.marketing_origin == null ? var.frontend_certificate_arn == null : (
      can(regex("^https://[a-z0-9][a-z0-9.-]+[a-z0-9]$", var.marketing_origin)) &&
      var.public_origin == replace(var.marketing_origin, "https://", "https://app.") &&
      var.frontend_certificate_arn != null
    )
    error_message = "Marketing requires the exact apex/app origin pair and a reviewed shared certificate."
  }
}
variable "frontend_certificate_arn" {
  type        = string
  default     = null
  sensitive   = true
  description = "Issued us-east-1 certificate covering both frontend aliases; preserve the API origin certificate."
  validation {
    condition = var.frontend_certificate_arn == null ? true : can(regex(
      "^arn:aws:acm:us-east-1:${var.account_id}:certificate/[a-f0-9-]{36}$", var.frontend_certificate_arn
    ))
    error_message = "The shared certificate must belong to this account and edge region."
  }
}
