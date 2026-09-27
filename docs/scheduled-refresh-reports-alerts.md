# Scheduled refresh, reports and alerts (Phase 3a)

These are OpenSight resources served by the existing local `node:http` API. They
are not AWS API compatibility claims. The API still has no authentication; user
IDs identify subscription owners, not authenticated principals. Keep deployment
behind a trusted access boundary. No AWS/source connections are inferred from
imported definitions.

## Refresh

- `GET /api/refresh-schedules` lists schedules.
- `GET|PUT|DELETE /api/datasets/{id}/refresh-schedule` manages one schedule per dataset.
- `GET /api/datasets/{id}/refresh-status` reports lastGood, nextRun,
  consecutiveFailures, state and a named error (including lastGood).
- `GET|POST /api/datasets/{id}/refresh-runs` lists history or runs a refresh now.
- `GET /api/datasets/{id}/refresh-runs/{runId}` retrieves a run.

PUT takes `{ "enabled": true, "schedule": { "kind": "interval", "minutes": 60,
"timeZone": "UTC" } }`. Daily uses `{ "kind": "daily", "at": "09:00",
"timeZone": "America/New_York" }`. Weekly additionally requires `weekday`
(0 Sunday through 6 Saturday). Unknown fields, invalid IDs, times, zones, and
nonintegral/out-of-range intervals are rejected. PUT replaces the resource and
reanchors the next run. Disabled schedules have null nextRun. DELETE retains
history and last-good status. Query-string selectors are unsupported.

The local API resolves `sales` using its existing administrator-selected CSV
binding. Refresh reloads all source rows into DuckDB, checks schema/types/finite
numbers/security, and records the source row count (including null-valued rows).
This DIRECT_QUERY engine has no persistent analytical cache: subsequent queries
still reload the CSV, exactly as before. Failed refreshes never return old rows
as current. Source errors record `SOURCE_UNREACHABLE`; other engine failures keep
their named code. Raw filesystem/driver messages are not exposed.

The scheduler runs while the API is listening and stops with it. Jobs for a
dataset cannot overlap. Missed occurrences coalesce into one run, then the next
occurrence is calculated after the current time. Interval schedules use elapsed
minutes; daily/weekly schedules use IANA wall time. Nonexistent DST times are
skipped; repeated times run once per local date. The scheduler is single-process,
not a distributed worker or a Lambda background task.

The CLI stores resources/history atomically in `.opensight/automation.json`
(gitignored). Override with `OPENSIGHT_AUTOMATION_STORE`. The library's optional
`automationStorePath` enables the same durability; omission means ephemeral
state. Use one API process per store file. Restart retains next-run timestamps
and last-good state, marks unfinished runs `REFRESH_INTERRUPTED`, and resumes
schedules. Disk write failures fail the operation instead of claiming persistence.

## Email reports

- `GET /api/users/{userId}/subscriptions` lists that user's subscriptions.
- `GET|PUT|DELETE /api/users/{userId}/subscriptions/{id}` manages a subscription.
- `GET|POST /api/users/{userId}/subscriptions/{id}/runs` lists history or sends now.
- `GET /api/users/{userId}/subscriptions/{id}/runs/{runId}` retrieves a run.
- `GET /api/automation-status` identifies SMTP configuration and persistence mode.

PUT accepts `dashboardId`, `recipients` (1–50 unique plain email addresses),
`enabled`, and `schedule` (the refresh schedule shape). Dashboard IDs must resolve
in the definition store. User IDs scope resources and history; there is no user
authentication in this phase. IDs are caller-chosen; PUT creates or replaces.
Schedules persist alongside refresh resources. Deleting a subscription preserves
its history. Interrupted deliveries are recorded with an unknown delivery outcome
and are not automatically retried, avoiding silent duplicate mail.

At send time, the server executes the complete dashboard definition through the
existing DuckDB planner, preserving filters, calculations and security gates. It
passes the resulting rows and field bindings into the same pure visual compiler
used by the browser. The email uses its ordered table cells, titles, labels,
visibility, decimal formatting and background options. HTML is escaped; no scripts,
remote images or browser chart runtime are embedded. These are accessible tabular
snapshots, not screenshots. Unsupported definitions and unresolved sources record
`SNAPSHOT_FAILED`; there is no fallback to old results or fixture values.

SMTP configuration is exclusively process environment:
`OPENSIGHT_SMTP_HOST`, `OPENSIGHT_SMTP_PORT` (default 465),
`OPENSIGHT_SMTP_FROM`, and optionally both `OPENSIGHT_SMTP_USER` and
`OPENSIGHT_SMTP_PASSWORD`. The built-in transport supports implicit TLS with
certificate verification and optional AUTH LOGIN. Use an SMTP service's implicit
TLS endpoint; STARTTLS/plaintext endpoints are not supported. Secrets belong in
the deployment environment, never resource bodies, files in the repository, or
logs. Partial/unknown settings fail startup. With no SMTP settings, report runs
record `SMTP_NOT_CONFIGURED`. Rejected/timed-out delivery records
`SMTP_SEND_FAILED` without raw server messages. Acceptance of SMTP DATA is the
send boundary; it does not prove inbox delivery.

Tests inject `StubMailTransport`; it retains messages in memory and never opens a
socket. No new external packages were added: SMTP uses Node TLS and the server
imports the Apache-2.0 workspace visual compiler through `@opensight/web/compiler`.
