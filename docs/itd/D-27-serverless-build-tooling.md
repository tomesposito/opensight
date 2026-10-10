---
status: ✅ Confirmed
owner: Tom Esposito
date: 2026-10-10
labels: [itd]
---

## Purpose

Select reproducible, open-source tooling for the first Lambda validation package
and record the explicitly approved runtime dependency exception.

## Scope

SR4a tooling, target architecture, AWS clients and dependency licensing.

## Out of Scope

Infrastructure provisioning, spending, GitHub plan changes and weakening the
application's authorization or cleanup gates.

### ✅ ITD D-27 — Which toolchain should build the first serverless validation package?

#### CONTEXT

SR1 requires Linux for native-worker containment; the operator workstation is
ARM64 macOS. D-25 requires pinned infrastructure tools and an exact Lambda image.
The current operator Terraform binary predates native S3 locking. AWS SDK v3
3.1149.0 clients are Apache-2.0 but require a newer 0BSD `tslib` than the existing
2.3.0. The product owner explicitly approved the narrow `tslib` 2.8.1 exception.

#### THE PROBLEM

Which reproducible toolchain meets the runtime, infrastructure and dependency
requirements without adding proprietary deployment tooling?

#### OPTIONS CONSIDERED

1. ✅ **OpenTofu with Terraform-format modules, pinned AWS clients, and an ARM64
   Lambda Node 24 image tested in Linux.**
2. Upgrade the operator's HashiCorp Terraform binary and retain the same modules.
3. Implement AWS signing/transports ourselves to avoid the SDK's helper dependency.

#### REASONING

Option 1 supplies native S3 locking with open-source operator tools and matches
the workstation architecture without emulation. The standard SDK avoids custom
signing/protocol code, and its one license exception is explicitly approved.
Option 2 can operate similar modules but adds a BSL tooling decision unnecessarily.
Option 3 removes a small dependency while creating a much larger transport and
security verification burden.

#### IMPLICATIONS

- Pin OpenTofu **1.13.1** and AWS provider **6.68.0**, both MPL-2.0 operator/CI
  executables, installed separately and not bundled into the application.
  Use `registry.terraform.io/hashicorp/aws` and commit verified provider hashes.
- Pin the S3, Secrets Manager, SQS and Scheduler clients at **3.1149.0** and
  `tslib` at **2.8.1**. New SDK packages are Apache-2.0/MIT; the only added
  non-MIT/Apache runtime license is the approved 0BSD helper update. Inventory
  the complete installed graph and retain notices.
- Target **linux/arm64**, using the operator-selected AWS Lambda Node 24 base
  `public.ecr.aws/lambda/nodejs@sha256:6720580baa6f3dbfb25849f4a3579f0e01b0d1ba836a3cdfc06519c8c0bb71c6`.
  Record its Node version and OS package inventory in build evidence. The
  upstream OS/runtime distribution is infrastructure; it is not relabeled as
  MIT/Apache application code. Preserve its upstream notices and inspect it for
  non-open/commercial components before release. Application additions retain
  the stricter AGENTS.md rule plus the one explicit helper exception.
- Colima 0.10.3/Lima 2.2.1 and Docker CLI 29.9.0/buildx 0.38.0 are local build
  tools, not deployment services or application dependencies. Use an isolated
  profile and task-specific Docker configuration; never mount operator secrets
  or pass AWS credentials into a build/test image.
- Acquire tools, pinned base image and npm/provider dependencies explicitly;
  build/test steps then run offline. No AWS calls occur in ordinary builds.
- The experiment budget's x86 Lambda rate remains a conservative estimate;
  reprice actual ARM64 usage before execution. This decision authorizes no spend.

Evidence: [OpenTofu license](https://github.com/opentofu/opentofu/blob/v1.13.1/LICENSE),
[provider license](https://github.com/hashicorp/terraform-provider-aws/blob/v6.68.0/LICENSE),
[AWS SDK license](https://github.com/aws/aws-sdk-js-v3/blob/v3.1149.0/LICENSE),
[native S3 locking](https://opentofu.org/docs/language/settings/backends/s3/),
[Lambda Node images](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-image.html).
