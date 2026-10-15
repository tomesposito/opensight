---
status: 🚧 Draft (pending product-owner review)
owner: Tom Esposito
date: 2026-10-15
labels: [idd]
---

## Purpose

Freeze the intended behavior of the hosted data catalog when a workspace
contains prepared datasets whose upload sources have expired, so the
implementation has a contract to build against (issue #98).

## Scope

The two composed catalog requests the browser Data / Data-sources pages
issue together: `GET /api/prep-sources` and `GET /api/prep-datasets`.

## Out of Scope

The expired object-cleanup recovery protocol (issue #96, closed; operator
task). Quota policy changes (issue #91, closed). New expiry semantics —
expiry itself is decided (HQ-16: uploads carry explicit expiry).

### 🚧 IDD D-76 — What does the hosted catalog show when an upload source expires?

#### CONTEXT

The web client loads the Data pages with `Promise.all` over
`/api/prep-datasets` and `/api/prep-sources`. `/api/prep-sources`
(`HostedData.discover()`) already degrades per source: an expired source
is returned as `{ id, available: false, columns: [], errorCode:
'UPLOAD_EXPIRED' }` and the rest of the catalog lists normally.

`/api/prep-datasets` (`HostedPrep.list()`) has no such degradation: it
calls `get()` per prepared dataset, and `get()` resolves every pipeline
input through `admit()`, which throws `UPLOAD_EXPIRED` for expired
bindings. One prepared dataset built on an expired upload source fails
the entire request with HTTP 403, and the browser pages show
"Could not load data. UPLOAD_EXPIRED: Request failed" with nothing
listed.

HQ-4 (decided 2026-09-30, owner-only for the pilot) and HQ-16 (decided
2026-09-30, uploads carry explicit expiry) gate this area; both are
decided. This IDD records listing behavior only — it does not widen
sharing or change expiry.

#### THE PROBLEM

An expired upload source must be visible as expired without hiding the
rest of the catalog, while querying it must stay refused. Where is the
line: omit the broken datasets, fail the request, or list them as
unavailable?

#### OPTIONS CONSIDERED

1. **Fail the whole request (status quo).** Simple, but it takes down
   the entire Data page for every workspace with one expired source —
   exactly the reported bug.
2. **Omit the unresolvable datasets silently.** The catalog loads, but
   definitions disappear without explanation; the user cannot tell an
   expired source from a deleted dataset.
3. **List every definition; mark the unresolvable ones unavailable with
   the machine-readable error code.** The catalog loads, the definition
   stays visible with an explicit expired/unavailable state, and the
   rest of the workspace is unaffected.

#### DECISION

Option 3.

- `GET /api/prep-datasets` returns healthy datasets in `datasets` as
  today, and adds an additive `unavailable` array:
  `{ datasets: [...], unavailable: [{ id, errorCode }], persistence: 'durable' }`.
  A dataset lands in `unavailable` when resolving it throws one of the
  same codes `discover()` already degrades on: `SOURCE_RETIRED`,
  `UPLOAD_EXPIRED`, `ROW_ACCESS_DENIED`, `SOURCE_POLICY_REQUIRED`,
  `SOURCE_ENDPOINT_DENIED`, `SOURCE_MIGRATION_REQUIRED`. Anything else
  still fails the request (fail-closed: unknown errors are never
  swallowed into the catalog).
- The browser maps each `unavailable` entry to a source summary with
  `available: false` and the error code, so the Data pages list the
  definition as expired/unavailable alongside everything else. One
  expired source cannot fail the authorized catalog.
- Single-dataset paths stay fail-closed: `GET /api/datasets/{id}/prep`,
  `describe`, `preview`, `execute`, `refresh`, and `admit` keep throwing
  `UPLOAD_EXPIRED` (or the respective code) for the expired dataset.
  Expiry is a hard stop for reading data, not a display filter.
- Listing never mutates anything: no source state changes, no retention
  changes, no quota/charge changes, no object records created or
  removed. Expired sources are never silently revived.
- Ownership/namespace isolation is unchanged: listing only ever touches
  the caller's namespace; the degraded path adds no cross-namespace
  reads.

#### REASONING

Option 3 is the direct generalization of what `discover()` already does
for `/api/prep-sources` — the two composed requests now degrade the
same way, so the UI composition cannot regress one request because of
the other. Keeping the definition visible with its error code matches
the issue's requirement ("keep existing definitions visible with an
explicit unavailable/expired state") and gives the operator something
concrete to act on instead of a vanished dataset. The additive
`unavailable` array keeps the response backward-compatible: older
clients keep working, they just don't render the unavailable entries.
Fail-closed reading is preserved because the degradation lives only in
the listing path; every execution path still refuses expired bindings
before I/O.

#### IMPLICATIONS

- `HostedPrep.list()` gains per-dataset error handling; its return
  shape gains `unavailable`.
- `prep-contracts.ts` maps `unavailable` into `PrepSourceSummary`
  entries with `available: false`.
- Regression tests: expired + current sources in one workspace (both
  listed, one marked), a separate namespace (isolation), and fail-closed
  single-dataset reads on the expired dataset.
- The 34 historical expired cleanup messages under #96 are untouched by
  this change; repairing that queue stays an operator task.
