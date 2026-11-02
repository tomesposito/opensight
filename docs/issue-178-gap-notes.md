# Issue #178 visual and integration checks

Rebuilt `packages/web/dist/opensight-demo.html` and compared the Data landing
against the previous static demo, `docs/images/data-landing.png`, and the local
QuickSight reference `lookfeel-references/qs-2026/qs-data-landing.jpg`.
The new Ideas link follows the existing left navigation, with the same compact
Arial controls, navy header and blue selection. The Data tabs, table, primary
action and canvas layout retain their established structure. Ideas has no
QuickSight counterpart in the reference set; this review makes no visual-parity
claim. The static demo remains a fixture preview, not a deployed server.

The first screenshot review caught unstyled buttons in the Ideas view. The
member and operator views now reuse the Data-page control styles and compact
headings. Desktop (1440×1000) and mobile (390×844) checks found no horizontal
overflow. Long references wrap and only HTTP(S) references become links.
No remaining user-visible gap was found in this issue's review.

`packages/web/scripts/capture-ideas.mjs` exercises a real local hosted HTTP API
with synthetic members and suggestions: Data empty-state entry, submission with
its originating surface, status display, operator connection, review transition,
and decline controls. The offline demo check verifies the hosted-workspace notice
and absence of submission controls or Data suggestion actions. All checks passed
with zero external requests and zero browser page errors. Captures are in
`/tmp/issue-178-screenshots/`; the member and operator screenshots are also in
`docs/images/ideas.png` and `docs/images/operator-ideas.png`.

Refreshed the README tour using `capture-readme-tour.mjs` (the repository's
current adaptation of `~/workspace/tools/screenshots/readme-gif.mjs`) and its
ffmpeg palette/assembly commands: 253 frames, zero page errors. Refreshed the
main dashboard, Data landing, data-source dialog, Create Analysis and data-prep
screenshots against the rebuilt demo. Browser runs used the environment's
configured Chromium wrapper and blocked external traffic.

API coverage includes the complete transition matrix, missing reasons and
references, validation limits, durable rate buckets, invocation mode without
DDL, unauthenticated/local failures, cross-user/cross-tenant read and transition
attempts, forged identity/version fields, filter validation and operator origin
checks. Backup/restore tests cover pre-Ideas inventories, and tenant deletion
proves that other tenants' suggestions survive. Web interaction coverage checks
submission success/failure, duplicate clicks, stale responses after identity
changes, status/reason/reference rendering, local/demo restrictions, and the
operator filters and review controls.
