# Issue #37: H8 operational reference

H8 adds backend/reference tooling and the
[operator runbook](hosted-operation.md). No web source or product UI string
changed. `SOLUTION_DESIGN.md` and the requested branch are unchanged.

The static demo was rebuilt with `npm run build:demo -w @opensight/web`.
Chromium opened the rebuilt `packages/web/dist/opensight-demo.html` from disk
with HTTP(S) blocked, captured Home and Author, and exercised the O query and
add-to-analysis path. Result: **0 page errors, 0 external requests, no horizontal
overflow** at a 1440-pixel viewport. Captures and the machine-readable result are
retained in ignored `.opensight/issue-37/browser/`.

Compared the Author capture with `docs/images/author.png` and the private
`lookfeel-references/dyn-05-author-o-bar.png`: the navy analysis header, menu/O
bar, Data → Visuals → sheet order, docked Properties and light theme are retained.
The older reference predates the current top-level navigation; the README image
shows the current navigation. The capture uses a collapsed chart data table and
a different viewport height, so this is a visual layout review, not a pixel-parity
measurement. No new visible defect was found. The footer still says visual
fidelity is not measured. README media was not regenerated because H8 changes
none of the displayed surfaces; it remains current with the H7 UI.

The demo is a local static artifact, not a deployed server. Native PostgreSQL
measurements and the unrun Docker gate are separated in the
[H8 verification record](h8-reference-verification.md). Docker is unavailable on
this VM; exact Compose images/TLS/cgroup and volume-loss evidence remain a pilot
gate. HQ-10 and HQ-14 still need Tom. No new visual issue was filed.
