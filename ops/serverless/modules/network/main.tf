resource "aws_vpc" "this" {
  cidr_block                       = var.vpc_cidr
  assign_generated_ipv6_cidr_block = true
  enable_dns_support               = true
  enable_dns_hostnames             = true
  tags                             = merge({ Name = "${var.deployment}-vpc" }, var.tags)
}

resource "aws_subnet" "private" {
  count                           = 2
  vpc_id                          = aws_vpc.this.id
  availability_zone               = var.availability_zones[count.index]
  cidr_block                      = cidrsubnet(aws_vpc.this.cidr_block, 1, count.index)
  ipv6_cidr_block                 = cidrsubnet(aws_vpc.this.ipv6_cidr_block, 8, count.index)
  assign_ipv6_address_on_creation = true
  map_public_ip_on_launch         = false
  tags                            = merge({ Name = "${var.deployment}-private-${count.index}" }, var.tags)
}

resource "aws_egress_only_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = merge({ Name = "${var.deployment}-egress-only" }, var.tags)
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.this.id
  route {
    ipv6_cidr_block        = "::/0"
    egress_only_gateway_id = aws_egress_only_internet_gateway.this.id
  }
  tags = merge({ Name = "${var.deployment}-private" }, var.tags)
}

resource "aws_route_table_association" "private" {
  count          = 2
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.this.id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.private.id]
  policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = "*",
    Action   = ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject", "s3:DeleteObject", "s3:DeleteObjectVersion", "s3:ListBucket"],
    Resource = [var.artifacts_bucket_arn, "${var.artifacts_bucket_arn}/*"] }] })
  tags = merge({ Name = "${var.deployment}-s3-endpoint" }, var.tags)
}

resource "aws_security_group" "lambda" {
  name   = "${var.deployment}-lambda"
  vpc_id = aws_vpc.this.id
  tags   = merge({ Name = "${var.deployment}-lambda" }, var.tags)
}

resource "aws_security_group" "database" {
  name   = "${var.deployment}-database"
  vpc_id = aws_vpc.this.id
  tags   = merge({ Name = "${var.deployment}-database" }, var.tags)
}

resource "aws_vpc_security_group_ingress_rule" "database" {
  security_group_id            = aws_security_group.database.id
  referenced_security_group_id = aws_security_group.lambda.id
  ip_protocol                  = "tcp"
  from_port                    = var.database_port
  to_port                      = var.database_port
}

resource "aws_vpc_security_group_egress_rule" "database" {
  security_group_id            = aws_security_group.lambda.id
  referenced_security_group_id = aws_security_group.database.id
  ip_protocol                  = "tcp"
  from_port                    = var.database_port
  to_port                      = var.database_port
}

resource "aws_vpc_security_group_egress_rule" "internet" {
  for_each          = toset([for p in var.egress_ports : tostring(p)])
  security_group_id = aws_security_group.lambda.id
  cidr_ipv6         = "::/0"
  ip_protocol       = "tcp"
  from_port         = tonumber(each.key)
  to_port           = tonumber(each.key)
}

resource "aws_vpc_security_group_egress_rule" "s3" {
  security_group_id = aws_security_group.lambda.id
  prefix_list_id    = aws_vpc_endpoint.s3.prefix_list_id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}
