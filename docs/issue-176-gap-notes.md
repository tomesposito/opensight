# Issue #176 visual and integration checks

Compared local marketing-page captures at 1440px and 390px against captures of
the same page from `master`. The new section uses the existing navy, blue, muted
text, pale section background, rounded white panels, and font fallbacks. The
desktop form sits beside its introduction; the phone layout stacks them with
visible labels and full-width controls. The added nav link remains visible on
phones, where the nav wraps to two rows.

The first screenshot review found that the new hero CTA wrapped below the demo
button at desktop width. Reducing the hero buttons' horizontal padding keeps
those two actions beside each other. The existing GitHub action wraps below
them. Anchor scrolling leaves the heading visible below the sticky mobile nav.
No further user-visible gaps were found in this review.

Offline Chromium checks covered widths 320, 390, 768, 1024, and 1440, pending
submission, exact JSON payloads, omitted empty optionals, 201 reset/confirmation,
and 200/400/429/500/network failures retaining the input. All 14 checks passed.
The endpoint was intercepted; no real access requests were submitted. Local
capture artifacts are in `/tmp/issue-176-screenshots/` for this review.

The marketing page has no QuickSight reference counterpart. Product editor
styles, demo interactions, README tour footage, and feature screenshots are
unchanged by this issue. This review makes no new visual-parity claim.

Rebuilt `packages/web/dist/opensight-demo.html` with
`node packages/web/scripts/build-demo.mjs`. The Renderable Sales dashboard at
1280×800 matched the previous local demo capture pixel for pixel, with no browser
errors. The rebuilt artifact remains a static fixture demo.

Integration coverage exercises real hosted HTTP routes plus the public
serverless ingress and invocation bridge. The generated edge artifact recognizes
the specified marketing URL, while neighboring routes retain their origin and
operator restrictions. The access-request table participates in owner migrations,
operator-only runtime grants, and versioned backup/restore inventories. Older
backups migrate and restore without inventing access requests.
