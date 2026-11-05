# Issue #190 — hosted Ask O visual review

The demo was rebuilt after the web changes. The README hero was regenerated
with `packages/web/scripts/capture-readme-tour.mjs`, the maintained repository
adaptation of `~/workspace/tools/screenshots/readme-gif.mjs`, and its ffmpeg
palette/assembly commands. The capture produced 253 frames with no browser errors
or external requests. The author frame preserves the Data → Visuals/field wells
→ sheet flow in `lookfeel-references/qs-author-light-flow.jpg`. The static demo
continues to identify its fixture data and local rendering; it is not a deployed
hosted server. Visual fidelity is not measured.

Hosted captures use J4's synthetic PostgreSQL fixtures and deterministic
test-only provider, using actual API routes and the shared chart compiler:

- [Managed answer](images/ask-o-managed.png): a grounded revenue-by-region
  interpretation, a populated result visual and 9 of 10 credits remaining.
- [Exhausted credits](images/ask-o-credit-limit.png): the switch is off and
  disabled, the balance is zero, the reset date is stated, and a standard
  interpreter answer still renders.
- [Admin settings](images/ai-provider-settings.png): managed, BYO and off choices,
  provider/model fields, an empty write-only key field and connection testing.
  A focused settings capture also verified that the managed connection test
  succeeds without consuming a credit and that the selected mode is outlined.

Comparison with approved mockups `a-panel-generative`, `b-panel-credit-limit`
and `c-admin-ai-settings` confirms the required mode copy, grounding, credit
balance, exhausted-state explanation and admin choices. Fixture figures replace
the mockups' illustrative 500-credit plan and sales totals. Existing O grammar
controls, chart rendering and navigation remain in place. Dashboard access does
not grant build capability, so the Reader AI capture has no Add to analysis
action. The panel narrows the dashboard without overlap; at 900px its cards stack.

No new blocking visual gap was found for the requested states. The existing
editor and navigation differ from the illustrative mockups; this slice does not
claim pixel parity or add unrelated layout changes.
