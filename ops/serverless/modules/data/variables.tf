variable "deployment" {
  type        = string
  description = "Short deployment identifier used in resource names."
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,35}$", var.deployment))
    error_message = "Use a short deployment identifier."
  }
}

variable "subnet_ids" {
  type        = list(string)
  description = "Private subnet IDs for the DB subnet group."
  validation {
    condition     = length(var.subnet_ids) >= 2
    error_message = "At least two subnets are required."
  }
}

variable "database_security_group_id" {
  type        = string
  description = "Security group ID for the Aurora cluster."
}

variable "artifact_bucket" {
  type        = string
  description = "Private globally unique bucket name for artifacts."
  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$", var.artifact_bucket))
    error_message = "Supply a private globally unique bucket name."
  }
}

variable "engine_version" {
  type        = string
  description = "Aurora PostgreSQL engine version."
  default     = "16.15"
}

variable "max_capacity" {
  type        = number
  description = "Aurora Serverless v2 maximum capacity in ACUs."
  default     = 2
}

variable "auto_pause_seconds" {
  type        = number
  description = "Seconds of inactivity before Aurora auto-pauses."
  default     = 300
}

variable "secret_names" {
  type        = list(string)
  description = "Secret reference names under the deployment prefix."
  default     = ["operator", "tenant", "smtp"]
}

variable "tags" {
  type        = map(string)
  description = "Additional tags merged onto every resource."
  default     = {}
}
