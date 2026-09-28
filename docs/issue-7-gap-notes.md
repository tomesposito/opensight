# Issue #7 part 2 UI verification

Reviewed the source app through a temporary loopback Vite/API server on
2026-09-28. Test identities and provider responses were synthetic; no provider
or AWS traffic was sent. This was a local browser review, not a deployment or a
static-demo rebuild. `packages/web/dist` remains intentionally stale until the
separate merge/rebuild step.

Compared 1440px builder captures with the existing `qs-author-light-flow.jpg`
and `qs-q-generative.jpg` reference set. Hiding O for plain authors preserves the
navy toolbar, Data → Visuals → sheet flow, and canvas space. AI authors retain the
established document-flow answer preview and explicit ADD TO ANALYSIS action.
The reference docks its question pane beside the sheet; the pre-existing
OpenSight document-flow layout is retained. Fidelity has not been measured.

Browser checks covered administrator provider/model/key saves, connection-test
feedback, the Bedrock approval-required state, invitation creation/acceptance,
all four non-admin roles, and generative answer previews on both builder and
published-dashboard surfaces. Reader AI has no ADD TO ANALYSIS action. Plain
readers/authors have no question bar. The 390px settings view had no horizontal
overflow. No JavaScript page errors or external HTTP requests were observed.

Review found and fixed two integration defects: API previews do not carry the
fixture metadata previously used to decide whether to render dashboard O, and
opening an invitation fragment in an already-open app needed a hash-change
listener. The dashboard uses its explicit published resource ID and has a
regression test. Invitation navigation was verified through the real browser.
Provider selectors received explicit accessible labels.

The existing definition explorer still displays pinned fixture results or a
named unavailable state for ordinary dashboard cards. O previews query the
hosted API under caller permissions. Its explanatory text now distinguishes
these paths. No new unresolved rendering defect was identified. The static demo
comparison remains part of the separately authorized merge/rebuild workflow.
