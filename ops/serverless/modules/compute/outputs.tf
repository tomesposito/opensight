output "function_names" {
  description = "Map of function key to function name."
  value       = merge({ for k, f in aws_lambda_function.validation : k => f.function_name }, { for k, f in aws_lambda_function.application : k => f.function_name })
}

output "function_arns" {
  description = "Map of function key to function ARN."
  value       = merge({ for k, f in aws_lambda_function.validation : k => f.arn }, { for k, f in aws_lambda_function.application : k => f.arn })
}

output "work_queue_url" {
  description = "Pilot work queue URL, or null."
  value       = var.pilot ? aws_sqs_queue.business["work"].url : null
}

output "recovery_queue_url" {
  description = "Pilot recovery queue URL, or null."
  value       = var.pilot ? aws_sqs_queue.business["recovery"].url : null
}
