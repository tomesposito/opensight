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

## Threshold alerts

- `GET /api/alert-rules` lists rules.
- `GET|PUT|DELETE /api/alert-rules/{id}` manages a rule.
- `GET /api/alert-rules/{id}/state` reports condition state and evaluation errors.
- `GET /api/alert-rules/{id}/runs[/{runId}]` retrieves evaluation/delivery history.
- `GET /api/alert-rules/{id}/transitions` retrieves persisted webhook-shaped events.

PUT accepts `datasetId`, `dashboardId`, `visualId`, `fieldId` (a visual measure),
optional `dimensions` (dimension field IDs mapped to exact values), `enabled`,
`recipients`, and `condition`. Above/below conditions are
`{ "kind": "above", "threshold": 100 }` or `below`, using strict comparisons.
A KPI must return one finite numeric metric. Grouped visuals must resolve exactly
one row after applying dimension selectors; ambiguous/empty/null results record
`METRIC_UNAVAILABLE` and preserve the last condition state.

Percent change uses `{ "kind": "percent-change", "comparison": "above",
"threshold": 20, "period": { "columnName": "order_date", "unit": "month" } }`.
`unit` is day, week (Monday start), or month. The most recently **completed UTC
calendar period** is compared with the complete period before it, using the
original visual's filters and measure definition plus bound datetime limits.
The value is `(current - previous) / abs(previous) * 100`; 20 means 20 percent.
Missing previous values and zero baselines are explicit errors, not zero change.
This is a calendar comparison, not a comparison with the previous refresh.

Enabled rules run after each successful refresh of their dataset. Initial state
is `ok`; a breached threshold records `ok -> triggered` and sends email through
the shared transport. Continued breaches do not send duplicates. Clearing the
condition (including equality) records `triggered -> ok`. Re-entering a breach
sends again. Editing a rule retains its condition state until the next evaluation;
in-progress evaluations reject edits/deletes with 409. Failed source refreshes
never evaluate rules. Metric and SMTP errors are recorded separately from the
refresh result. Missing SMTP leaves the condition triggered and the notification
failed; this phase has no automatic notification retry.

Webhook delivery is deferred. Transition payloads are persisted and returned by
the API, with exactly these fields: `version: 1`,
`type: "opensight.alert.state_changed"`, `eventId`, `occurredAt`, `ruleId`,
`datasetId`, `dashboardId`, `visualId`, `fieldId`, `refreshRunId`, `from`, `to`,
`value`, `previousValue`, `percentChange`, and `condition`. Non-percent rules
have null previousValue/percentChange. Events contain no recipients or credentials.
No webhook URL is accepted and no outbound HTTP request is made. History and
transitions remain available after deleting a rule.

## Static preview and validation

The demo's **Schedules & alerts** mode presents separate refresh, subscription and
alert states, each labeled as needing a hosted API. Creation controls are disabled;
there are no fake jobs, subscriptions, rule evaluations or delivery confirmations.

Root `npm test` includes the API's new `*.test.mjs` files automatically through
its existing workspace runner. Final Phase 3a validation on Node 24.20.0:

| Suite | Tests | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: | ---: |
| API | 56 | 56 | 0 | 0 |
| Bundle parser | 183 | 183 | 0 | 0 |
| Query engine | 341 | 340 | 0 | 1 |
| Web | 321 | 321 | 0 | 0 |
| Cross-package conformance | 3 | 3 | 0 | 0 |
| **Total** | **904** | **903** | **0** | **1** |

Root `npm test` exited 0; no tests were cancelled or marked todo. It includes
strict package builds and public consumer typechecks. The optional external
Postgres test was skipped with `DATABASE_URL` unset; embedded PostgreSQL
comparisons ran. SMTP settings were removed from the test process, and email
sends used the stub transport. Tests used only local files, DuckDB, embedded
Postgres and loopback HTTP; no AWS, real SMTP, webhook or external database calls.

Coverage includes fake-timer refresh/report scheduling, DST gaps/folds (including
resuming within a fold), nonoverlap, missed-run coalescing, source loss/recovery,
last-good status, restart/interruption history, atomic-store failures and corrupt
state rejection, HTML escaping and compiler output, SMTP configuration/errors,
calendar-period metrics, threshold transitions and exact webhook payloads, CRUD
validation and static disabled states. Existing definition/query/dialect and
browser regressions remain green. Persistent files retain all history in this
phase; administrators should monitor store size. One process must own each file.

`npm run build` and `npm run build:demo --workspace=@opensight/web` both exited 0.
The rebuilt single-file artifact is `packages/web/dist/opensight-demo.html`
(1,575,036 bytes; generated and gitignored). `git diff --check` passed.
`SOLUTION_DESIGN.md` was unchanged. The only added package dependency is the
existing `@opensight/web` workspace, whose manifest license was verified as
Apache-2.0; the lockfile adds no third-party packages.
