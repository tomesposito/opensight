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
