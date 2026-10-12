# OpenSight data module

Aurora Serverless v2 PostgreSQL cluster (0–2 ACU, 5-minute auto-pause,
encrypted, deletion-protected), Secrets Manager secret references (never
values), the private versioned artifacts bucket, and the immutable ECR
repository.

Secret payloads stay outside Terraform: only secret references are managed.
