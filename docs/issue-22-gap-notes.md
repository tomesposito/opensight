# H2 (#22): verification and visual review

Work is confined to `work/issue-22-h2-tenant-sessions`, based on `e908cbd2`.
The reboot left a clean branch with no H2 checkpoints; implementation began with
the first unfinished item. No merge, push, issue closure, AWS call or deployment
is part of this work. Neither design document nor the dependency lockfile changed.

## Acceptance coverage

The H2 tests exercise strict hosted configuration, durable schema startup,
memory-hard password hashing with distinct salts, encrypted-secret tamper and
subject-substitution rejection, RFC 6238 TOTP vectors, replay prevention,
preprovisioned invitation acceptance and failed-delivery recovery. Onboarding
replays preserve tenant/membership IDs, and changed payloads or cross-route
idempotency-key reuse are rejected.

HTTP tests cover forged principal headers and body/subject claims, unknown hosts,
foreign browser origins, forwarded-host assertions, foreign namespace paths,
operator versus tenant-administrator separation, reader capabilities, and every
legacy/unknown route's authenticated admission boundary. They exercise the full
operator invitation → enrollment → acceptance → login → switch → logout flow,
membership removal, suspension/resume/deletion admission, and safe progress
responses. No tenant request can fall back to the fixture stores or scheduler.

Session tests cover process restart, bad signatures, wrong issuer/audience/origin,
expiry, preserved expiry across tenant switches, metadata revision changes,
membership removal, suspension/resume and signing-key retirement. Rate limits
survive restart. Real CLI child processes prove that partial hosted configuration
never starts the fixture server, the SQLite file is private, and key rotation
revokes sessions in an already-running process.

The live PostgreSQL test uses a temporary schema, separate restricted tenant role
and pooled connections. Tenant SQL cannot read any H2 credential/session/control
table. Concurrent onboarding converges on one tenant, concurrent TOTP consumption
and tenant switching each admit one winner, and logout/suspension/key rotation
take effect through another verifier instance. H1 FORCE RLS still limits tenant
metadata and leaves pooled connections without residual tenant context.

The implementation and operator runbook are in
[h2-tenant-sessions.md](h2-tenant-sessions.md). H2 adds an API authentication flow,
not a browser login screen. Hosted source execution, embedding and automation
remain explicitly unavailable pending their scheduled slices. Deletion admission
is implemented; retention/artifact cleanup is not represented as complete.

## Static demo and reference comparison

`TZ=UTC npm run build:demo --workspace @opensight/web` rebuilt the single-file
demo. Chromium captured dashboard, author and data-prep at 1440×1000 with all
external HTTP requests blocked. It recorded zero page errors, zero external
requests and no page-wide horizontal overflow. The footer still says
“OpenSight · Local rendering preview · visual fidelity not measured”.

The author image is pixel-identical to `docs/images/author.png`. Dashboard and
data-prep are pixel-identical to the H1 captures. Visual inspection against
`qs-author-light-flow.jpg` retains the Data → Visuals → sheet arrangement,
dark toolbar and docked panels. The reference has a populated sheet while the
capture shows the empty builder; this is a layout/regression check, not a
measured fidelity score. The prep page retains its hosted-API notices and disabled
server controls. No new visual defect was found. With no frontend UI changes,
the existing README images and hero GIF remain current.

Local evidence: `/tmp/h2-demo-build.log`, `/tmp/h2-browser/` and
`/tmp/h2-final-http-tests.log`. The static demo is not a deployed server.

## Final full verification

The final root `npm test` exited **0** with **1,425 passed / 0 failed / 0 skipped**.
It ran with `TZ=UTC` and the brief's `DATABASE_URL` pointing to the existing local
PostgreSQL database on port 5433. All live PostgreSQL checks ran. The final log is
`/tmp/h2-full-tests-final.log`.

| Runner | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 201 | 0 | 0 |
| Bundle parser | 197 | 0 | 0 |
| Embedding SDK | 4 | 0 | 0 |
| O interpreter | 32 | 0 | 0 |
| Query engine | 511 | 0 | 0 |
| Web | 477 | 0 | 0 |
| Root conformance | 3 | 0 | 0 |
| **Total** | **1,425** | **0** | **0** |

The API count includes 23 H2 checks: 5 credential/configuration/schema tests,
8 enrollment/session/provisioning tests, 9 hosted HTTP/CLI tests, and 1 live
PostgreSQL test. Strict TypeScript and public-package type checks ran as part
of the root suite. `git diff --check` passes. No new dependencies were added;
`SOLUTION_DESIGN.md`, `docs/hosted-architecture.md`, and `package-lock.json`
remain unchanged from the branch base. Implementation and verification are
checkpointed on the requested branch.
