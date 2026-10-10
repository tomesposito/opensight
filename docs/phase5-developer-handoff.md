# Phase 5 — developer handoff after SR1

**2026-10-10:** the operator approved advancing developer preparation alongside
an IPv6-first AWS validation plan. This is not AWS access/spending authorization
for ordinary builds. Follow `AGENTS.md`; freeze each slice's complete contract in
`SOLUTION_DESIGN.md` in a separate spec commit before implementing it.

**SR4a update, 2026-10-10:** the image, generic OpenTofu modules and private
operator harness are implemented. A separately authorized isolated AWS run
proved both subnet transports, real synthetic SMTP, Aurora roles/RLS and short
pause/resume. [Validation evidence](issue-83-gap-notes.md) records exact tests,
image provenance and remaining checks. Long-idle resume is still pending;
maintenance remains frozen and there is no public site. SR2, SR3 and SR4b remain
open. The baseline below describes the earlier SR1 handoff.

## Current baseline

- Issue #81 produced draft D-19 through D-25 contracts.
- Issue #82 delivered SR1, merged as `a51691f`. Its recorded verification is
  **2,224 passed / 0 failed / 12 skipped**; the skips require live PostgreSQL.
- SR1 has bounded request/private migration composition and cleanup. It does
  not provide deployable tenant compute: storage/job/embed paths intentionally
  fail with `SERVERLESS_STORAGE_REQUIRED`; the default queue executor fails
  until a real implementation is supplied.
- Terraform modules, deployable Lambda image packaging and release/deploy
  workflows are still absent at this baseline.

Closing #81/#82 therefore does not mean that developer work or SR5 is complete.
The [isolated validation plan](phase5-aws-validation-plan.md) can prove selected
platform assumptions once the minimal SR4 packaging/probe prerequisites exist.

## Work order and boundaries

| Track | Dependency | Deliverable |
| --- | --- | --- |
| SR2 | Separate spec finalization of D-22/D-23 and exact dependency licenses | Durable storage, uploads, admission/fencing and cold hydration |
| SR3 | SR2 authority/operation contracts; separate D-24 spec finalization | Durable event execution, recovery, cancellation and real delivery |
| SR4a | SR1 plus reviewed image/tool choices and experiment spec | Minimal image and offline IaC/probe package for the isolated AWS experiment |
| SR4b | SR2/SR3 interfaces plus reviewed D-25 release contract | Full public modules/builds, private workflow templates and recovery runbooks |
| AWS operator | SR4a artifacts plus explicit resource/cost approval | Live transport, SQL, native-worker and pause/resume evidence |

SR4a can progress alongside SR2 design; it need not wait for a complete product.
Keep these on distinct phase branches and preserve checkpoint commits. No
resource creation, deployment, private repo creation or automatic public-merge
deployment is authorized by this handoff.

## SR2: durable storage and overlapping invocation safety

Use [D-22](itd/D-22-serverless-object-transfers.md),
[D-23](itd/D-23-serverless-state-and-fencing.md) and H9/H10 as the contract inputs.

- Finalize SQL schema, migration compatibility and lock ordering; durable
  aggregate admission, claims, fencing tokens and authoritative publication.
- Implement private immutable/version-bound S3 artifacts and asynchronous
  hydration behind the existing analytical seam. Local cache/`/tmp` never grants
  authority; recheck tenant/owner/dependency revisions before read or publication.
- Add upload reservation/completion/cancellation with checksums, exact immutable
  versions, expiry, idempotency and storage entitlement. Preserve existing source
  formats/limits, owner boundaries and explicit source expiry.
- Resolve D-22's proposed 1 MiB control/result limits against SR1's current 4 MiB
  adapter bound before coding; document transport versus application envelopes,
  oversized import behavior and client-visible errors. Do not silently reduce a
  supported upload/data format to fit Lambda.
- Maintain the SR1 guard for capabilities not yet backed by durable state; do
  not open the full application as soon as one storage adapter exists.
- Prove cold hydration, corrupt/oversize bytes, wrong scope/owner/version, denied
  columns, two overlapping instances, duplicate/late/crashed workers, lease
  expiry, cancellation, delete/refresh races and authoritative-store failure.
  Preserve differential results across engines and no-stale-fallback behavior.

Use local transports/fakes and existing integration fixtures. Real S3 browser
signing/CORS and Aurora evidence belong to the separately authorized cloud gate;
do not claim fake transport tests establish them.

## SR3: background work and delivery

Finalize [D-24](itd/D-24-serverless-job-dispatch.md) against SR2, then implement:

- Durable operation transitions, prearmed recovery intent, bounded dispatch,
  SQS work/recovery/DLQs and one-shot Scheduler events for actual obligations.
- Source-bound single-record execution replacing SR1's deliberate failure;
  duplicate delivery, crash gaps and late events cannot regain authority.
- Bounded retries, cancellation, dead-letter and operator recovery with current
  tenant/owner/recipient authorization on every attempt.
- Existing H7 SMTP semantics through the configured real transport. Use the stub
  in tests; a deployment cannot silently select it. IPv6 endpoint selection must
  be testable/configurable and actual connectivity remains AWS evidence.
- Zero unconditional database polling/heartbeat while idle. Durable state, not
  a process-lifetime lock or Lambda concurrency setting, governs ownership.
- Fault injection before/after commit, send and acknowledgement; no lost durable
  obligation, obsolete publication or unauthorized mail. Record the existing
  at-least-once SMTP ambiguity honestly.

Browser startup/idle behavior is a separate visible change. The operator confirmed
the 45-second passive embed display expiry and explicit Connect behavior in
[IDD D-26](idd/D-26-idle-embed-reconnect.md). Finalize the SDK/client contract and
tests in a separate spec commit, then implement that SR3 UI slice; this product
choice no longer needs approval. Preserve HQ-7, session/bootstrap semantics and
zero idle polling; test expiry, hidden/frozen pages and failed reconnection.
The same browser slice includes [#87](https://github.com/tomesposito/opensight/issues/87):
replace the existing font-dependent navigation/data-state icon glyphs with
offline vectors and verify minimal Linux/desktop browser rendering.
The tester IP allowlist and WAF cost remain separate unapproved choices. This
does not block backend SR2/SR3 work.

## SR4: packaging and deployment automation

Use [D-25](itd/D-25-serverless-release-artifacts.md) and
[the validation inventory](phase5-aws-validation-plan.md#2-proposed-resource-inventory).

**First deliver SR4a:** a reproducible single-architecture Lambda image with the
SR1 request/migration entrypoints and a separately selectable test-only platform
probe. Test native DuckDB, cancellation, read-only root, bounded `/tmp` and cleanup
in Linux. Probe code cannot bypass the application's admission gate; expose it
only to IAM invocation in an isolated environment. Supply generic IaC for the
inventory, scoped policies, outputs and a test/teardown harness. All account,
network, secret and identity values are environment inputs. Offline validate the
plan shape and prohibited paid services; do not perform a real refresh/apply.

The probe covers both subnet/AZ paths, IPv6 Secrets/SQS/Scheduler/SMTP, S3 gateway
access, private SQL/RLS, native-worker teardown, service-metric-only idle
observation and bounded invocation accounting. Keep the database closed to public
traffic and mark ready/maintenance distinctions accurately. Its tests are
platform evidence only, not SR2/SR3 or public-ingress acceptance.

**Then deliver SR4b:** full reusable public modules, immutable image/frontend
release manifest with SBOM/provenance, private manual OIDC workflow templates,
encrypted/locked remote state, separated IAM roles and migration/restore/rollback
runbooks. Public PR jobs get no AWS authority. No actual private environment
configuration or secrets belong in either repository. Check exact tool/provider/
SDK/base-image licenses and pins; record the tooling-license decision before
choosing Terraform or a compatible alternative. No license exception is implied.

Keep the hosted frontend separate from the offline demo. Build once, promote by
digest and apply a reviewed saved plan. Workflows should start disabled/uninstalled
for an operator; creation of the private deployment repo and OIDC trust is an
operator action after review. Do not silently purchase a GitHub plan to obtain
environment protections.

## Completion evidence for each build slice

Run the full root `npm test`; report exact passed/failed/skipped counts and explain
every skip. Only unavailable live-PostgreSQL integration skips are acceptable.
Rebuild and screenshot-compare the demo; refresh README assets for visible UI
changes. Document resources, configuration, semantics and the remaining cloud
gates. Scan staged content for secrets/account configuration and portable paths.
Merge with `--no-ff` and publish deliberately through the Git Database API.

An issue is done when its specified local deliverables and evidence are present.
Do not close the overall deployment work because local tests pass or because a
platform probe succeeds. The final application still needs the full SR5/SR6
acceptance in [the serverless plan](aws-serverless-plan.md#8-sequenced-work-and-acceptance-gates).
