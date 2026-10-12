variable "deployment" {
  type        = string
  description = "Short deployment identifier used in resource names and tags."
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,35}$", var.deployment))
    error_message = "Use a short deployment identifier."
  }
}

variable "region" {
  type        = string
  description = "AWS region for the S3 gateway endpoint service name."
}

variable "availability_zones" {
  type        = list(string)
  description = "Exactly two distinct availability zones for the private subnets."
  validation {
    condition     = length(distinct(var.availability_zones)) == 2
    error_message = "Exactly two distinct availability zones are required."
  }
}

variable "vpc_cidr" {
  type        = string
  description = "IPv4 CIDR for the VPC."
  default     = "10.78.0.0/24"
  validation {
    condition     = can(cidrhost(var.vpc_cidr, 0))
    error_message = "Supply a valid IPv4 CIDR block."
  }
}

variable "artifacts_bucket_arn" {
  type        = string
  description = "ARN of the private artifacts bucket the S3 gateway endpoint policy scopes to."
  validation {
    condition     = can(regex("^arn:aws:s3:::[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$", var.artifacts_bucket_arn))
    error_message = "Supply the artifacts bucket ARN."
  }
}

variable "database_port" {
  type        = number
  description = "Database port allowed between the Lambda and database security groups."
  default     = 5432
}

variable "egress_ports" {
  type        = list(number)
  description = "IPv6 egress ports open from the Lambda security group (HTTPS, SMTPS)."
  default     = [443, 465]
}

variable "tags" {
  type        = map(string)
  description = "Additional tags merged onto every resource."
  default     = {}
}
