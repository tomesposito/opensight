# Hosted access requests (#176)

The marketing site's nav and hero link to `#request-access`. The form collects
a name, work email, and optional organization and use-case note, then posts JSON
to `https://app.getopensight.org/api/access-requests`. It disables submission while
sending, resets and shows the approved confirmation only on HTTP 201, and retains
the inputs with an error message on any other response or network failure.

Per [D-79](idd/D-79-trial-signup.md), this is a request-access/waitlist flow.
Capturing a request creates no tenant, identity, invitation, or trial. The
operator reviews requests and provisions workspaces manually using the
existing provisioning and invitation process. Marking requests provisioned
is future work; captured requests remain `pending`.

## Operator notification (#177)

When `OPENSIGHT_ACCESS_REQUEST_NOTIFY_TO` names a single email address and the
deployment's SMTP transport is configured, storing a request also emails that
address the requester's name, email, organization, and note. The response to
the visitor never waits on or fails because of mail: the request is durable
first, and notification is best-effort afterwards. Each row carries
`notified_at`; a failed or skipped send leaves it null (visible in the
operator list), and the next submission retries any unnotified rows oldest
first, stopping at the first send failure. With the variable unset or SMTP
unconfigured, capture stays pull-only — the operator list is the backstop.
A malformed `OPENSIGHT_ACCESS_REQUEST_NOTIFY_TO` fails startup, like the
rate-limit variable.

Before anything is sent, each row is claimed atomically (#232): a
conditional update stamps a claim token and a five-minute lease on an
unnotified, unclaimed row, and only the claim's winner sends it. Concurrent
submissions or maintenance calls therefore never email the operator twice
about the same request, even through a transport that does not deduplicate.
The send keeps its stable per-request dedupe key (#224), a failed send
releases its claim for a prompt retry, and a claim whose sender died
mid-send becomes claimable again when the lease lapses.

## Endpoint contract

- `POST /api/access-requests` is public and accepts `application/json`, capped
  at 16 KiB. Its only fields are `name`, `email`, `organization`, and `note`.
  `name` is required, trimmed, and 1–120 characters. `email` is required,
  trimmed and lowercased, has a plain local-part@domain.tld shape, and is at most
  254 characters; embedded whitespace and control characters are rejected.
  Optional organization and note are trimmed, limited to 160 and 1000 characters,
  and stored as null when omitted or blank. Unknown fields and non-string field
  values are rejected. A successful insert returns `201 { "received": true }`,
  without returning the submitted personal information.
- Invalid JSON, content type, body shape, or fields return
  `400 ACCESS_REQUEST_INVALID`. An oversized body returns
  `413 ACCESS_REQUEST_TOO_LARGE`. Errors use the existing `{ "errorCode": ... }`
  envelope.
- `GET /api/host/access-requests` requires the existing `Operator` authorization
  credential and rejects browser origins. Missing or invalid operator credentials
  return `403 OPERATOR_REQUIRED`. Success returns `200 { "requests": [...] }`;
  each record has `id`, `name`, `email`, `organization`, `note`, `createdAt`,
  `status`, and `notifiedAt` (null until the operator notification lands).
  Records are ordered newest first. The existing public serverless
  boundary continues to block all `/api/host` routes; review uses the private
  operator plane.
- Only the public capture route allows browser responses to
  `Origin: https://getopensight.org`, setting that exact allow-origin and
  `Vary: Origin`. Other origins receive no allow-origin header. OPTIONS returns
  204 with allowed method `POST` and allowed header `Content-Type`. No wildcard
  or credentials are enabled. Other routes retain their origin restrictions.

## Rate limiting and storage

The default is five POST attempts per remote address per ten-minute fixed window,
starting with the first attempt. `OPENSIGHT_ACCESS_REQUEST_RATE` overrides the
count with a positive integer from 1 to 100000; malformed configuration fails
startup. Invalid POST bodies also consume attempts; preflight does not. Further
attempts return `429 ACCESS_REQUEST_RATE_LIMITED` until the window expires.

Counters use separate `access-request:` buckets in the existing durable
`h2_attempts` store, with hashed addresses. They survive server restarts and
separate serverless invocations. The handler uses the socket's remote address;
caller-supplied forwarding headers cannot reset the counter. Serverless ingress
supplies its already-validated viewer address to that socket.

`initializeAccessRequests` creates `h8_access_requests` in the membership/operator
database. Normal hosted startup and the single-node, runtime, and serverless
owner migrations initialize it. Serverless runtime grants include this table for
the operator role only; invocation handlers do no DDL. Run the normal owner
migration before activating an updated serverless runtime. The edge boundary
recognizes the exact marketing form URL and carries its POST and preflight to
the hosted handler. No deployment or AWS calls are part of this build.

The table stores the submitted personal information, a random UUID, an ISO UTC
creation timestamp, `pending` status, and a nullable `notified_at` timestamp
(added additively by the initializer for tables created before #177), plus
the notification claim columns `notify_claim_token` and
`notify_claim_expires_at` (added the same way for tables created before
#232; both are null except while a notification send is in flight).
Serverless backups include the table;
restoring older backups leaves it empty. Automatic retention/deletion and a
provisioned-status workflow are not implemented in this slice.
