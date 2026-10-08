---
status: ✅ Confirmed
owner: OpenSight implementation
date: 2026-10-08
labels: [itd]
---

## Purpose

Record the implementation choice for real paginated PDF export in Phase 4 slice 1.

## Scope

PDF generation, shared preview geometry and dependency selection.

## Out of Scope

Product priorities, hosted storage, visual snapshots and scheduled distribution.

### ✅ ITD D-18 — How should slice 1 render the same report locally and in the API?

#### CONTEXT

The authorized slice requires a pure page layout engine and real PDF output,
including in the offline single-file demo. Report content is limited to text and
tables with supplied rows. The repository accepts MIT/Apache-2.0 dependencies.
Installed jsPDF 2.5.2 metadata reports MIT and its required dependency tree has
MIT/Apache options; newer inspected jsPDF 4.2.0 introduces fast-png and pako,
whose package metadata declares MIT AND Zlib.

#### THE PROBLEM

Which rendering approach can share explicit page geometry across API and offline
preview while keeping this slice's dependency tree within the repository policy?

#### OPTIONS CONSIDERED

1. Headless-browser HTML printing on the server.
2. ✅ **A shared positioned display list rendered with pinned jsPDF 2.5.2.**
3. A separate PDFKit server renderer and independent browser preview.

#### REASONING

Option 1 adds a browser runtime to export and cannot provide the required pure
local browser generator. Print pagination would also become a second layout engine.

Option 2 consumes millimetre-positioned text/rectangle items from the same pure
engine used by SVG preview. It runs in Node and the browser and produces
extractable text, repeated headers and final page numbers without network calls.
The selected version is pinned for its compatible dependency tree. The wrapper
exposes only bounded text and rectangles with fixed built-in fonts: no HTML,
image, link, action, metadata-string or uploaded-font APIs. Definition and display
list validation precede rendering. This deliberately narrow use of an older
release must be reviewed before expanding supported PDF operations or upgrading
dependencies; it is not a blanket endorsement of the library's other APIs.

Option 3 supports server text rendering, but this slice needs offline browser
export too. Separate renderers increase geometry and bundling maintenance without
adding required functionality.

#### IMPLICATIONS

Preview and export share layout decisions. Approximate text measurement and
printable Latin-1/Courier support are explicit limits, not fidelity claims.
The report date is caller-supplied and PDF metadata/IDs are deterministic.
Poppler extraction tests independently verify pages, headers and content.
Future image/font support must revisit the dependency and input-safety boundary;
it cannot simply expose additional jsPDF APIs. Dataset security remains upstream
of the supplied-row seam and is not inferred from report field references.
