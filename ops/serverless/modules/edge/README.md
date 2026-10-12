# OpenSight edge module

Public ingress: ACM certificate with DNS validation, HTTP API Gateway with a
Lambda authorizer (zero result TTL, 5 rps throttle), CloudFront distribution
with WAF IP rate limiting, OAC-scoped frontend bucket, and a viewer function.
The site DNS cutover is gated on the CloudFront free-plan subscription and
explicit `publish_site` approval.

## Inputs

All values come from variables. Secrets arrive via protected inputs, never
committed files. See `variables.tf`.
