output "inventory" {
  sensitive = true
  value = {
    deployment       = var.deployment
    profile          = var.deployment_profile
    pilot_runtime    = var.enable_pilot_runtime
    consumers        = var.enable_consumers
    work_queues      = { for name, queue in aws_sqs_queue.business : name => { url = queue.url, arn = queue.arn } }
    business_group   = local.pilot ? aws_scheduler_schedule_group.business[0].name : null
    cluster          = aws_rds_cluster.validation.id
    writer           = aws_rds_cluster_instance.writer.id
    repository       = aws_ecr_repository.runtime.repository_url
    bucket           = aws_s3_bucket.artifacts.id
    functions        = { for name, function in aws_lambda_function.validation : name => function.function_name }
    secrets          = { for name, secret in aws_secretsmanager_secret.runtime : name => secret.arn }
    bootstrap_secret = aws_rds_cluster.validation.master_user_secret[0].secret_arn
    schedule_group   = aws_scheduler_schedule_group.probe.name
    queue_url        = aws_sqs_queue.probe.url
    smtp_user        = aws_iam_user.smtp.name
  }
}
