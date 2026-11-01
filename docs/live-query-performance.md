# Live-query performance (#159)

Aggregate declarations and cache policies are trusted caller-owned configuration,
like `localData`. Supply them through `PlanOptions` / executor options, never
through imported dataset metadata, analysis definitions, or HTTP request bodies.
This version does not manage warehouse aggregate tables or decide who manages
them in a hosted product. The caller provisions and maintains them.

## Aggregate tables

`planVisual(request, { aggregates })` validates each declaration's name, plain
table/schema identifiers, source dimension/measure columns, optional date grain,
aggregation, and optional `countColumn`. Unknown properties, unresolved source
columns, and duplicate or case-ambiguous column names are errors. `countColumn`
is a plain aggregate-table column name; it need not exist in the source.

The first eligible declaration is selected. Every visual dimension must match a
declared dimension's column and granularity exactly; a dimension subset is allowed.
Every measure must be SUM over a declared SUM column, or COUNT with a declared
count column. AVG, MIN, MAX, calculations, row security, protected plans, and shared
post-processing prevent substitution. Every filter must reference an aggregate
dimension; raw timestamp filters on truncated dimensions also keep the source,
because comparing truncated values can change which source rows qualify.

The aggregate must contain one row per declared grain, with per-grain SUM values
stored under the original measure column names, and an optional per-grain row count
under `countColumn`. COUNT is rewritten as SUM of that count column, coalesced to
zero for an empty scalar result. The caller
must ensure row counts match the queried COUNT column: source COUNT(column) ignores
NULL values. A row-count declaration is therefore unsuitable for nullable COUNT
targets. Date grain values must already be truncated to that grain in UTC; existing
SQL dimension transforms remain in place and are idempotent over those values.

Plans report `executionSource: { kind: 'aggregate', name }` when substituted,
otherwise `{ kind: 'source' }`. Postgres accepts `aggregates` in its execution
options and queries the caller-provisioned table with its declared schema. The local
DuckDB executor materializes source CSVs only; it does not provision or substitute
aggregate tables. The planner generates aggregate SQL for every supported dialect.

## Result caching

Caching is off by default. Both `executeLocal` and `executePostgres` accept
`liveCache: { cache: new LiveResultCache(), ttlMs }`. The caller must supply a
positive safe-integer TTL in milliseconds. No default TTL is invented. Select
whether and how long to cache each dataset in the calling code.

`LiveResultCache({ maxEntries, maxBytes, maxEntryBytes, now })` defaults to 100
entries, 32 MiB total retained bytes (`32 * 1024 * 1024`), and 8 MiB per entry
(`8 * 1024 * 1024`). All three limits must be positive safe integers, and
`maxEntryBytes` must be no greater than `maxBytes`; invalid configuration raises
`INVALID_INPUT`. When lowering `maxBytes` below 8 MiB, also supply a smaller
`maxEntryBytes`. `now` can be an injected millisecond clock.

The accounting unit is the UTF-8 byte length of `JSON.stringify(rows)`, measured
on the caller's SQL rows before copying. It is a deterministic serialized-size
estimate, not a measurement of JavaScript heap usage or transient query memory.
A result exceeding either byte budget bypasses caching without cloning or
incrementing `stores`; the executor still returns the query result with live
(or aggregate) provenance. Serialization failures or nonfinite/unsafe size
estimates also bypass caching. Invalid TTLs still raise `INVALID_INPUT`.

Insertion purges **all** expired entries, then removes any previous value for the
same key, including when the replacement bypasses caching. It evicts the oldest
stored entries until both the total-byte and entry-count limits fit, then copies
and stores the rows. Reads do not change eviction order. Expiry on access and
prefix/full invalidation release the removed entries' bytes. Retrieval also
copies rows to isolate them from caller mutation.

`stats()` returns cumulative `{ hits, misses, stores }` counters plus current
`entries` and `retainedBytes`. It purges expired entries before reporting the live
totals, without changing the cumulative counters. `stores` counts only results
actually stored, including successful replacements.

Keys are JSON arrays of dataset ARN, visual ID, dialect, SQL, and parameters.
Use a separate cache instance for independent source environments with overlapping
dataset ARNs; connection strings and local paths are intentionally not keys.

Planning and security checks always run, including on a hit. Any request carrying
a security context, even without an active protection policy, bypasses cache reads
and writes. Protected plans also bypass caching. `refreshLocal` bypasses the cache
and invalidates all that dataset's entries before reloading; a failed reload cannot
leave an old entry usable. Refresh does not populate the result cache.
`cache.invalidate(liveDatasetCachePrefix(dataSetArn))` manually invalidates one
dataset (including Postgres); `cache.invalidate()` clears all entries.
The cache stores SQL result rows. Shared post-processing runs against the fresh
plan on every hit, so changing a table calculation cannot reuse its old output
when the underlying SQL is unchanged. Byte budgets therefore apply to the SQL
rows even when post-processing reduces them to a much smaller displayed result;
an oversized SQL result is executed live again on the next request.

## Provenance

Query results carry `provenance.source`: `live`, `aggregate`, or `cache`.
Aggregate results include `aggregateName`; cache hits include the entry's ISO
`cachedAt` and retain the aggregate name when applicable. The API passes this
through. Visual cards show “Cached result” or “Aggregate: <name>” only when the
result says so. Live and fixture results without provenance show no label.

MySQL returns live provenance; its executor does not accept the new aggregate/cache
options in this version. No dependency, AWS call, background refresh, hosted table
management, or public cache-policy endpoint is added.
