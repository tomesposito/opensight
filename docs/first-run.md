# First run: choose samples or an authenticated workspace

OpenSight is open-source, QuickSight-compatible BI for dashboards, analysis
authoring, data preparation, connectors and embedding. The default local API
serves fixtures; it does **not** configure authentication or issue sessions.

## Run locally

Use Node 24+ and npm. From the repository root:

```sh
npm ci
npm run build
npm start --workspace @opensight/api
```

In a second terminal, run `npm run dev --workspace @opensight/web`, then open
`http://127.0.0.1:5173`. The Vite proxy forwards browser API requests to port 3000.
The API's logical session route is `/api/session`; the default web client requests
`/api/api/session` and the dev proxy strips the first `/api` prefix.

With no verifier, the API returns `503 SECURITY_NOT_CONFIGURED`. The web app
explains the missing authentication and offers setup instructions and an explicit
**Explore sample data** action. Unreachable APIs, invalid responses and rejected
sessions also get recovery guidance. Requests time out after ten seconds; Retry
connection, window focus and a thirty-second refresh can recover once the session
is available. A valid session opens the existing application with its registered
role. No fallback to samples happens automatically.

## Local demo and development sign-in

**Explore sample data** opts this tab into the existing fixture demo. It uses
public bundled samples and a demo-only preview persona. It creates no credential,
cookie, membership or hosted tenant session. The browser stops session polling
and does not give demo components API clients. The API explorer, file uploads,
live connector operations and server saves are unavailable in this mode.
Local analysis/pipeline drafts can still be saved in browser storage or exported
as definitions using the existing demo controls; those actions do not save data
to a server.

A persistent **Fixture demo · Public samples only · No hosted session** banner
includes **Return to setup**. Returning discards the mounted demo view and checks
authentication again. Reloading also returns to the normal session check; the
choice is not stored in a URL, cookie or local storage. Locally saved drafts are
subject to the demo's existing persistence behavior.

There is **no development sign-in endpoint or authentication bypass**, and no new
dev-sign-in environment variable. Local exploration is the opt-in alternative.
`/api/session` remains fail-closed, including requests with forged credentials or
demo-related query parameters. The existing
`VITE_OPENSIGHT_OFFLINE_DEMO=true` build setting selects a fixture-only web build;
it does not configure or weaken API authentication. You can also build the local
single-file demo with `npm run build:demo --workspace @opensight/web` and open
`packages/web/dist/opensight-demo.html`. That file is not a deployed server.

## Configure real authentication

The [hosted architecture](hosted-architecture.md) distinguishes proposed behavior
from shipped features. Follow [H2 tenant sessions](h2-tenant-sessions.md) for the
implemented configuration and API request shapes:

1. Set `OPENSIGHT_MODE=hosted` on the API process. Supplying hosted settings while
   retaining fixture mode refuses startup.
2. Set `OPENSIGHT_METADATA_DATABASE` to a durable SQLite file, such as
   `.opensight/metadata.sqlite`, never `:memory:`. Set `OPENSIGHT_PUBLIC_ORIGIN`
   to an exact HTTPS origin with no path/trailing slash. Terminate TLS at a
   trusted reverse proxy, preserve that Host, and restrict the backend listener.
   The HTTP Vite development origin is not a hosted-auth origin.
3. Set `OPENSIGHT_AUTH_ISSUER` and `OPENSIGHT_AUTH_AUDIENCE` to nonempty identifiers
   without whitespace, and `OPENSIGHT_AUTH_KEY_ID` to a unique signing-key ID.
   Supply three **distinct**, random 32-byte keys in canonical base64 through
   `OPENSIGHT_AUTH_SIGNING_KEY`, `OPENSIGHT_AUTH_ENCRYPTION_KEY` and
   `OPENSIGHT_OPERATOR_KEY`. Use your environment/secret manager, never the repo,
   browser storage, URLs or `VITE_*` variables.
4. Set explicit integer lifetimes: `OPENSIGHT_SESSION_SECONDS` (1–86400) and
   `OPENSIGHT_INVITATION_SECONDS` (1–604800). Configure invitation SMTP with
   `OPENSIGHT_SMTP_HOST` and `OPENSIGHT_SMTP_FROM`; `OPENSIGHT_SMTP_PORT` defaults
   to 465 for implicit TLS. If authentication is needed, supply both
   `OPENSIGHT_SMTP_USER` and `OPENSIGHT_SMTP_PASSWORD`. Restart the API with
   `npm start --workspace @opensight/api`.
5. Use the operator API to provision a tenant and invite its administrator.
   Follow H2's `/api/host/tenants`, `/api/auth/enroll`, `/api/auth/accept` and
   `/api/auth/login` workflow: invitation, password, TOTP and verified membership
   are required. Operator credentials grant no tenant data access.
6. Connect your authentication integration so browser API requests carry the
   verified bearer credential. H2 has no browser login form, sets no session
   cookies, and this onboarding screen does not add token entry or persistence.
   Configuring environment variables alone does not sign a user in. The web
   client's existing same-origin credential behavior is unchanged. A deployment
   integration must provide authenticated request transport and route the API
   prefix correctly. Once `/api/session` succeeds, choose **Retry connection**.

Library-based self-hosting can instead use
`createApiServer({ security: { authenticate, initialState, storePath }, ... })`.
The server-owned verifier must resolve a registered principal; the library has
no default credential. See [security and namespaces](security-namespaces.md).

No real auth service, SMTP delivery or external connection is needed for the
fixture demo. Setup links in the screen point to repository documentation online;
the same Markdown guides are in the clone's `docs/` directory for offline use.
