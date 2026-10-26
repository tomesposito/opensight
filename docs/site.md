# Marketing site (`site/`)

One-page marketing site for **getopensight.org** (issue #93). Plain static
HTML/CSS/JS — no framework, no build step beyond copying assets, no external
requests. It deploys to the same S3 + CloudFront Tom already runs; no new
infrastructure.

## Page structure

1. Hero: value prop, subhead, two CTAs (Try the live demo → `demo/`, Star on
   GitHub), hero video of real product footage.
2. QuickSight alternative: the first H2 and comparison paragraph use Tom's
   exact wording approved on 2026-10-20 (#134).
3. Features strip: Blaze in-memory engine, visual data prep, embedding SDK.
4. Compatibility (supporting, not the lead): QuickSight-compatible as a proof
   point under the main vision.
5. Open source: Apache-2.0 (the repo's actual license — the issue text said
   "MIT", which was wrong), repo link, star CTA.
6. Getting started: clone/install/run, condensed from the README.
7. Footer: demo, GitHub, docs, discussion links and the October 2026 freshness
   line (#134).

## Discovery and sharing (#134)

`robots.txt` allows all crawlers, explicitly allows `meta-webindexer`, and
points at `https://getopensight.org/sitemap.xml`. The sitemap lists the
marketing page, `/demo/`, and `https://app.getopensight.org/`. Open Graph and
Twitter large-image cards reuse the page title, existing meta description,
and the absolute URL of `assets/hero-poster.jpg`.

Run `node site/check.mjs` separately from root `npm test`: CI invokes the
checker, but the root suite does not. Checks are offline; external URL
inspection cannot establish live availability. The demo entry point remains
a deploy-time artifact. Publishing and hosted routing remain operator work.

## Positioning (Tom's direction, 2026-10-12, from issue #93)

Lead with the vision — a **powerful open-source BI tool** — not the
compatibility footnote. Market toward where the product is going: present the
vision confidently, lead with strengths, no caveat-led copy. This is emphasis,
not fabrication: never claim a feature that doesn't exist. Tom used the term
"quicksight compatible" himself for the supporting role, so the marketing site
may name QuickSight there. The repo's standing no-name rule still applies to
the product UI itself.

## Hero video

Scripted Playwright screen recording of the static demo
(`packages/web/dist/opensight-demo.html`), real product footage with smooth
scripted interactions: dashboard → O asks "revenue by region" → data-prep
canvas → connector gallery. Capture with
`~/workspace/tools/screenshots/hero-video-93.mjs` (Playwright
`recordVideo`), then ffmpeg for fade in/out and the title card — no
AI-generated video, no fake UI. Fallback: the README tour GIF
(`site/assets/opensight-tour.gif`), shown automatically if the video sources
are missing.

Assets live in `site/assets/`: `hero.mp4`, `hero.webm`, `hero-poster.jpg`,
feature screenshots (copied from `docs/images/`), `favicon.svg`.

## `demo/` and the "Try the live demo" CTA

The CTA points at the relative path `demo/`, which is **populated at deploy
time, not committed**: the CI extension (below) builds the single-file offline
demo from source and copies it into the site artifact as `demo/index.html`.
The demo runs fully offline from one file (the same artifact the README tour
uses), so `getopensight.org/demo/` works with no backend.

## CI

`.github/workflows/ci.yml` gains a `site` job on master push: build the web
demo from source, copy `site/` + `demo/index.html` into a `site-dist/`
artifact, and validate the site with `site/check.mjs`. Deployment to
getopensight.org stays Tom's manual step — the workflow never touches
DNS/CloudFront. (Workflow files can't be published through the
public-scope Git Database API; the extension is committed on the branch and
handed to Tom for web-UI application — see the issue #93 thread.)

## Review gate (hard, from the issue)

Screenshots of every section and the hero video are posted in the OpenSight
side chat for Tom's review. Nothing deploys to getopensight.org and no
DNS/CloudFront change happens until he approves. Tom deploys.
