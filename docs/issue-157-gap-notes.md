# Issue #157 verification and visual comparison

The implementation follows the decided run brief: definitions belong to one
workspace and one exact dataset reference, editors draft, dataset owners and
administrators publish, and consumers resolve the latest published version.
[Governed metrics](governed-metrics.md) documents the API, rights, history,
execution semantics, join restrictions and the promotion boundary for #160.

## Browser acceptance

`packages/web/scripts/verify-governed-metrics.mjs` drives Chromium against the
real local API and Vite, with external HTTP requests blocked. It uploads a
three-row synthetic CSV, saves a prepared dataset, authors `{amount} * 2`,
saves a draft, publishes version 2, opens history and assigns the metric in
Author. Both Author and Ask O (`turnover by team`) return North **$12.00** and
South **$6.00**. Ask O reports the governed name, synonym and published version.
The run made four dataset queries with zero page errors or external requests.
API responses and chart rows are not mocked.

The form was captured at 1440×1100 and 390×844. The rebuilt file demo was
captured at 1440×1000 and 390×844. These checks found no document horizontal
overflow. The mobile form scrolls vertically; the static Metrics tab explicitly
says it needs a local or hosted API and contains no staged metric definitions.
The capture workspace and persisted assets now live entirely in a disposable
temporary directory. Reboot debris under `fixtures` was removed.

Screenshot review found that Author's measure chip and picker exposed the
reserved metric reference. The chip, picker and measure-order controls now
show the current metric name, and the chip shows its default aggregation.
Stable IDs remain in assignments. A root-suite regression test covers name and
aggregation changes after refreshing the published catalog.

## Visual comparison and README

Compared the new captures with the local references `qs-data-landing.jpg`,
`qs-author-light-flow.jpg`, `qs-q-generative.jpg`, and the previous README Data
landing screenshot. Data retains its navigation rail, tabbed content card,
search/filter row and honest empty state. Metrics adds a fourth landing tab
and a dataset detail tab. Author retains Data → Visuals/field wells → sheet;
the governed group sits alongside dataset columns. Ask O retains its right
dock and interpretation → preview → add flow, with metric grounding above
the preview.

The new form follows the existing dialog and calculated-field reference
patterns. There is no supplied QuickSight governed-metric form reference, so
this comparison does not establish feature-specific visual parity. Existing
differences in branding, notices, canvas density and properties docking remain.
No unresolved issue-specific visual regression was found; visual fidelity
remains unmeasured.

The README Data landing screenshot and new metric-form screenshot were captured
from the rebuilt demo and real local API respectively. The hero tour uses the
maintained `capture-readme-tour.mjs` adaptation of
`~/workspace/tools/screenshots/readme-gif.mjs`, including the offline Metrics
requirement. Its 253 frames are assembled at 960×600 and 10fps using the
documented ffmpeg palette workflow. Capture asserts zero browser errors and
external requests. The static demo is a local rendering preview, not a deployed
server.

The rebooted VM's Chromium requires its existing image-owned WebGL policy.
Capture and browser tests use `OPENSIGHT_CHROMIUM` with a temporary launcher
that supplies that unchanged policy and its SHA-256. No browser policy or
machine configuration is changed or committed.

## Checks and follow-ups

The API and static-demo builds pass. Both generated edge copies match the
shared ingress route contract; the edge suite passes **6 / 0 failed / 0 skipped**,
including the new metric paths and malformed-identifier rejection. The focused
metric/field-well run passes **32 / 0 failed / 0 skipped**. The full
root suite is run after the item 6 checkpoint; its exact totals and all six
checkpoint SHAs are reported in the final run report.

Browser evidence is in `/tmp/issue157-captures/`; build, browser and test logs
use `/tmp/issue157-*.log`. These are local verification artifacts, not product
fixtures. No new dependency is required.

There are no open product questions. Join cardinality remains deliberately
unproven: joined datasets fail with `METRIC_UNSAFE_FANOUT`, including joins
inside referenced prepared datasets. Any future relaxation needs cardinality
metadata and validation. Promotion remains issue #160. No GitHub issue was
filed because the observed issue-specific display defect was fixed locally.
