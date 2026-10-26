# Usage tracking (#137)

OpenSight has one server-side `Analytics.track(scope, event)` door. It writes a
minimal tenant event log before attempting PostHog capture. This is product
analytics, separate from billing quotas and AI spend accounting in
`hosted-usage.ts`; it neither reads nor writes billing tables.

## Configuration and off switch

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `ANALYTICS_ENABLED` | absent/off | Only `1` enables collection by default. |
| `ANALYTICS_VENDOR_KEY` | absent | PostHog project key; environment only. No key means no collection, including the own log. |
| `ANALYTICS_VENDOR_HOST` | `https://us.i.posthog.com` | HTTPS origin for the one OpenSight PostHog project. Credentials, paths, query strings, fragments and HTTP are refused. |
| `ANALYTICS_STORE` | `.opensight/analytics.sqlite` in the local CLI | Local server event/settings database. Library callers can set `analyticsStorePath`; otherwise their local store is ephemeral. Hosted servers use their metadata database. |

Self-hosted installations are off by default. Hosted operators can explicitly
set `ANALYTICS_ENABLED=1`. In **Admin → AI provider settings → Analytics**, an
authenticated tenant administrator can enable or disable tracking. The saved
boolean override takes precedence over the environment default in either
direction. A missing/invalid vendor configuration always keeps actual collection
off, even if the saved preference is on; the UI states this.

`GET /api/admin/analytics` returns `{ enabled, override, defaultEnabled,
configured }`. `override` is `null` before the first save. `POST` accepts exactly
`{ "enabled": true }` or `{ "enabled": false }`; both methods require tenant
administrator access. Caller-supplied scope fields and non-booleans are rejected.
No key is returned. Settings are tenant-scoped and survive server restarts.
The self-hosted single-user CLI also supports the environment off switch; the
admin web form requires an authenticated server session.

The switch is checked during log admission and again before vendor delivery.
Turning it off suppresses queued events that have not been admitted, and prevents
subsequent vendor requests. A request already sent cannot be recalled. Existing
log rows and already delivered PostHog events are retained.

## Events and allowed properties

| Event | Properties | Server point |
| --- | --- | --- |
| `tenant_provisioned` | none | Tenant activation after provisioning and invitation delivery; replay excluded. |
| `user_invited` | none | Initial administrator invitation at tenant activation, or committed member invitation; replay excluded. |
| `user_activated` | none | Committed invitation acceptance; replay excluded. |
| `dataset_uploaded` | `sourceType`, `rowCountBucket` | Successful local/hosted upload; durable upload worker publication, not reservation or acceptance. |
| `dataset_prep_saved` | none | Successful prep definition save, including hosted import through save. |
| `analysis_created` | none | Committed v1 creation/copy or embedded console creation. |
| `analysis_first_visual` | none | First committed visual, including a creation/copy with visuals. A server-owned `hasHadVisual` analysis field survives edits, visual removal and restart. |
| `dashboard_viewed` | none | Authorized v1 dashboard/version description or legacy definition read; listing and visual queries are excluded. |
| `dashboard_shared` | none | Successful dashboard share grant write; revocations and idempotency replays are excluded. |
| `embed_viewed` | none | Authorized embedded content response or legacy signed embed rendering; issuance and status polling are excluded. |
| `ask_o_asked` | `count: 1` | Validated generative O question admission or embedded question. AI connection tests and calculation generation are excluded. |
| `sample_data_opted_in` | none | Local v1 analysis save first selecting the configured synthetic `sales` dataset, or switching back to it from another dataset. |

`sourceType` uses the existing source kinds: `file` or `postgresql`. The upload
paths currently emit `file`; registering a PostgreSQL connection is not a file
upload. `rowCountBucket` is exactly `0`, `1-99`, `100-999`, `1000-9999`, or
`10000+`. Raw row counts are never event properties. The question count schema
accepts positive safe integers; current call sites emit one per admitted question.

The TypeScript discriminated union and runtime schemas reject the whole event
when any property is unknown or invalid. This includes content fields, nested
objects, getters and custom serialization. The door copies validated primitive
values, so later caller mutations cannot inject content. Invalid events increment
`analytics.stats.invalid`; they reach neither destination.

## Storage and vendor payload

`analytics_events` contains `event_id`, `tenant_id`, `namespace_id`, `event_name`,
`props` (allowlisted JSON), and `created_at`. `analytics_settings` contains the
per-tenant boolean override. Both have composite foreign keys to the tenant's
namespace. The store uses a private metadata connection, tenant-scoped SQL and
tenant serialization. Tenant log reads require a context issued by
`TenantMetadata`, and validate current admission; no public log browsing API is
added. Application event scopes come only from authentication or provisioning.
Local installations use stable, randomly generated tenant IDs in their sidecar
store, rather than sending a local namespace label as a vendor identity.

Owner migrations initialize the tables alongside the other optional-provider
infrastructure, with no DDL during serverless invocations. Runtime grants,
bootstrap inventories and registered backup/restore inventories include them.
Older backups without analytics tables remain recognized and upgrade to empty
analytics tables. Reference tenant deletion removes that tenant's log/settings.

Every vendor call is an HTTPS `POST <host>/capture/` with this shape (placeholders
below are explanatory, not credentials):

```json
{
  "api_key": "<environment project key>",
  "event": "ask_o_asked",
  "timestamp": "<UTC event time>",
  "uuid": "<event UUID>",
  "properties": {
    "count": 1,
    "distinct_id": "<tenant ID>",
    "$groups": { "tenant": "<tenant ID>" },
    "$process_person_profile": false
  }
}
```

Neither destination contains names, emails, user IDs, file names, dataset
contents, SQL, questions, answers or query text. PostHog does not receive the
namespace ID. There is no browser SDK, autocapture, person identification,
session replay or marketing-site tracking in this implementation.

## Limits

Tracking never throws into the operation being measured. Call sites do not await
it. The default in-memory queue holds at most 256 waiting events, plus one active
event; overflow is dropped. The own log must commit before vendor delivery.
Storage or transport errors are swallowed and counted, with no content logged.
Vendor attempts time out after two seconds; redirects are refused. There is no
retry/outbox or exactly-once delivery guarantee. A crash between an operation's
commit and logging can lose that event; PostHog failure leaves the own copy.
`flush()`/`close()` are available to tests and server/invocation shutdown.

The browser-only **Try sample data** choice and browser draft autosaves do not
contact a server. Their clicks cannot be captured by this server-only pipeline.
The documented v1 draft-save signal is the available honest server point; it is
not a measurement of every browser opt-in. The static demo makes no analytics
calls and cannot save administrator settings. Hosted compositions which do not
support O generative routes still reject them; this issue adds no new AI backend.
The structured `/api/o/query` execution endpoint does not count questions: one
generative question can trigger multiple query previews. Browser-only deterministic
O interpretation therefore has no separate question-admission signal.
Generative question admission counts a validated attempt even when the AI
provider subsequently fails. Events describe server actions, not unique humans
or confirmed on-screen views. No analytics dashboards, retention job or event
export API are introduced.
