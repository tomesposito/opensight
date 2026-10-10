variable "region" {
  type = string
  validation {
    condition     = var.region == "us-east-1"
    error_message = "This measured validation profile is limited to us-east-1."
  }
}
variable "enable_runtime" {
  type        = bool
  default     = true
  description = "The operator first applies dependencies with this false, then plans fully resolved Lambda environments."
}
variable "account_id" {
  type      = string
  sensitive = true
  validation {
    condition     = can(regex("^[0-9]{12}$", var.account_id))
    error_message = "An explicit AWS account is required."
  }
}
variable "deployment" {
  type = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,35}$", var.deployment))
    error_message = "Use a short deployment identifier."
  }
}
variable "availability_zones" {
  type = list(string)
  validation {
    condition     = length(distinct(var.availability_zones)) == 2 && alltrue([for az in var.availability_zones : can(regex("^us-east-1[a-z]$", az))])
    error_message = "Exactly two distinct us-east-1 availability zones are required."
  }
}
variable "artifact_bucket" {
  type = string
  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$", var.artifact_bucket))
    error_message = "Supply a private globally unique bucket name."
  }
}
variable "image_uri" {
  type = string
  validation {
    condition     = can(regex("^[0-9]{12}\\.dkr\\.ecr\\.us-east-1\\.amazonaws\\.com/[a-z0-9-]+@sha256:[a-f0-9]{64}$", var.image_uri))
    error_message = "An immutable regional ECR digest is required."
  }
}
variable "alert_email" {
  type      = string
  sensitive = true
  validation {
    condition     = can(regex("^[^ @]+@[^ @]+\\.[^ @]+$", var.alert_email))
    error_message = "Provide an operator-approved notification address privately."
  }
}
variable "runtime_environment" {
  type = map(string)
  validation {
    condition = alltrue([for key in keys(var.runtime_environment) : contains([
      "OPENSIGHT_PUBLIC_ORIGIN", "OPENSIGHT_INGRESS_DOMAIN", "OPENSIGHT_INGRESS_API_ID", "OPENSIGHT_INGRESS_STAGE",
      "OPENSIGHT_AUTH_ISSUER", "OPENSIGHT_AUTH_AUDIENCE", "OPENSIGHT_AUTH_KEY_ID", "OPENSIGHT_SESSION_SECONDS", "OPENSIGHT_INVITATION_SECONDS",
      "OPENSIGHT_NODE_LIMITS", "OPENSIGHT_TENANT_LIMIT_DEFAULTS"
    ], key)])
    error_message = "Runtime inputs may contain only the documented nonsecret settings."
  }
}
