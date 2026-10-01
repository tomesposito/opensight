# H3 (#23): verification and visual review

Work stays on `work/issue-23-h3-durable-sources`, based on `b71f92be`.
The reboot left two completed checkpoints (`16c9ad96`, `76bd3776`), which were
preserved. Work resumed with the uncommitted migration and integration checks.
Neither design document nor the dependency lockfile changed. No dependencies,
AWS calls, deployment, merge, push or issue closure are part of this slice.

## Acceptance evidence

The 23 H3 checks cover durable owner/tenant source identity, encrypted credential
references, explicit upload expiry, policy rebinding, rotation and retirement.
SQLite reopen and fresh PostgreSQL pools preserve source, secret, recipe and
policy admission; foreign owners still cannot read them. Rotation invalidates
derived cache admission. Database contents and HTTP responses exclude credential
values. Malformed bodies cannot supply foreign secret references or egress hosts.

Discovery, preview, query, output and AI schema apply the same policy grammar to
real source bindings. Differential tests compare PostgreSQL and server-cached
DuckDB results for OR, NULL, date and numeric rules, with CLS dependency denials.
An immutable operator tenant predicate prevents a user policy from admitting
another tenant's rows. Restricted PostgreSQL metadata roles cannot read other
tenants or leave tenant context behind in a pooled connection.

Cross-tenant/source/owner/import/dependency tests assert named refusals with zero
connector reads. Graph tests include joins, appends, unused branches, selected
output, cached prepared dependencies and protected-source refusal after a policy
change. HQ-4 sharing and embedding refusals remain intact. Unsupported hosted
generation, automation and legacy/embed routes cannot fall back to fixtures.

Publication tests mutate policy or advance upload expiry during the final verifier
check for discovery, query, preview, output, AI schema and prepared rows. No
response is written. Session revocation after body intake prevents mutation.
A write-response defect found during integration was fixed: mutations verify
before committing and acknowledge their own write; H2's revision-bound session
is invalid on the next request. Reads retain the final verifier check.

Migration tests require suspended/provisioning tenants, reject incomplete mappings
and unresolved principals, inject interrupted writes, reopen the database and
resume from encrypted backups. They verify backup permissions, tamper rejection,
upload parsing/counts/expiry, secret restoration on rollback, and the sealed
rollback boundary. Expiry maintenance deletes payload records for suspended
tenants too. The operator procedure and API surface are documented in
[h3-durable-sources.md](h3-durable-sources.md).

## Static demo comparison

`TZ=UTC npm run build:demo --workspace @opensight/web` rebuilt the single-file
demo. Chromium captured dashboard, author and data preparation at 1440×1000,
with all external HTTP requests blocked. It recorded zero page errors, zero
external requests and no page-wide horizontal overflow.

The author capture is pixel-identical to `docs/images/author.png`. Visual review
against `qs-author-light-flow.jpg` confirms the existing Data → Visuals → sheet
layout and docked controls. The reference contains a populated analysis while
this capture shows the empty builder; this does not measure visual fidelity.
The default dashboard still honestly refuses to invent data for the imported
definition. Data preparation retains its static-demo notice and disabled hosted
controls. Its empty pipeline differs from the populated README capture, so no
pixel-equivalence claim is made for that image.

No frontend files changed and no new visual defect was found. Existing README
images and the hero GIF remain current for this backend slice. The footer still
says “OpenSight · Local rendering preview · visual fidelity not measured”.
This is a local static demo, not a deployed server. Local capture evidence is in
`/tmp/h3-browser/`, `/tmp/h3-browser.log` and `/tmp/h3-demo-build.log`.

## Full verification

The completed root `npm test` exited **0** with **1,448 passed / 0 failed /
0 skipped**, using `TZ=UTC` and the brief's `DATABASE_URL` for the local
PostgreSQL database on port 5433. Every live PostgreSQL test ran. Strict
TypeScript and package type checks ran as part of the suite.

| Runner | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 224 | 0 | 0 |
| Bundle parser | 197 | 0 | 0 |
| Embedding SDK | 4 | 0 | 0 |
| O interpreter | 32 | 0 | 0 |
| Query engine | 511 | 0 | 0 |
| Web | 477 | 0 | 0 |
| Root conformance | 3 | 0 | 0 |
| **Total** | **1,448** | **0** | **0** |

The first full run ended with runtime diagnostic `fatal library error, lookup
self` and exit 143 during web tests, without an assertion failure. The full
command was rerun in a detached process with an explicit exit-status file;
the table reports only that completed run. Final local evidence is
`/tmp/h3-full-tests-final.log` and `/tmp/h3-full-tests-final.exit`.
`git diff --check` passes. The implementation, runbook and verification are
checkpointed on the requested branch; no publication or merge was performed.
