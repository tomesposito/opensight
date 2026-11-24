# Phase 5 dependency refresh

The November 2026 maintenance integration merges dependency PRs #201, #202,
#203, #208, #289, #291, #292, and #293 with merge commits that preserve their
original heads. Application contracts and storage schemas are unchanged.

The GitHub checkout, artifact upload/download, and provenance actions remain
pinned to immutable commits. Checkout still disables credential persistence;
artifact downloads retain digest enforcement. Existing workflow inputs and
the provenance bundle output are supported by the updated actions.

The esbuild 0.28.2 lockfile is regenerated from the exact workspace manifest.
React, React DOM, and the test renderer are aligned at 19.3.1 to satisfy their
exact-version runtime checks. Grid layout advances to 2.3.0 while retaining
the current editor layout and API usage.

js-yaml 5.5.0 is used only by OpenAPI generation and tests. Its argparse
dependency is development-only and is not shipped in the runtime or MCP
bundle. The updated direct packages and actions use MIT licenses. The MCP
build continues to audit the actual code included in its bundles and rejects
licenses outside MIT/Apache-2.0.

Validation requires a clean dependency install, the full root test suite,
the Python SDK suite, the demo build and browser comparison, and the combined
GitHub build, audit, packaging, and provenance checks. No AWS configuration,
billing mode, or mail sandbox setting is changed by these merges.
