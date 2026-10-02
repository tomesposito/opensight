# Issue #36: H7 tenant automation

Implemented on `work/issue-36-h7-job-ownership`, following the run brief and
final HQ-13 transfer-or-stop decision. The implementation contract was committed
in [tenant-automation.md](tenant-automation.md) before scheduler changes.
`SOLUTION_DESIGN.md` is unchanged. No dependencies or AWS integration were added.

## Changes and failure gates

- Private, tenant/namespace-scoped job, occurrence and delivery tables work with
  SQLite and PostgreSQL. One scheduler coalesces missed occurrences and manual
  requests. Refresh intervals resume from completion. Prepared Blaze intervals
  now commit their execution setting and durable owner schedule together.
- Offline migration resolves default refresh/alert owners, recorded report
  owners and recipient emails to active tenant memberships. It retains H1
  evidence, imports terminal histories without replaying mail, and rolls back
  interrupted writes. Unresolved identities and recipients deny activation.
- User removal previews owned schedules and eligible replacement users.
  Transfer/stop, membership removal and cancellation of unfinished work commit
  together. A changed preview is refused. Private source/prepared ownership is
  never implicitly transferred, and a replacement must have target access.
- Reports and alerts use the existing scoped dataset reader, RLS/CLS, asset and
  folder grants and contained query workers. They render separately as each
  recipient. Current permissions are checked while queued, running, publishing,
  rendering and sending. Removed owners stop; removed recipients cannot receive
  pending mail.
- Durable outbox retries retain a recipient dedupe key and stable SMTP
  Message-ID. Tests interrupt transport responses and receipt commits after
  acceptance; the deduplicating stub sends once. SMTP itself remains at least
  once and may duplicate an ambiguously accepted message.

## Browser and visual evidence

`packages/web/scripts/verify-tenant-jobs.mjs` uses real PostgreSQL, built-in
password/MFA sessions, the hosted API, query workers and HTTPS Vite in Chromium.
Its temporary database schema, TLS material and synthetic identities are cleaned
up. The installed browser's loopback transport is forwarded through Node without
mocking requests, responses or query data. Mail is explicitly the stub transport.

The final run passed with **43 automation/operator browser requests, 0 page
errors, 0 external requests and 1 report email**:

- A real report runs from the browser; the recipient sees the RLS-filtered total
  **40**, while the owner can see **60**. The UI shows succeeded/sent history.
- A second tenant sees only its own recipients and no first-tenant jobs. A
  browser history request for the first tenant's job returns 404.
- Removal begins with neither choice selected. The browser transfers an author's
  report to an active replacement and verifies the persisted PostgreSQL owner.
  It then stops the replacement's schedules and verifies all jobs are stopped.

Compared the operator captures with `dyn-03-users.png` in the reference set:
the centered administration column, text scale and native controls are retained;
the new choice explicitly separates operator membership removal from tenant
administration. Tenant job tables use the existing navigation and content area.
All captured pages fit the checked 1440-pixel viewport without horizontal
overflow. No new visual defect was found; visual fidelity is not measured.

The demo was rebuilt. The tour uses `capture-readme-tour.mjs`, the existing
current-navigation adaptation of the required external `readme-gif.mjs`, with
HTTP(S) blocked. Its **82 frames, 0 page errors** were assembled using the
documented FFmpeg palette commands at 960×600, 10 fps. Inspected demo Author
retains the docked controls and navy toolbar. Refreshed the README GIF and added
`tenant-jobs.png` and `job-owner-removal.png`; existing feature images depict
unchanged surfaces. The demo remains a local static artifact.

## Verification record

Focused ownership/retry/migration/UI checks: **20 passed / 0 failed / 0 skipped**.
Real HTTP/PostgreSQL/rendering checks: **7 passed / 0 failed / 0 skipped**, including
percent-change periods and prepared interval scheduling. The final full suite
also includes the additional recipient-threshold privacy assertion.

The sandbox cannot expose the host worker PID namespace; real rendering correctly
refused there with `WORKER_CONTAINMENT_UNAVAILABLE`. A sandbox demo build was
terminated before completion. Both checks passed outside the sandbox. Initial
browser harness runs needed HTTPS and explicit DELETE body framing; these were
harness fixes, without weakening the hosted origin or authorization boundary.

Evidence is retained in ignored `.opensight/issue-36/` (browser captures,
`browser-final.log`, GIF frames and assembly).

## Final full-suite result

The exact repository-root command
`TZ=UTC DATABASE_URL=postgresql://postgres@localhost:5433/opensight npm test`
exited **0**: **1,655 passed / 0 failed / 0 skipped / 0 cancelled**. All live
PostgreSQL checks ran. Strict TypeScript checks and workspace builds passed.

| Runner | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 297 | 0 | 0 |
| Bundle parser | 197 | 0 | 0 |
| Embedding SDK | 9 | 0 | 0 |
| O interpreter | 32 | 0 | 0 |
| Query engine | 514 | 0 | 0 |
| Web | 588 | 0 | 0 |
| Root conformance | 6 | 0 | 0 |
| **Total** | **1,655** | **0** | **0** |

The complete run passed on its first attempt. Older H2/H3 assertions that
automation was unavailable were updated to the H7 durable status contract
before that run; unauthenticated and unsupported-route assertions remain.
`full-tests.log`, `full-tests.exit` and `test-summary.json` retain the result.
`git diff --check` is clean. Work is committed only on the requested branch;
no merge, push, public-history edit or issue closure was performed.
