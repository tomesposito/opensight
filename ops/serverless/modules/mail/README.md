# OpenSight mail module

SES email identity plus a locked-down SMTP IAM user. The user policy allows
`sess:SendRawEmail` only from and to the single alert address. No
`aws_iam_access_key` resource is created: key material never enters state.

## Inputs

All values come from variables. See `variables.tf`.
