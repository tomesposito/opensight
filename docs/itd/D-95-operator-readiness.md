# D-95 — Bounded operator readiness ✅

**Type:** ITD. **Date:** 2026-11-21. **Issues:** #110, #117, #209, #236/#111.

## Purpose and scope

Complete the approved AWS and GitHub operator work before deployment. Preserve
sandbox billing/mail restrictions and existing release/recovery authority.
Unrelated product features, paid-tier activation and broad IAM changes are out
of scope. All deployment values and raw evidence remain private.

## CONTEXT

The live sites have the managed security headers but no CSP. Domain DKIM, SPF,
MAIL FROM and monitoring-only DMARC already work; the application SMTP sender
is still coupled to the alert recipient. There is no active inbound receipt rule
set or root MX. The dependency audit command exists but CI does not execute it.
The owner authorized completing these tasks and deploying latest on November 21.

## THE PROBLEM

How can these operator tasks be completed without widening sandbox authority or
breaking the static demo, dynamic embedding, or release rollback?

## OPTIONS CONSIDERED

1. Hand-edit live resources without a versioned contract.
2. ✅ **Version generic policies and handlers, keep all instance values private,
   and apply reviewed bounded changes with before/after evidence.**
3. Activate production billing/mail or replace the mail service.

## REASONING

Option 2 preserves reproducibility and the existing owner-approved SES forwarding
choice. Option 1 permits configuration drift; option 3 exceeds the requested
sandbox scope. A strict script policy is feasible by externalizing only the hosted
demo script during packaging. React and ECharts still require inline styles.
Dynamic API/embed behaviors must not inherit the static policy.

## IMPLICATIONS

- CI audit: pinned MIT setup-node, Node 24, npm ci, npm audit --audit-level=high,
  ten-minute timeout, contents-read only, no deployment credentials. Publishing
  requires audit and build success. Failures are fixed, not suppressed.
- SMTP: independently parameterized exact sender address and verified SES identity
  ARN; both are required together. Default preserves existing installations.
  IAM permits SendRawEmail only from that address to the single approved sandbox
  recipient; no new SMTP access keys. Probe sender follows the same contract.
- Forwarding: isolated CloudFormation stack and Lambda, exact two aliases and one
  verified destination, receipt-rule scoped invocation/storage permissions,
  private AES256 S3 storage, TLS-only access, seven-day raw-mail retention and
  thirty-day receipt retention. Never log content, addresses or subjects.
  Check SES spam/virus verdicts, exact envelope recipients and bounded message
  IDs before reads. Limit original input to 25 MiB and encoded output to 40 MiB.
  Forward through SES v2 raw SendEmail, preserving the original as an attachment
  and using the verified sender, never impersonating the original author.
  Conditional S3 claims prevent duplicate sends. An ambiguous send or a claimed
  message requires operator reconciliation, never blind resend. Quarantined and
  oversized messages remain retained and produce named operational errors.
  Reserve one invocation at a time and bound execution/memory/retries.
- CSP: default-src self; script-src self; style-src self unsafe-inline; img-src
  self data: blob:; font-src self data:; media-src self blob:; frame-src self;
  worker-src self blob:; object-src none; base-uri none; form-action self;
  frame-ancestors self. connect-src adds only private-configured app/artifact
  origins after URL validation. No wildcard hosts or unsafe-eval.
  Preserve HSTS, nosniff, SAMEORIGIN and strict-origin-when-cross-origin.
- Generic policy generation validates exact route scope and policy length;
  infrastructure attaches it only to frontend-origin behaviors. Existing CSP
  handlers remain authoritative for dynamic embed routes. Hosted demo app.js is
  a manifest-bound fixed path; rejects missing/extra executable scripts.
- Operator sequence: retain configurations, review exact cloud changes, deploy
  isolated mail resources, verify aliases externally, update SMTP IAM/runtime
  through the release configuration boundary, and verify browser CSP before
  enforcement. Retain an exact current-demo script hash during transition,
  remove it after the external-script artifact succeeds. No schema bypass.
- Verification includes raw-header injection, wrong recipients, repeated event,
  failed verdict, oversize, and ambiguous-send handling; CSP route isolation and
  browser behavior; sender IAM restriction; actual CI audit; full root suite and
  isolated PostgreSQL; live site and synthetic hosted release checks.
