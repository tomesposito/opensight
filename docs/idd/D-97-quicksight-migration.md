---
status: ✅ Confirmed
owner: Tom Esposito
date: 2026-11-25
labels: [idd]
---

# IDD D-97 — QuickSight migration paths

## Purpose

Record Tom's 2026-11-25 ruling of Q1–Q7, all option (a), for issue #334.

## Scope

Customer-side extraction, shared migration reports, v1/MCP import, and governed
Ask O guidance, including the approved migration-learnings addendum.

## Out of Scope

Hosted AWS credential storage, live AWS verification during builds, automatic
remediation, and changes to existing fail-closed conversion semantics.

### ✅ IDD D-97 — How should customers migrate QuickSight assets into OpenSight?

#### CONTEXT

OpenSight already parses QuickSight bundles and converts definitions while
preserving unsupported constructs. Customers still need to extract those
definitions and understand the remaining work. The D-95 MCP and governed Ask O
surfaces provide additional entry points over the same importer. Tom selected
customer-run extraction on 2026-11-24 and ruled the seven sub-decisions on
2026-11-25 in issue #334.

#### THE PROBLEM

How should extraction, import, and remediation give customers a repeatable
migration without entrusting OpenSight with their AWS credentials?

#### OPTIONS CONSIDERED

| Question | Selected option (a) | Alternative (b) |
| --- | --- | --- |
| Q1: Form | ✅ **Versioned Node CLI package in this repository, AWS SDK v3** | Copyable standalone script |
| Q2: Method | ✅ **Describe definition APIs assembled into bundle JSON; asset export fallback seam** | Asset-bundle export only, requiring customer S3 |
| Q3: Credentials | ✅ **Standard customer AWS credential chain; List/Describe IAM policy; local files only** | Access-key CLI input |
| Q4: Ask O | ✅ **Guide and propose; confirm each fix through normal authoring** | Automatic remediation |
| Q5: MCP | ✅ **Exactly two v1 operations: bundle import and import-report read** | No migration support |
| Q6: Sequence | ✅ **Extractor/report, v1 operations, MCP flow, Ask O guidance** | AI guidance first |
| Q7: Contract | ✅ **One manifest and per-asset import-report contract for every path** | Separate reporting formats |

#### REASONING

Q1 keeps fixes and tests in the release process rather than forking scripts.
Q2 avoids an S3 prerequisite for ordinary extraction while retaining an explicit
fallback for definitions Describe cannot reach. Q3 supports profiles, environment
credentials and SSO without encouraging long-lived key storage. Q4 preserves
customer judgment when a conversion deliberately differs or fails closed; normal
Ask O charging on delivered answers and spend caps still apply. Q5 adds the
missing migration entry point to existing remap tools, with action history under
the delegating member; extraction never becomes an MCP operation. Q6 builds the
engine before its guides. Q7 lets customers move between UI, MCP and Ask O without
reinterpreting their migration state.

#### IMPLICATIONS

The extractor stores no credentials and writes local bundle and manifest files.
Tests use synthetic/sanitized QuickSight shapes and mocked clients; customer/Tom
live verification remains separate. The shipped IAM policy grants List/Describe
only; the customer-S3 asset-export fallback is documented, not executed by v1.

The approved addendum requires version-stamped artifacts, diff-aware reruns,
stable finding kinds combining construct type and asset/visual/field-well
location, and per-asset counts/shares of clean, deliberately different, and
failed-closed constructs. Reports contain shape, counts and sizes rather than
customer values. Credentials are never returned, SPICE needs source re-ingestion,
and namespaces/groups need explicit access remapping. Guidance recommends one
analysis at a time: compare numbers with QuickSight, move readers, then repeat.

The shared report extends the existing importer rather than defining a competing
format. v1 reads must be tenant/member scoped. Ask O only proposes fixes and
retains its existing governance; existing authoring applies a confirmed fix.
