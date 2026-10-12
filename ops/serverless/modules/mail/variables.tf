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
  description = "The single operator-approved address SES may send from and to."
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
