# Issue #95 assets — verification and demo comparison

The slice changes headless API and SDK behavior. It adds no visible web UI.
The static demo is rebuilt locally; it is not a deployed server. Capture and
comparison artifacts are kept outside version control under
`.opensight/issue-95-assets-impl/`.

## Verification

Full root `npm test` is run with the local Postgres service on port 5433.
Final full-suite counts are recorded after verification.
The final targeted analyses/assets/dashboard suite passed **54 / 0 / 0**.
The SDK/OpenAPI guard and transport tests passed **26 / 0 / 0**. The live
Postgres metadata run passed **3 / 0 / 0**, including asset transactions under
the restricted row-security role. OpenAPI has no duplicate keys or operation
IDs, and all local schema references resolve.

## Follow-ups

Search scope JSON and dataset-copy semantics remain unanswered in the confirmed
DECISION lines; see [slice documentation](headless-v1-assets.md#unanswered-details-and-deferred-work).
Serverless integration and asset MCP tools remain the explicit remote/later
handoffs. No GitHub publication or network issue filing is performed in this
build, consistent with the brief's no-network/no-push boundary.

## Static demo

Three offline captures are byte-identical to the previous dashboard-slice
baseline: classic Author, new-look Author and Home Q. The capture reports
**0 page errors / 0 external requests**. The reference comparisons retain the
same viewport, regions, exclusions and tolerance of 16:

| Reference pairing | Differing pixels |
| --- | ---: |
| Classic editor | 41.22% |
| New-look editor | 33.58% |
| Q generative | 44.66% |

These are pixel differences, not fidelity grades. Existing gaps remain in the
[dashboard notes](issue-95-dashboards-gap-notes.md); there is no new visible gap
to file. README screenshots and GIF remain current because this slice changes
no visible UI.
