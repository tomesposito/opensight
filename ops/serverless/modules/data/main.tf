resource "aws_db_subnet_group" "this" {
  name       = var.deployment
  subnet_ids = var.subnet_ids
  tags       = var.tags
}

resource "aws_rds_cluster_parameter_group" "this" {
  name   = var.deployment
  family = "aurora-postgresql16"
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
  parameter {
    name  = "log_statement"
    value = "none"
  }
  # Bootstrap DDL contains password literals. Never retain failed statements.
  parameter {
    name  = "log_min_error_statement"
    value = "panic"
  }
  parameter {
    name  = "log_parameter_max_length_on_error"
    value = "0"
  }
  tags = var.tags
}

resource "aws_rds_cluster" "this" {
  cluster_identifier              = var.deployment
  tags                            = var.tags
  engine                          = "aurora-postgresql"
  engine_version                  = var.engine_version
  engine_mode                     = "provisioned"
  database_name                   = "opensight"
  master_username                 = "opensight_bootstrap"
  manage_master_user_password     = true
  db_subnet_group_name            = aws_db_subnet_group.this.name
  db_cluster_parameter_group_name = aws_rds_cluster_parameter_group.this.name
  vpc_security_group_ids          = [var.database_security_group_id]
  storage_encrypted               = true
  backup_retention_period         = 1
  deletion_protection             = true
  skip_final_snapshot             = false
  final_snapshot_identifier       = "${var.deployment}-final"
  copy_tags_to_snapshot           = true
  enable_http_endpoint            = false
  serverlessv2_scaling_configuration {
    min_capacity             = 0
    max_capacity             = var.max_capacity
    seconds_until_auto_pause = var.auto_pause_seconds
  }
  lifecycle { prevent_destroy = true }
}

resource "aws_rds_cluster_instance" "writer" {
  identifier                   = "${var.deployment}-writer"
  cluster_identifier           = aws_rds_cluster.this.id
  instance_class               = "db.serverless"
  engine                       = aws_rds_cluster.this.engine
  engine_version               = aws_rds_cluster.this.engine_version
  publicly_accessible          = false
  auto_minor_version_upgrade   = false
  performance_insights_enabled = false
  monitoring_interval          = 0
  tags                         = var.tags
}

resource "aws_secretsmanager_secret" "runtime" {
  for_each                = toset(var.secret_names)
  name                    = "${var.deployment}/${each.key}"
  recovery_window_in_days = 7
  tags                    = var.tags
  lifecycle { prevent_destroy = true }
}

resource "aws_s3_bucket" "artifacts" {
  bucket        = var.artifact_bucket
  force_destroy = false
  tags          = var.tags
  lifecycle { prevent_destroy = true }
}

resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket                  = aws_s3_bucket.artifacts.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_policy" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{ Sid = "RequireTLS", Effect = "Deny", Principal = "*",
    Action = "s3:*", Resource = [aws_s3_bucket.artifacts.arn, "${aws_s3_bucket.artifacts.arn}/*"],
    Condition = { Bool = { "aws:SecureTransport" = "false" } } }] })
}

resource "aws_s3_bucket_lifecycle_configuration" "synthetic" {
  bucket = aws_s3_bucket.artifacts.id
  rule {
    id     = "expire-synthetic-probes"
    status = "Enabled"
    filter { prefix = "probe/" }
    expiration { days = 1 }
    noncurrent_version_expiration { noncurrent_days = 1 }
    abort_incomplete_multipart_upload { days_after_initiation = 1 }
  }
}

resource "aws_ecr_repository" "runtime" {
  name                 = var.deployment
  image_tag_mutability = "IMMUTABLE"
  force_delete         = false
  tags                 = var.tags
  image_scanning_configuration { scan_on_push = true }
}

resource "aws_ecr_lifecycle_policy" "runtime" {
  repository = aws_ecr_repository.runtime.name
  policy     = jsonencode({ rules = [{ rulePriority = 1, description = "Retain at most three untagged test images",
    selection = { tagStatus = "untagged", countType = "imageCountMoreThan", countNumber = 3 }, action = { type = "expire" } }] })
}
