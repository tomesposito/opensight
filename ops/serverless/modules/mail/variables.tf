variable "deployment" {
  type        = string
  description = "Short deployment identifier used in resource names."
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,35}$", var.deployment))
    error_message = "Use a short deployment identifier."
  }
}

variable "alert_email" {
  type        = string
  description = "The single operator-approved sandbox destination and default sender."
  sensitive   = true
  validation {
    condition     = can(regex("^[^ @]+@[^ @]+\\.[^ @]+$", var.alert_email))
    error_message = "Provide an operator-approved notification address privately."
  }
}

variable "iam_path" {
  type        = string
  description = "IAM path for the SMTP user."
  default     = "/opensight/"
}

variable "tags" {
  type        = map(string)
  description = "Additional tags merged onto every resource."
  default     = {}
}

variable "smtp_from_address" {
  type        = string
  description = "Optional verified application sender, independent of the alert recipient."
  sensitive   = true
  default     = null
  validation {
    condition     = var.smtp_from_address == null ? true : can(regex("^[^ @\\r\\n]+@[^ @\\r\\n]+\\.[^ @\\r\\n]+$", var.smtp_from_address))
    error_message = "Provide one verified sender address privately."
  }
}

variable "smtp_identity_arn" {
  type        = string
  description = "Existing verified SES identity ARN authorizing smtp_from_address; required with that address."
  sensitive   = true
  default     = null
  validation {
    condition     = var.smtp_identity_arn == null ? true : can(regex("^arn:aws:ses:[a-z0-9-]+:[0-9]{12}:identity/[^ *]+$", var.smtp_identity_arn))
    error_message = "Provide one exact SES identity ARN privately."
  }
}
