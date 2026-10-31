# Hosted access requests (#176)

The marketing site's nav and hero link to `#request-access`. The form collects
a name, work email, and optional organization and use-case note, then posts JSON
to `https://app.getopensight.org/api/access-requests`. It disables submission while
sending, resets and shows the approved confirmation only on HTTP 201, and retains
the inputs with an error message on any other response or network failure.

Per [D-79](idd/D-79-trial-signup.md), this is a request-access/waitlist flow.
Capturing a request sends **no email** and creates no tenant, identity, invitation,
or trial. The operator reviews requests and provisions workspaces manually using
the existing provisioning and invitation process. Marking requests provisioned
is future work; captured requests remain `pending`.

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
  each record has `id`, `name`, `email`, `organization`, `note`, `createdAt`, and
  `status`. Records are ordered newest first. The existing public serverless
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
creation timestamp, and `pending` status. Serverless backups include the table;
restoring older backups leaves it empty. Automatic retention/deletion and a
provisioned-status workflow are not implemented in this slice.
