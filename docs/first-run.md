# First run: local data, samples or an authenticated workspace

OpenSight is open-source, QuickSight-compatible BI for dashboards, analysis
authoring, data preparation, connectors and embedding. The default local API
serves fixtures and a [local file workspace](local-data.md); it does **not**
configure authentication or issue sessions.

## Run locally

Follow the README's [Run it](../README.md#run-it) path. Use Node 24+ and npm,
free ports 3000 and 5173, and the default local configuration without hosted
environment settings. No external database is needed. In terminal 1, from the
repository root:

```bash
npm ci
npm run build --workspace @opensight/api
npm start --workspace @opensight/api
```

The build prepares the API and its workspace dependencies; `npm start` alone
does not build. Wait for `OpenSight API listening on http://127.0.0.1:3000`.
In terminal 2, also from the repository root:

```bash
npm run dev --workspace @opensight/web
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173) and keep both terminals running.
Stop each with Ctrl+C when finished. The Vite proxy forwards browser API requests to port 3000.
The API's logical session route is `/api/session`; the default web client requests
`/api/api/session` and the dev proxy strips the first `/api` prefix.

The default CLI advertises an explicit local-data capability. The web app opens
a **Local workspace** with empty Home, Author, Analyses and Dashboards pages.
Use **Upload or connect data**, or explicitly **Try sample data** to explore the
labeled synthetic sales dataset. **Remove sample data** restores the empty
Home and unbound Author; saved drafts and uploaded data are retained. The sample
opt-in lasts until this tab reloads. Open **Data → Data sources** to upload
a CSV, select **Prepare this upload**, then **Save pipeline → Build a chart**.
In Author, **Add visual**, assign fields, and **Save draft**; reopen through
**Analyses → My analyses**. [Draft definitions](local-drafts.md) stay in this
browser and origin, without uploaded rows, sync or publication. This local path
needs no hosted session. Uploads survive API restarts and expire after 24 hours; see the
[local database location](local-data.md). `/api/session` still
returns `503 SECURITY_NOT_CONFIGURED`; local capability discovery is separate.

A library API without either local-data opt-in or authentication instead shows
setup instructions and an explicit **Explore sample data** action. Unreachable
APIs, invalid responses and rejected sessions also get recovery guidance. Requests time out after ten seconds; Retry
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
choice is not stored in a URL, cookie or local storage. [Locally saved drafts](local-drafts.md)
remain device-local, in a collection separate from the local API workspace.

There is **no development sign-in endpoint or authentication bypass**, and no new
dev-sign-in environment variable. Local file access is a separate, explicitly
enabled API mode; sample exploration is also available from the setup screen.
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
4. Set explicit integer lifetimes: `OPENSIGHT_SESSION_SECONDS` (900–36000) and
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
