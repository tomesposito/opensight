# OpenSight network module

Reusable IPv6-only VPC for serverless workloads. No NAT gateway: private
subnets reach AWS services through gateway endpoints and the public internet
through an egress-only internet gateway (IPv6 egress only).

## Inputs

All values come from variables. See `variables.tf` for the full contract.

## Outputs

- `vpc_id`, `private_subnet_ids`
- `lambda_security_group_id`, `database_security_group_id`
- `s3_prefix_list_id` (for security-group rules)
