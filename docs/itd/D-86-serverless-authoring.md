---
status: ✅ Confirmed
owner: Tom Esposito
date: 2026-10-29
labels: [itd]
---

### Purpose

Make the shipped hosted UI deployable without losing its retry and authorization
contracts when consecutive requests execute in different Lambda instances.

### Scope

Invitation ingress and the analysis/dashboard routes required by #150–#155.

### Out of Scope

Opening the remaining v1 dataset, source, folder and general asset APIs.

### ✅ ITD D-86 — How do hosted authoring retries survive Lambda invocation boundaries?

#### CONTEXT

The six builds after the deployed baseline introduce invitation and hosted
dashboard UI calls that the shared ingress rejects. Headless authoring currently
uses process-local rate windows and receipts. The operator has authorized fixing
the integration and deploying the resulting release. Existing metadata writes
already use tenant-scoped SQL transactions and enforce current authorization.

#### THE PROBLEM

How can the shipped hosted workflows cross the serverless boundary while keeping
concurrent and ambiguous retries safe?

#### OPTIONS CONSIDERED

1. Open the routes with per-invocation memory caches.
2. ✅ **Use bounded SQL receipts committed with each metadata write and shared SQL rate windows.**
3. Introduce a separate coordination service for authoring.

#### REASONING

Option 1 loses deduplication on every cold invocation and can publish a second
dashboard after a lost response. Option 2 uses the existing database transaction
boundary, so a receipt and its write either both exist or neither exists. Short
reservation transactions coordinate competing invocations; token and expiry
checks prevent late writers. Global and per-tenant capacity counters bound retained
receipts without granting tenant SQL access to other tenants' payloads. Option 3
adds infrastructure without providing atomicity with the metadata writes.

#### IMPLICATIONS

- A ten-minute completed receipt window and short pending leases use database
  time. Pending entries consume capacity; full receipt bytes count at commit.
- Analysis, dashboard and share/delete handlers use an asynchronous retry port;
  metadata adapters persist prepared receipts in the mutation transaction.
- Every replay retains the existing current authorization, data and revision checks.
- Shared rate limits keep the existing default and configuration contract.
- Owner migration, RLS, grants, readiness, backup inventory and erasure all include
  the new state. No runtime migration, polling loop or new standing service.
- The public route grammar opens only this tested slice. Other v1 routes retain
  their explicit serverless deferral. Existing durable compute admission remains
  authoritative for dashboard queries and exports.
- Tenant invitations use the existing dispatch outbox and execution leases.
  Recovery acknowledgement precedes the atomic invitation/event commit; events
  carry only IDs. Worker email retains the sealed token in its existing store,
  rechecks current invitation and inviter authority before SMTP DATA, and holds
  ambiguous sends for explicit replay. Request execution keeps no SMTP access.
- Deployment follows a registered backup and tested migration, then synthetic
  author, reader, administrator and isolation checks through public ingress.
