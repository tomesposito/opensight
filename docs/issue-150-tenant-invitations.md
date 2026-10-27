# Issue #150: tenant administrator invitations

Verified tenant administrators can use `GET /api/invitations`,
`POST /api/invitations` with `{email, name, role}`, and
`DELETE /api/invitations/:id`. The tenant comes exclusively from the verified
session. Foreign namespace paths and caller-supplied tenant/principal fields
fail closed. All five existing roles are supported.

Creation uses the built-in authentication membership and invitation tables.
The response contains `{invitation, token}`; only this creation response exposes
the fresh token. Lists contain identity, role and expiry metadata, never tokens,
hashes or sealed copies. Existing invitation email delivery and `/api/auth/enroll`
and `/api/auth/accept` remain in use. Expiry follows `OPENSIGHT_INVITATION_SECONDS`
(default 604800 seconds, seven days). No schema or dependency is added.

Revocation expires an unaccepted invitation and erases its sealed token in a
transaction serialized with acceptance. Historical operation references remain.
Accepted, expired, revoked and foreign invitation IDs return `RESOURCE_NOT_FOUND`.
An existing membership returns `MEMBERSHIP_EXISTS` on tenant invitation creation;
this workflow does not replace memberships or implement member removal.

Tenant administration rechecks the active membership, admin capability and
authorization revision inside the transaction. Adding or revoking a pending
invitation changes no active member's permissions and preserves existing tenant
sessions. The operator invitation endpoint retains its idempotency, email-only
token delivery, response shape and authorization revision invalidation. Audit
entries attribute tenant actions to the verified administrator and omit tokens.

Member removal remains operator-managed because it requires transferring or
stopping refresh, report and alert schedules (HQ-13). Browser enrollment remains
issue #152; this change supplies invitations to the existing API enrollment flow.
