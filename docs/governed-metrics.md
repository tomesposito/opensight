# Governed semantic metrics (#157)

A governed metric is a versioned workspace asset bound to exactly one dataset.
Its definition contains a name, calculated-field expression, default aggregation,
number/percentage/currency format, description, and synonyms. The workspace and
full dataset reference (including the prepared dataset owner) determine scope;
matching field names on another dataset never make a metric reusable there.

## Authoring and approval

Open **Data → Metrics**, or a dataset's **Metrics** tab. Choose a dataset, enter
its real field names using `{field}` syntax, and **Save draft**. The expression
editor uses the existing calculated-field parser and function catalog. Unknown
fields, parameters, invalid expressions, invalid formats, and conflicting metric
names fail closed. Names are unique within a dataset, ignoring case, and cannot
shadow physical field names. Synonyms participate in Ask O's existing ambiguity
handling; they do not silently win over conflicting vocabulary.

Dataset owners and workspace administrators can create, edit and publish.
Any editor can create a draft on a workspace dataset for approval, and edit their
own draft until its first publication. Readers cannot create or edit. Only a
dataset owner or administrator can **Publish**. Prepared datasets use their
recorded owner; legacy datasets use their source owners, with administrators
responsible for datasets without an owner. The definition catalog exposes schema
metadata for drafting, not data rows. Query access still follows normal dataset,
source, row-level and column-level permissions.

Saving never publishes. A new metric is unavailable to consumers until approved.
Editing a published metric creates a draft while its last published definition
remains active. The history view shows every saved definition, state, actor and
time. Each create, edit and publish appends an immutable version and audit entry.
The export includes the complete definition history and audit. History and export
require edit permission; readers see only published definitions.

## Shared consumption and follow-latest

Published metrics appear in Author's **Governed metrics** field group. Assign one
to a measure well like an ordinary field. The visual uses its default aggregation
and format. Ask O accepts the metric name or synonyms on that dataset and reports
the selected metric and version in grounding. A governed aggregation cannot be
changed by an Ask O step.

Saved analyses and published dashboard versions retain stable metric IDs, not
copies of metric expressions. Each query resolves the latest published definition
from the workspace asset store. A publication therefore affects the next query,
including queries against an older dashboard version. Renaming a metric does not
break existing visuals. Draft changes do not affect query results. Author refreshes
its metric catalog on focus and every 30 seconds; result metadata carries the
actual resolved names, formats and versions. Already displayed results change on
the next query or refresh, rather than by a push notification.

Metric expressions use the existing calculation/query pipeline. Scalar expressions
are aggregated using the default aggregation; expressions that already aggregate
or perform a table calculation keep that expression's aggregation semantics.
DuckDB, Postgres and fixture/client execution share the same parser and
post-processing. Differential tests cover scalar, aggregate-ratio and PRE_AGG
expressions. Caller-supplied calculations cannot replace a governed metric's
reserved `__metric_` reference. An unpublished or wrong-dataset reference returns
`METRIC_NOT_PUBLISHED`; a replacement expression returns
`METRIC_OVERRIDE_FORBIDDEN`.

## Fan-out and schema changes

This version does not prove join cardinality. A metric on a dataset containing a
join, including a join in a referenced prepared dataset, fails with
`METRIC_UNSAFE_FANOUT`. This conservative rule also rejects joins that happen to be
one-to-one; it never silently doubles a governed result. Append-only pipelines
continue through the existing aggregation semantics. Making joins provably safe
requires future cardinality metadata and validation.

Definitions validate against the current dataset schema at draft save and
publication. Historical definitions survive schema changes. If a previously
published expression loses a field or source, normal query validation fails; it
does not return a stale cached result. Dataset deletion is blocked by
`DATASET_DELETE_BLOCKED_BY_METRIC`, including unpublished drafts.

## API and persistence

| Method and resource | Behavior |
| --- | --- |
| `GET /api/v1/metric-datasets` | Editor catalog of exact dataset references and real schema fields |
| `GET /api/v1/metrics` | Visible workspace metrics |
| `POST /api/v1/metrics` | Create an ID, dataset binding and draft definition |
| `GET /api/v1/metrics/:id` | Visible current definition and published definition |
| `PUT /api/v1/metrics/:id` | Append a draft definition |
| `POST /api/v1/metrics/:id/publish` | Publish the current draft |
| `GET /api/v1/metrics/:id/versions` | Complete version history, paged |
| `GET /api/v1/metrics/:id/export` | Export history, audit and dataset binding |
| `GET /api/v1/datasets/:id/metrics` | Dataset-specific published/authorized draft catalog |
| `POST /api/v1/dashboards/:id/question` | Ask O query admitted through the dashboard's durable dataset binding |

Updates and publication require the existing `If-Match` version header. Writes
support `Idempotency-Key`; lists use the standard `Limit` and `Cursor` headers.
The dataset-specific list accepts a JSON `Metric-Dataset` header containing
`kind`, `id` and, for prepared datasets, `ownerId`. Without that header it refers
to the caller's prepared dataset. Create takes `{id, dataset, definition}`; edit
takes `{definition}`; publish takes `{}`. Definition fields are `name`,
`expression`, `defaultAggregation`, `format`, `description`, `synonyms`. Supported
aggregations are `SUM`, `AVG`, `COUNT`, `MIN`, `MAX`, `DISTINCT_COUNT`. Format is
`{style, decimalPlaces, currency?}`; currency uses a three-letter uppercase code.

Metrics use existing workspace asset transactions, durable local definition or
security storage, and hosted metadata storage. Existing SQLite and Postgres asset
kind constraints upgrade during metadata initialization. Hosted metric writes
advance the configuration revision and emit the existing `assets.changed` event,
using the same session/revision rules as other configuration edits. No new
configuration variables, dependencies or external services are required.

The static demo has no metric store and displays an explicit API requirement.
It does not ship staged definitions. Metric authoring requires a local or hosted
API; the single-file demo is not a deployed server.

## Migration boundary

Promotion is opt-in (#160). In **Data → Metrics**, the dataset calculation list
has **Promote** actions. A saved prep calculation also has a **Promote** action
when selected on the prep canvas. Both open the existing metric definition form,
prefilled with the saved name and expression. Numeric expressions default to SUM;
other scalar types default to COUNT. Format defaults to number with two decimal
places: currency and percentage semantics are not guessed. The promoter can edit
all definition fields before saving, and must confirm a unique final name.
A calculated output that is already a dataset field therefore needs a different
metric name; `METRIC_NAME_CONFLICT` never overwrites or silently renames it.

Saving creates a draft through the same metric model. The source calculation and
recipe stay unchanged. Dataset owners and workspace administrators approve by
publishing; unpublished promotions cannot execute in analyses, dashboards or Ask O.
The metric carries immutable provenance (source calculation ID, name, expression,
dataset version, and its existing exact dataset binding). Its first audit action
is `promote`; later edit/publish versions use the ordinary metric history. The
catalog labels promoted metrics and export includes provenance and audit.

`POST /api/v1/metrics/promote-calc` takes `{id, dataset, calculationId, definition?}`.
The definition is optional for API callers; omission uses the defaults and still
fails on a name conflict. The editor dataset catalog includes `calculations` with
IDs, source expressions, prefilled definitions or a named validation error.
Prepared calculations use their stable calculate-step ID. Legacy dataset
`CreateColumnsOperation` calculations use `logicalTableId/transformIndex/columnId`.
The server resolves the source itself and validates its original expression even
when the submitted definition changes it. A missing source reports
`METRIC_CALCULATION_NOT_FOUND`; invalid expressions and missing fields retain the
existing metric errors. Readers cannot propose. Source dataset revisions are
checked against the schema snapshot before commit, and idempotent retries use the
existing metric receipt mechanism.

This slice covers saved dataset calculations only. Analysis-local calculations
may depend on parameters, other local calculations and analysis-specific binding;
there is no analysis promotion action or automatic conversion. A prep expression
must validate against its dataset's final output schema. Intermediate fields
removed or renamed later in the recipe are not substituted or inlined: promotion
fails closed until a definition can bind. Existing join safety rules still apply
when a published metric is consumed. Unsaved prep changes must be saved first.
Static-demo promotion controls display the explicit local/hosted API requirement.
