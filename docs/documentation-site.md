# Documentation site (#185)

The public documentation is rendered from repository Markdown into static HTML
under `site/docs/`. The generated HTML is committed alongside its sources so the
static site can be published without a runtime renderer. No dependencies,
external assets, scripts or webfonts are added to the documentation pages.

From the repository root, regenerate with:

```sh
node site/build-docs.mjs
```

The script exports a manifest of source paths, slugs and navigation titles.
Each source's H1 supplies its page title; its first paragraph supplies the index
summary and a shortened meta description. Links to manifest pages become site
links; other repository links point to GitHub's `master` files, retaining anchors.
The header brand and footer come from `site/index.html`. The stylesheet at
`site/docs/docs.css` is hand-written and is not overwritten by generation.

## Verification

```sh
node --test site/build-docs.test.mjs
node site/check.mjs
npm test
```

The renderer tests cover Markdown features, escaping, link rewriting, repeated
generation and source changes. The freshness test compares every committed HTML
file byte-for-byte with a fresh in-memory render of the current sources and site
chrome. It fails on stale or obsolete pages. Root `npm test` includes these tests
in its existing Node conformance invocation. To see individual cases without
Node's test-file process isolation, run:

```sh
node --test --test-isolation=none site/build-docs.test.mjs
```

`node site/check.mjs` also checks freshness, required docs files, sitemap entries,
canonical URLs, local references, indexability and the absence of external asset
loads. It does not verify live hosting. Re-running the generator without changing
its inputs produces identical bytes; it includes no timestamps.

## Adding a page

1. Write or update the source under `docs/`, describing shipped behavior. Include
   an H1 and an introductory paragraph. The renderer supports ATX headings,
   paragraphs, nested ordered/unordered lists, fenced and inline code, emphasis,
   blockquotes, tables, horizontal rules and inline links. Raw HTML is escaped.
2. Extend `manifest` in `site/build-docs.mjs` with the source, slug and nav title.
3. Add `https://getopensight.org/docs/<slug>/` to `site/sitemap.xml`.
4. Run the generator and verification commands. Commit the source, manifest,
   sitemap and generated HTML together. When removing a page, remove its old
   generated directory as well.

## Publishing boundary

The committed `site/docs/index.html` and `site/docs/<slug>/index.html` files are
the static deliverable. Deployments must serve these directory indexes and
`site/docs/docs.css` on the marketing host. The bounded frontend inventory and
`ops/serverless/edge-static.js` explicitly include these pages and stylesheet.
Adding a documentation page also requires adding its packaged path and edge
route. Deployment acceptance checks the signed archive and live response bytes;
committing generated HTML alone does not establish a live HTTP 200 response.
