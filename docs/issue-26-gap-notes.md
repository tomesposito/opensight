# H6 (#26): verification and visual review

Branch: `work/issue-26-h6-embed-sessions`. The run brief and recorded
HQ-5/HQ-6/HQ-7/HQ-12 decisions govern this implementation, including anonymous
embedding and registered authoring. `SOLUTION_DESIGN.md` and dependencies are
unchanged. No AWS, remote service, deployment, merge, push or issue closure was
performed. [Session contracts and limits](embed-sessions.md) describe the result.

## Coverage

The root suite includes H6 lifecycle, HTTP, query security, Postgres, SDK and frame
transport tests. Cases include atomic replay/race/restart, wrong scope/origin,
expiry, revoked grants, renewal races, retired keys, stale config/policy,
suspension, membership changes, cross-tenant handles, viewer and anonymous
RLS/CLS, protected source traversal, dataset/source policy intersection,
revocation during async work, author permissions and save/version checks.
Independent Postgres pools prove single redemption and cross-instance invalidation.
Existing v1 and H5 tests remain in the full suite.

The real Chromium harness uses local HTTPS sites for parent and iframe, the actual
hosted API and verifier, live PostgreSQL metadata, encrypted synthetic uploads and
contained query workers. It uses temporary local TLS material and a fresh profile;
it is not a deployed server. Chromium's local address-space override permits the
two loopback listeners; CSP, distinct origins, sandboxing and cookie blocking stay
in force. A `SameSite=None; Secure` cookie write/read probe proves third-party
cookies are actually blocked rather than relying only on a launch flag.

Measured browser checks:

- Registered viewer RLS renders 40; anonymous session tags render 20; issuer-owned
  source rows would total 60. CLS hides the protected field from the Q schema.
- Dashboard, selected visual, Q query, empty state and authoring render real API
  content. The editor saves an actual versioned analysis and clears the session
  after that authorization revision changes.
- Two frames racing the same bootstrap produce one ready frame and one rejection.
  A subsequent replay is rejected. Actual forged `postMessage` calls from the
  parent, a sibling at the embed origin, and an obsolete channel are ignored.
- Explicit revocation removes protected content in 17,248 ms; expiry,
  tenant suspension and key retirement also clear the frame. Retired keys reject
  unspent bootstraps. Resuming a tenant does not restore a cleared credential.
- Frame credentials never appear in parent events/DOM, browser console/errors,
  cookie jars or web storage. The bootstrap fragment is removed after load.
- The v1 signed visual still renders its separate viewer-RLS total of 500.

Browser verification found two integration issues and drove fixes: initialization
could precede React's message listener, so the SDK retries the same handshake
until acknowledgment; the sandbox blocks native form submission, so Q uses an
explicit button/Enter handler while retaining the restrictive sandbox. A unit
regression covers the late-listener handshake. No authentication or origin check
was relaxed to make the application pass.

The first full run caught a strict-policy projection error in the new dataset/source
intersection test: H1’s `datasetId` metadata field was reaching the query policy
validator. The projection now excludes that metadata-only field; the regression
checks intersection before aggregation.

A subsequent full run exposed an existing live-Postgres test race: local socket
closure can precede removal from `pg_stat_activity`. The test now waits for both
cancelled connections to disappear within its original 1,500 ms deadline, while
still requiring zero published rows. All three live cancellation tests pass.

## Visual review and README

The main static demo was rebuilt and captured at 1440×1000. It recorded zero page
errors, zero external HTTP requests and no horizontal overflow. Comparison with
`docs/images/author.png` and the supplied `qs-author-light-flow.jpg` retains the
Data → Visuals → sheet flow, docked properties, toolbar and honest offline notices.
The empty draft in this capture differs from the populated reference state;
main-builder behavior did not change. Visual fidelity remains unmeasured.

New session screenshots cover registered/anonymous/visual/Q/empty/authoring/saved/
revoked/expired/v1 views. Appearance, retained notices, permission messages and
cleared data are visible. The embedded editor keeps controls left and its sheet
area dominant; it does not claim full QuickSight console or Q-language parity.
Supported scope is documented explicitly. No new regression in existing user
surfaces was identified and no external issue was filed under the no-network
instruction.

The README includes a real synthetic [hosted-session screenshot](images/embed-session.png).
The [embedded editor capture](images/embed-author.png) includes its save controls
and retained notices. The tour GIF was
regenerated from the supplied `readme-gif.mjs` against the fresh local demo, using
the supplied ffmpeg palette/assembly commands. The script's retired source-picker
selector was adapted to the current hash routes. Unchanged feature screenshots
retain their matching UI. Static assets are not presented as a deployed service.

Local evidence from the resumed run: `/tmp/issue26-resume-full-tests-verified.log`,
`/tmp/issue26-resume-browser.log`, `/tmp/h6-embed-browser-resume/evidence.json`,
`/tmp/h6-embed-browser-resume/*.png`, `/tmp/issue26-resume-static/evidence.json`,
`/tmp/issue26-resume-static/author.png`, `/tmp/issue26-resume-demo-build.log`.
The checked-in browser harness reproduces the assertions without downloads.

## Full test run

The required command completed with exit status 0:

```sh
TZ=UTC DATABASE_URL=postgresql://postgres@localhost:5433/opensight npm test
```

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 277 | 0 | 0 |
| Bundle parser | 197 | 0 | 0 |
| Embedding SDK | 9 | 0 | 0 |
| O interpreter | 32 | 0 | 0 |
| Query engine | 514 | 0 | 0 |
| Web | 584 | 0 | 0 |
| Root conformance | 6 | 0 | 0 |
| **Total** | **1,619** | **0** | **0** |

No tests were cancelled or marked todo. Live Postgres tests ran rather than
skipping. The browser harness and demo rebuild also completed successfully; their
separate checks are not added to the root test tally.

## Verification after the VM reboot (2026-10-02)

Resumption found a clean branch at `e6edbf66`, with all eight implementation and
documentation checkpoints already committed. No completed checkpoint was redone.
The required root command completed again with exit status 0 and the exact tally
above. The real-stack browser harness also completed with exit status 0, including
the cookie-blocking probe, replay/race/forged-message checks, viewer and anonymous
RLS/CLS, author save, revocation, expiry, suspension, key retirement and v1 visual.
H5 configuration checks passed in the root suite.

An earlier resumed suite process exited with SIGTERM before finishing; the signal
sender was not identified. Another attempt exceeded the existing H4 three-second
worker-execution assertion (4.303 seconds) while unrelated host package setup was
running. Once that setup finished, all six containment tests passed unchanged;
the final full run measured 1.696 seconds for the same peak-execution assertion.
No test limits were relaxed. The interrupted attempts are not included in the
successful full-run tally.

The static demo was rebuilt and captured again: zero page errors, zero external
HTTP requests and no horizontal overflow. Its comparison with the existing author
and QuickSight references reproduced the visual findings above. The registered
embed capture is byte-for-byte identical to `docs/images/embed-session.png`.
The previously refreshed README screenshots and tour GIF remain current; no
application code, tests, dependencies or checked-in images changed during this
resumption. Only this verification record was updated.
