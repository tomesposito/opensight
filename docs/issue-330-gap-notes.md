# Issue #330 — workspace action history

Authenticated hosted v1 calls now append to the existing `h8_audit` table at
the central request boundary. The delegating member supplies the actor and
tenant through authentication. OpenAPI operation IDs are generated into the
API matcher; other recognized v1 routes use stable method/template names.
Path resource IDs are retained, while request bodies, query contents/results,
credentials and error messages are excluded. Final response status captures
successes, denials and failures. History reads do not create entries.

`GET /api/v1/workspace/action-history` exposes a tenant-filtered audit page
to any member. It uses the v1 `Limit`/`Cursor` header convention, with the audit
limits of 1–200 (default 50), and stable timestamp/event-ID cursor ordering.
MCP `list_workspace_action_history`, CLI `workspace list-action-history`,
TypeScript `listWorkspaceActionHistory` and Python
`list_workspace_action_history` map to it. Inventories now contain 58
operations. `/api/host/audit` retains operator-only authentication.

Startup verifies the migrated audit schema before serving. Later append
failures produce sanitized diagnostics without changing an action response;
history reads still fail with a named storage/schema error. No runtime DDL is
introduced. Local v1 uses a separate fixture dispatch and has no hosted audit
database: its history endpoint returns `HOSTED_API_REQUIRED`. See
[audit semantics](operator-audit.md).

## Persona acceptance

J10 passed **12 steps / 0 failures / 0 gaps** on local PostgreSQL and the real
MCP/hosted stack. All **30 earlier MCP calls** matched distinct audit entries
with the delegating member identity, tenant, path subject and final status.
This includes the regional draft creation, `run_dataset_query`, and both the
successful and spend-cap-denied `ask_question`. The human's direct HTTP read
equals the MCP history. Seeded other-tenant and NULL-tenant events are absent,
and member access to the operator endpoint still returns `403 OPERATOR_REQUIRED`.

The brief's literal assertion that *every returned entry* has the delegating
member as actor conflicts with the tenant-wide read: J10 also performs real
administrator calls and creates operator-attributed tenant setup entries.
The journey preserves and verifies those actors, then verifies the delegating
identity on every distinct MCP action. It does not erase setup history, hide
other members, or relabel their events to make the assertion pass.

No dependencies, AWS calls, external services, UI changes or
`SOLUTION_DESIGN.md` edits are introduced. The generated edge boundary remains
below its existing size limit, with all 13 edge checks passing.

## Verification

The focused recording/history suite covers migration failure, append failure,
member authorization, secret redaction, pagination, ordering and cross-tenant
exclusion. Generated CLI/MCP and TypeScript SDK checks passed **184 / 0 failed /
0 skipped**; Python SDK checks passed **34 / 0 failed / 0 skipped**.
Full root-suite and static-demo results are recorded after completion below.
