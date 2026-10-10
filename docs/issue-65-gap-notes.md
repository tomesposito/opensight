# Issue #65 — File menu visual verification

Compared the rebuilt local static demo with the supplied File-menu reference
from the local reference set. The reference was viewed locally and was not copied
into the repository. File retains the #60 item order, separators, navy/blue
chrome, Arial system fonts and compact controls. Favorites switches to Remove
from Favorites when marked. Save as Analysis and PDF use accessible modal dialogs;
Share remains reachable with its explanation on focus and hover.

The menu remains wider than the reference and lacks its small item icons, as
recorded in #60. Native browser PDF output is explicitly explained before opening
printing. Share names the hosted integration limit instead of offering a fake
link. No new unresolved visual defect was identified. Visual fidelity has not
been measured; the demo disclosure remains unchanged. No new GitHub issue or
phase-plan edit was needed under the offline/no-spec-edit brief.

The capture workflow adapts the supplied `readme-gif.mjs` and its ffmpeg palette
and assembly commands. Run `node packages/web/scripts/capture-file-menu.mjs`
against a freshly rebuilt `packages/web/dist/opensight-demo.html`. The browser
blocks all HTTP(S) requests. Captures, native PDF output, frames and logs stay in
ignored `.opensight/issue-65/`; only the selected sanitized feature images and
assembled hero GIF are copied into `docs/images/`.

The browser tour passed 24 recorded checks with zero page errors and zero
external HTTP requests. It covers favorite persistence/removal/filtering, copy
identity and original preservation, cancellation/reload, Share focus/hover,
outside-click/Escape behavior, real native print calls, browser PDF rendering,
PDF cancellation and command-palette callbacks. File and both dialogs fit at
1440, 760 and 390px in light and dark themes.

The browser-generated PDF is one A4 landscape page containing the current sheet's
chart and offline-data disclosure. Its extracted text contains no editor actions.
The root Chromium tests additionally exercise changed control values, scrolled
tables, isolated SVG fragments, failed printing and snapshot cleanup.

README media: 88 frames, 960×600, 10fps, 8.8 seconds. Refreshed the hero GIF,
Author, command palette, My analyses and Local drafts images; added the File menu
image. The screenshots depict a local static demo, not a deployed server.
