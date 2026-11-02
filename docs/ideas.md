# Ideas (#178)

Ideas collects private suggestions in hosted workspaces, as specified in
[D-88](idd/D-88-ideas-in-app-suggestions.md). A human reviews every idea;
submissions are input, never instructions. There is no connection from an idea
to an issue, agent, build, roadmap, voting board, or automatic implementation.

## Member experience and resources

The **Ideas** navigation entry opens `#/ideas`. The main Data empty states
also offer **Suggest an idea** when a hosted client is present; these open
`#/ideas/from/data-empty`. The form asks only for title and description.
The client supplies the originating surface automatically.

Records in the membership database's `h8_ideas` table contain a generated ID,
tenant and namespace, submitter user ID, session display name and available
email, title, description, surface, server package version, status, decline
category/note, shipped reference, and UTC creation/update timestamps.
`packages/api/package.json` supplies the product version; clients cannot set it.
No new dependency or configuration is needed.

| Route (internal API path) | Access | Behavior |
| --- | --- | --- |
| `POST /api/ideas` | Active workspace member | Submit `{title, description, surface}`; returns the record with HTTP 201 |
| `GET /api/ideas` | Active workspace member | `{ideas: [...]}` containing only this member's submissions, newest first |
| `GET /api/host/ideas` | Deployment operator | List across tenants, newest first; optional `Idea-Status` and `Idea-Tenant` filter headers |
| `PATCH /api/host/ideas/:id` | Deployment operator | Set `{status}` with the required decline or shipment fields |

The existing web API prefix applies: the default `/api` prefix makes the
member URL `/api/api/ideas` at the browser ingress. Namespace-scoped member
routes follow the existing authenticated namespace router. Query strings are
rejected, as elsewhere in the hosted API. Filter headers apply only to the
operator list and never change the scope of a member list.

Title is required, up to 160 characters; description is required, up to 10,000
characters and may span lines. Surface is a required single-line string of at
most 80 characters. All are trimmed; empty text, inappropriate control
characters, unknown fields and caller-supplied identity/version/status fail
validation. Submissions are plain text and are never interpreted as markup or
instructions. Five submission attempts per tenant/namespace/user are permitted
in ten minutes. The durable `h2_attempts` buckets survive restarts and invocation
boundaries; invalid submissions consume attempts too. Exceeding the limit
returns HTTP 429 `IDEA_RATE_LIMITED`.

## Review and statuses

| Current status | Permitted next statuses |
| --- | --- |
| `received` (Received) | `under_review` |
| `under_review` (Under review) | `accepted`, `declined`, `shipped` |
| `accepted` (Accepted) | `shipped` |
| `declined` (Declined) | None |
| `shipped` (Shipped) | None |

Illegal transitions, repeated transitions and concurrent stale updates fail
with HTTP 409 `IDEA_TRANSITION_INVALID`. Unknown statuses return HTTP 400
`IDEA_STATUS_INVALID`; unknown IDs return HTTP 404 `IDEA_NOT_FOUND`.

Declining requires `declineCategory` from `not-aligned`, `duplicate`,
`not-feasible`, or `later`, plus a nonempty single-line `declineNote` of at most
500 characters. Missing or invalid reasons return `IDEA_DECLINE_REASON_REQUIRED`.
Shipping requires a nonempty single-line `shippedReference` of at most 500
characters, such as a release link or issue reference; otherwise the API returns
`IDEA_SHIPPED_REFERENCE_REQUIRED`. Irrelevant reason/reference fields are
rejected. The member list shows the reason when declined and the reference
when shipped. Only absolute HTTP(S) references without embedded credentials
become links; other references remain text.

The operator queue is at `#operator-ideas`, linked beside `#operator-users`.
Enter the existing deployment operator credential, review the list, filter by
status or tenant, and apply a permitted transition. Credentials stay in memory
and are cleared on disconnect or page close. Same-origin browser access uses
the same operator-key authorization as the existing user-removal surface.
Foreign origins and member credentials are rejected. Public serverless ingress
continues to exclude `/api/host/*`; the queue needs an operator-accessible API
endpoint, just like the existing operator UI.

Every successful transition appends an atomic `idea.transitioned` operator
audit entry: actor `deployment-operator`, tenant, idea ID, old/new status and
timestamp. Failed transitions leave both the record and audit unchanged.
The audit contains no suggestion text or submitter email.

The owner and Muse review ideas together. Accepted ideas may become ordinary
sweep issues through human review and the normal IDD/HQ gates. The review digest
folds into the Monday persona-and-journey pass. This release adds no digest,
cron, notification, or issue-creation wiring.

## Privacy, hosting and lifecycle

Any authenticated active workspace member may submit, including readers.
Membership and active-tenant state are checked again inside the storage
transaction. Member reads always constrain tenant, namespace and user together;
there is no member route for reading arbitrary IDs or changing status. Only
operators can see submissions from other people or tenants. Identity and
workspace come from the verified hosted session, never the request body.

Local/self-hosted APIs return HTTP 409 `IDEAS_HOSTED_ONLY` and never store ideas.
Local and static-demo views explain that Ideas need a hosted workspace and
link to GitHub issues. They do not submit, persist local suggestions, or phone
home. A session without a hosted tenant receives the same unavailable UI.

Single-node and serverless owner migrations initialize the table; serverless
invocations do no DDL. Runtime database grants keep this table on the operator
connection used by the hosted membership service. Backups include Ideas;
pre-Ideas backups restore with an empty table and migrations preserve existing
data. Tenant deletion inventories and removes that tenant's ideas while
retaining the minimal operator audit according to the existing audit policy.

API tests in `packages/api/test/ideas.test.mjs`, backup/deletion regression tests,
and web interaction tests in `packages/web/test/ideas.test.mjs` run via root
`npm test` using the existing workspace test globs.
