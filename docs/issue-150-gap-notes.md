# Issue #150: tenant invitation verification

The implementation follows the issue's four-item contract and the existing
built-in authentication lifecycle. Runtime semantics and configuration are in
[tenant invitations](issue-150-tenant-invitations.md). No dependency, schema,
operator endpoint, removal workflow, browser enrollment, deployment or design
contract changed.

## Regression evidence

HTTP coverage exercises all five invitation roles, seven-day default expiry,
hash/sealed storage, token-free listings/audits, and administrator session
continuity. Reader AI enrollment and acceptance use the returned token and the
existing authentication endpoints. Further assertions cover wrong credentials,
revocation during enrollment, expired tokens, accepted invitations, all non-admin
roles, forged tenant/principal fields, foreign namespace paths and invitation
IDs, member-removal denial, and hosted invocation admission. Existing operator
idempotency, response shape, mail delivery and session invalidation remain tested.

The component tests cover the email/display-name/five-role form, seven-day copy,
read-only tenant members, create/revoke feedback, and forgetting the shared link
on remount. The no-tenant session still supports role edits and member removal.
The focused component run passed 5 tests. An initial creation test attempted to
mutate a frozen fixture configuration; copying that configuration fixed the
fixture, and the isolated creation/enrollment regression passed.

J2 runs real Chromium against the local PostgreSQL hosted API with stub mail.
Its `admin-invites-reader` and `invitation-expiry-copy` steps now pass by creating
a Reader AI invitation in the UI, matching its shareable link to the mailed
token, checking persistence after leaving/reopening the page, and checking the
expiry copy. The reader then enrolls through the API and signs in with restricted
navigation. Tokens are removed from the view before screenshots. The harness
accepts an optional invitation lifetime so J2 uses the production seven-day
default rather than the shared fixture's one-day override. Both edited journey
scripts pass `node --check`.

## Visual review

Rebuilt `packages/web/dist` with `npm run build:demo --workspace=@opensight/web`.
The local static demo was captured in offline Chromium using a temporary copy
of the required `readme-gif.mjs`, updated for the current demo path and product
navigation. All HTTP/HTTPS requests were blocked; capture reported no page
errors. The README hero GIF was regenerated with the script's ffmpeg palette
pipeline, using two frames per second so the captured storyboard remains legible.
The new membership screenshot uses synthetic identities against the local
hosted API, with no invitation token visible.

Compared the static dashboard against `docs/images/sample-dashboard.png`:
synthetic chart values and card layout remain intact; navigation and branding
differences predate this issue. Compared the editor against the local
`qs-2026/qs-autograph-empty.jpg` reference: Data → Visuals → sheet ordering
remains intact. Existing differences include larger controls, offline notices,
the dotted canvas and docked Properties panel. The membership screen uses the
existing admin layout and accessible labels/statuses, with no horizontal
overflow in J2. Visual fidelity remains unmeasured. These are local captures,
not a deployed server.

## Remaining gaps

- J2 still records browser enrollment (#152) and sample charts on a fresh hosted
  home. Neither is changed by this issue.
- Existing memberships cannot be invited again through this workflow, including
  after an invitation is revoked or expires; `MEMBERSHIP_EXISTS` makes that
  existing provisioning limitation explicit. Replacing memberships and member
  removal remain outside this change.
- The UI states the seven-day default; operators can configure a shorter
  lifetime, reflected in each invitation's exact expiration timestamp.

Verification logs and browser results are under `/tmp/issue-150-*`. Initial
sandboxed API/browser attempts could not bind/connect to local sockets; the
authorized runs use local test access. No external service or AWS call was made.
