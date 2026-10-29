---
status: ✅ Confirmed
owner: Tom Esposito
date: 2026-10-28
labels: [idd]
---

# Tenant erasure and audit retention

## Purpose

Record the product decision supplied in issue #115's build brief.

## Scope

Audit retention when an operator erases tenant data.

## Out of Scope

Changing retention periods or promising physical-media erasure.

### ✅ IDD D-84 — Should tenant erasure remove its audit history?

#### CONTEXT

The existing reference deletion flow removes tenant data and appends
`tenant.deletion-completed` to the operator audit log. Tom confirmed on issue
#115 on 2026-10-28 that tenant erasure retains audit entries. This record
transcribes that decision into the repository.

#### THE PROBLEM

Should erasure delete audit entries along with tenant data?

#### OPTIONS CONSIDERED

1. Remove tenant audit entries during erasure.
2. ✅ **Retain audit entries and age them out under normal retention.**

#### REASONING

Option 1 would remove the history and completion record of the destructive
operation. The selected option preserves those records while tenant data is
purged. The accepted boundary is that erasure does not override audit retention.

#### IMPLICATIONS

- Keep existing audit entries, including the completion entry.
- Exclude retained audit records from orphan failures and identify them in
  dry-run reports.
- A repeated completed erasure must not append duplicate completion entries.
- Normal retention remains responsible for expiring audit history.
