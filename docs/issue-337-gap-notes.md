# Issue #337 embed surface verification

The same registered author mounted the dashboard collection with authoring
hidden, disabled and visible through one tenant configuration. The real v2 SDK
passed each declaration to the product-backend fixture at issuance. The browser
checked the Analyses link's absence, disabled state and enabled state, and the
absence of the requested account menu, inside the hosted frame.

The [scoped dashboard capture](images/embed-surface-hidden.png) retains the
dashboard list and product navigation. Compared with the unrestricted view,
the Analyses entry and account disclosure are gone. The [full-app editor
capture](images/embed-full-app.png) shows the editor after two saves. Both
captures use synthetic data and the loopback API. The harness also exercised
all six landing route classes and same-session navigation to Data. All eleven
browser checks passed with external requests blocked.

The rebuilt static demo and the dashboard reference retain the same rail,
chart grid, sample total of 500 and fixed-data notice. The README tour was
recaptured at 1280×800 using the existing storyboard and rebuilt single-file
demo. The capture produced 26 frames and reported zero page errors. These
screenshots record a structural comparison. QuickSight fidelity is unmeasured.

Root-wired tests cover closed tenant allowlists, preservation on legacy config
writes, per-mount SDK refresh and acknowledgment, historical session grants,
revocation and shell rendering. A direct scoped HTTP write with hidden
authoring succeeds for an authorized author. The same write returns
`EMBED_AUTHOR_REQUIRED` for a reader. Queries and writes keep using the
existing authorized handlers.

Run the local browser harness after building the API and SDK:

```sh
node packages/api/scripts/verify-full-app-browser.mjs
```

Set `OPENSIGHT_CHROMIUM` to an installed browser executable and
`OPENSIGHT_SCREENSHOT_OUTPUT` to select the output directory.
