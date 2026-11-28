# Issue #339 embed appearance verification

The offline preview renders the same loading, empty, permission-error and
expiry states for each brand. The Cedar fixtures use cream and charcoal
surfaces, Georgia text, a warm accent, compact spacing and a 10-pixel corner
radius. In both captures, the permission message and both footer notices
remain visible. [Light host](images/embed-tokens-light.png) · [Dark host](images/embed-tokens-dark.png)

The default and Atlas captures were compared with the previous preview images.
The host toolbar gained a context selector. The four embedded frames retain
their previous layout, white surface, preset accents and status messages.
The capture harness checked computed styles, notices and overflow, wrote
14 images and recorded zero external requests and zero page errors.

In a separate loopback test, the product backend issued a FullApp session for
a published dashboard after an administrator saved Cedar tokens. Chromium
checked the header accent, the card's surface, text, font and radius, and the
SVG fill on the KPI value of 60. The account menu remained hidden under the
issued surface declaration. [Hosted fixture capture](images/embed-tokens-dashboard.png)

The README storyboard ran against the rebuilt single-file demo, from the
synthetic sales dashboard through Ask O, data preparation and the connector
gallery. Its 21 frames rendered without page errors. The opening frame retains
the reference dashboard's navigation rail, chart grid and total revenue of 500.
QuickSight visual fidelity remains unmeasured.

To reproduce the browser checks after building the demo and API, run
`node packages/web/scripts/capture-embed-preview.mjs` and
`node packages/api/scripts/verify-full-app-browser.mjs`. Both accept
`OPENSIGHT_CHROMIUM` for an installed executable and
`OPENSIGHT_SCREENSHOT_OUTPUT` for the image directory.
