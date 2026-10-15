---
status: ✅ Confirmed
owner: Tom Esposito
date: 2026-10-15
labels: [itd]
---

## Purpose

Finish the operator-owned deployment of the approved marketing site (#94).

## Scope

Attested static packaging, host separation, recurring deployment and the first
operator cutover of the existing installation.

## Out of Scope

Database migration, data restore, new CI infrastructure privileges, a second
CloudFront subscription, or changes to the approved marketing design.

### ✅ ITD D-77 — How do marketing and the hosted product share the existing edge?

#### CONTEXT

The approved marketing files already exist in `site/`. The apex currently serves
the product through one private S3 origin and the CloudFront Free subscription.
The private code deployment controller verifies master artifacts, independently
approved compatibility and a serialized operation. The latest source includes
operator tooling that changes its conservative compatibility hash; a hostname
cutover must not silently approve that runtime change.

#### THE PROBLEM

How can the operator publish marketing at the apex and move the product to its
app subdomain while preserving release integrity, low cost and recovery?

#### OPTIONS CONSIDERED

1. Create a separate distribution and deployment pipeline for marketing.
2. ✅ **Share the existing distribution, with host-validated static paths and one attested frontend archive.**
3. Move the entire latest runtime and perform a database migration during cutover.

#### REASONING

Option 1 duplicates resources and release bookkeeping. Option 2 reuses the
existing origin and subscription. A viewer function rewrites marketing requests
under `/marketing/` before cache lookup; the app cannot address that prefix, and
marketing cannot address application or API routes. Rewrites do not change the
selected CloudFront behavior, so both static behaviors use the same origin.
Option 3 couples an unrelated compatibility review to a static publication.
The initial cutover instead combines the unchanged deployed application files
with only the marketing subtree from a verified master artifact. Its release
record identifies those two sources explicitly. Later compatible releases
publish both trees atomically at the release-record level, with HTML last and
invalidation; individual S3 writes are not globally atomic.

#### IMPLICATIONS

- Preserve the API origin certificate; attach the separately validated shared
  apex/app certificate to CloudFront. No paid tier, public bucket or NAT gateway.
- Build marketing plus the offline demo into the signed frontend archive and
  expose the same subtree as `site-<sha>` for seven days. Reject links, unsafe
  paths, missing site files or partial marketing bundles before publishing.
- Use correct media types and bounded caching for unhashed marketing media.
  Once cut over, the private controller refuses releases without marketing.
- The operator owns saved-plan review, the existing operation lock/watchdog,
  quiescence, exact origin/CORS changes, a new request version and live acceptance.
  Keep all configuration, snapshots, plan bytes and credentials outside Git.
- Bind the composite release to the old runtime source/image/compatibility,
  current-record predecessor, marketing source/manifest, public files and new
  configuration fingerprints. Do not relabel a runtime compatibility baseline.
- Rollback across this first boundary is an operator infrastructure rollback,
  including both origins, aliases, CORS, smoke configuration and frontend files.
  Schema-compatible code rollback after the boundary keeps marketing present.
- A failed or interrupted cutover keeps admission closed until the operator
  reconciles the operation. Never reopen automatically after uncertain commits.
- Retry only the explicit startup wake on bounded transient 503 responses.
  Keep authorization denials and business mutations outside that retry path.

See [D-34](D-34-compatible-release-automation.md) for the unchanged CI trust and
compatibility contract. This is authorized operator deployment work; publishing
source remains subject to the owner's master-merge restriction.
