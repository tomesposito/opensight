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
  description = "AWS account ID; the provider must also pin allowed_account_ids."
  sensitive   = true
  validation {
    condition     = can(regex("^[0-9]{12}$", var.account_id))
    error_message = "An explicit AWS account is required."
  }
}

variable "pilot" {
  type        = bool
  description = "Enable the pilot profile (durable business queues and workers)."
  default     = false
}

variable "enable_runtime" {
  type        = bool
  description = "Create the Lambda functions. Apply dependencies first with false, then true."
  default     = true
}

variable "enable_pilot_runtime" {
  type        = bool
  description = "Enable pilot workers and consumers."
  default     = false
  validation {
    condition     = !var.enable_pilot_runtime || var.pilot
    error_message = "Pilot runtime requires the pilot profile."
  }
}

variable "enable_consumers" {
  type        = bool
  description = "Enable the SQS event source mappings."
  default     = false
  validation {
    condition     = !var.enable_consumers || var.enable_pilot_runtime
    error_message = "Consumers require the pilot runtime."
  }
}

variable "subnet_ids" {
  type        = list(string)
  description = "Private subnet IDs for Lambda VPC attachment."
}

variable "lambda_security_group_id" {
  type        = string
  description = "Security group ID for Lambda functions."
}

variable "cluster_endpoint" {
  type        = string
  description = "Aurora cluster writer endpoint."
}

variable "cluster_database_name" {
  type        = string
  description = "Database name."
}

variable "master_secret_arn" {
  type        = string
  description = "ARN of the RDS-managed master user secret."
  sensitive   = true
}

variable "secret_arns" {
  type        = map(string)
  description = "Map of runtime secret reference name to ARN (operator, tenant, smtp)."
  sensitive   = true
}

variable "artifacts_bucket_id" {
  type        = string
  description = "Artifacts bucket name."
}

variable "artifacts_bucket_arn" {
  type        = string
  description = "Artifacts bucket ARN."
}

variable "image_uri" {
  type        = string
  description = "Immutable regional ECR image digest for the runtime."
  validation {
    condition     = can(regex("^[0-9]{12}\\.dkr\\.ecr\\.[a-z0-9-]+\\.amazonaws\\.com/[a-z0-9-]+@sha256:[a-f0-9]{64}$", var.image_uri))
    error_message = "An immutable regional ECR digest is required."
  }
}

variable "administration_image_uri" {
  type        = string
  description = "Separate administration image digest, or null to reuse image_uri."
  default     = null
  validation {
    condition     = var.administration_image_uri == null || can(regex("^[0-9]{12}\\.dkr\\.ecr\\.[a-z0-9-]+\\.amazonaws\\.com/[a-z0-9-]+@sha256:[a-f0-9]{64}$", var.administration_image_uri))
    error_message = "An immutable regional ECR digest is required."
  }
}

variable "alert_email" {
  type        = string
  description = "Operator notification address for the budget alarm."
  sensitive   = true
  validation {
    condition     = can(regex("^[^ @]+@[^ @]+\\.[^ @]+$", var.alert_email))
    error_message = "Provide an operator-approved notification address privately."
  }
}

variable "runtime_environment" {
  type        = map(string)
  description = "Documented nonsecret runtime settings (allowlisted keys only)."
  validation {
    condition = alltrue([for key in keys(var.runtime_environment) : contains([
      "OPENSIGHT_PUBLIC_ORIGIN", "OPENSIGHT_INGRESS_DOMAIN", "OPENSIGHT_INGRESS_API_ID", "OPENSIGHT_INGRESS_STAGE",
      "OPENSIGHT_AUTH_ISSUER", "OPENSIGHT_AUTH_AUDIENCE", "OPENSIGHT_AUTH_KEY_ID", "OPENSIGHT_SESSION_SECONDS", "OPENSIGHT_INVITATION_SECONDS",
      "OPENSIGHT_NODE_LIMITS", "OPENSIGHT_TENANT_LIMIT_DEFAULTS", "OPENSIGHT_ENTITLEMENTS",
      "OPENSIGHT_INGRESS_PEER", "OPENSIGHT_INGRESS_STARTUP_ROUTE"
    ], key)])
    error_message = "Runtime inputs may contain only the documented nonsecret settings."
  }
}

variable "budget_limit_usd" {
  type        = string
  description = "Monthly budget limit in USD (notify-only; budgets do not cap spend)."
  default     = "25"
}

variable "budget_thresholds" {
  type        = list(number)
  description = "Absolute USD thresholds for budget notifications."
  default     = [10, 20]
}

variable "tags" {
  type        = map(string)
  description = "Additional tags merged onto every resource."
  default     = {}
}
