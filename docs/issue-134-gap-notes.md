# Issue #134: marketing site AEO readiness

The marketing site now includes crawler rules (including an explicit
`meta-webindexer` allow), a three-entry public sitemap, Open Graph and Twitter
large-image metadata, the exact approved question and comparison paragraph as
the first content section after the hero, and an October 2026 footer date.
The new content reuses the existing section, typography and footer styles;
no CSS, existing marketing wording, CTAs or dependencies changed.

## Offline link review

All five fragment links target existing IDs. All ten local references checked
by `site/check.mjs` exist, as does the hero poster. The four `demo/` links are
deploy-time entry points: no `site/demo/` exists in this checkout, so their
live destination is unverified.

The ten external links use these five unique destinations, inspected for HTTPS,
host and path correctness without network access:

- `https://github.com/tomesposito/opensight`
- `https://github.com/tomesposito/opensight/tree/master/docs`
- `https://github.com/tomesposito/opensight/blob/master/LICENSE`
- `https://github.com/tomesposito/opensight/issues`
- `https://app.getopensight.org`

The repository's `master` contains `docs` and `LICENSE`. External availability
and the absolute social-image/sitemap URLs remain unverified; offline checks do
not establish that any hosted resource resolves.

## Verification

`site/check.mjs` checks the new artifacts, exact approved copy and placement,
metadata values, freshness line and internal anchors, alongside the existing
checks. URL parsing also prevents a similarly prefixed GitHub repository from
passing the allowlist. A temporary-copy exercise accepted the baseline and
rejected all 19 negative cases, including missing files, changed copy, bad
metadata, wrong section order, broken anchors and malformed external URLs.
The heading (53 characters) and body (428 characters) were independently
compared with the approved brief character for character.

CI invokes the checker in its marketing artifact job. Root `npm test` does
not include it; the suite wiring remains unchanged and both run separately.
The negative-case script is `/tmp/opensight-issue-134/check-negative.mjs`.

## Visual review

Chromium captured the question section and footer at 1440px and 390px widths.
Text wraps within the existing layout; neither viewport has horizontal
overflow. There were zero page errors and zero HTTP/HTTPS requests, with
network requests blocked. Compared with the pre-change page, hero pixels are
unchanged after masking the dynamic video and excluding the final raster row
that includes the following section's background. The new section and footer
were visually reviewed; no new layout gap was found.

Rebuilt `packages/web/dist/opensight-demo.html` from source: 794 modules,
2,229,940 bytes, build exit 0. The 1440×900 author capture has zero page errors
and zero HTTP/HTTPS requests. Compared with the local
`qs-2026/qs-autograph-empty.jpg` reference, Data → Visuals → sheet ordering
remains consistent. Existing differences remain: roomier controls, offline
notices, the dotted canvas and the visible Properties dock. QuickSight visual
fidelity remains unmeasured. This is a local static demo, not a deployment.
The product UI depicted in the README tour and feature images is unchanged.
Captures and scripts are under `/tmp/opensight-issue-134/`; the demo build log
is `/tmp/issue-134-demo-build.log`.

## Publishing follow-up

This brief authorizes repository site work only; publishing belongs to Tom.
The current `ops/serverless/frontend-policy.mjs` marketing file list does not
include `robots.txt` or `sitemap.xml`, and `ops/serverless/edge-static.js` does
not route those paths. Publishing through that existing pipeline will require
a separately scoped packaging/routing update before the new discovery files
can be served. Neither hosting code nor deployment was changed here.
