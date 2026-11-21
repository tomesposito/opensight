# OpenSight mail module

SES destination identity and a locked-down SMTP IAM user. SendRawEmail is
restricted to one sender and the single approved sandbox recipient. Set both
`smtp_from_address` and `smtp_identity_arn` for an independently verified sender;
omitting both preserves the alert-address default. Pass the same sender to the
compute module. Budget alerts continue to use `alert_email`. No access keys are
created or rotated, and private values must not enter version control.
