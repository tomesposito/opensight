---
status: ✅ Confirmed
owner: Tom Esposito
date: 2026-10-10
labels: [idd]
---

## Purpose

Choose upload and control-request behavior for the initial serverless deployment.

## Scope

File-size compatibility, asynchronous ingestion and the control JSON ceiling.

## Out of Scope

Public ingress, bigger file formats, permission changes and AWS spending.

### ✅ IDD D-28 — How should users transfer files and definitions to the serverless deployment?

#### CONTEXT

The existing parser accepts CSV, TSV, XLS and XLSX files up to 8 MiB. Encoding
that file in a Lambda control request can exceed the transport envelope. D-22
proposes direct object transfer and asynchronous ingestion; SR1 currently has a
4 MiB transport guard. On 2026-10-10, Tom approved retaining the 8 MiB file limit,
showing operation/status during ingestion and limiting each control JSON request
to 1 MiB, including the effect on large imported dashboard definitions.

#### THE PROBLEM

Which upload experience and control-request ceiling should the first serverless
deployment support?

#### OPTIONS CONSIDERED

1. ✅ **Keep 8 MiB files through authorized direct S3 transfer, show asynchronous
   ingestion status, and cap control JSON at 1 MiB.**
2. Keep larger definition imports through an additional definition-transfer path.
3. Reduce file limits to fit synchronous requests.

#### REASONING

Option 1 preserves accepted file formats and size while fitting the chosen
runtime. Waiting for ingestion becomes visible application state. Large control
definitions can be rejected; that limitation is explicitly accepted. Option 2
can be designed later but is not part of this initial deployment. Option 3 would
unnecessarily reduce file compatibility.

#### IMPLICATIONS

- Keep the existing 8 MiB, 100,000-row, 256-column and decoded-memory limits.
- Reserve and authorize uploads before signing; successful object transfer alone
  does not create a source. Completion returns an authorized operation/status.
- Reject control JSON above 1 MiB with `CONTROL_PAYLOAD_TOO_LARGE` (413), without
  truncation. Distinguish this application limit from the transport envelope.
- A large dashboard definition needs to be reduced or handled by a future
  explicitly specified transfer path; do not silently split or omit its content.
- Preserve current tenant/owner scope, source expiry, RLS/CLS and cancellation.
- Freeze the remaining technical interfaces before building D-22/SR2. This
  decision removes the product gate; it does not claim the protocol is shipped.

Related: [D-22](../itd/D-22-serverless-object-transfers.md),
[D-23](../itd/D-23-serverless-state-and-fencing.md).
