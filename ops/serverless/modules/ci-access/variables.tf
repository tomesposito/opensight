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

variable "trust_json" {
  type        = string
  description = "OIDC assume-role trust policy JSON (pinned subject, see ci-policy.mjs)."
  validation {
    condition     = can(jsondecode(var.trust_json))
    error_message = "Supply a valid trust policy document."
  }
}

variable "policies" {
  type        = map(string)
  description = "Map of role name to scoped permission policy JSON."
  validation {
    condition     = alltrue([for p in values(var.policies) : can(jsondecode(p))])
    error_message = "Each policy must be a valid policy document."
  }
}

variable "create_provider" {
  type        = bool
  description = "Create the GitHub OIDC provider (false when it already exists)."
  default     = true
}

variable "max_session_duration" {
  type        = number
  description = "Maximum CI role session duration in seconds."
  default     = 3600
}

variable "enable_watchdog" {
  type        = bool
  description = "Deploy the release watchdog guard."
  default     = false
}

variable "watchdog_zip" {
  type        = string
  description = "Path to the watchdog deployment package."
  default     = null
}

variable "operations_bucket" {
  type        = string
  description = "Operations bucket name for the watchdog guard record."
  default     = null
}

variable "operations_kms_key" {
  type        = string
  description = "KMS key ARN for the operations bucket."
  default     = null
  sensitive   = true
}

variable "event_mappings" {
  type        = list(string)
  description = "Event source mapping UUIDs the watchdog may disable."
  default     = []
}

variable "tags" {
  type        = map(string)
  description = "Additional tags merged onto every resource."
  default     = {}
}
