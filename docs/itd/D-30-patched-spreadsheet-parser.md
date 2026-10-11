---
status: ✅ Confirmed
owner: Tom Esposito
date: 2026-10-10
labels: [itd]
---

## Purpose

Retain Excel uploads using a patched, license-compatible parser.

## Scope

Dependency acquisition for the authorized serverless deployment.

## Out of Scope

Changing accepted file sizes, executing spreadsheet formulas or enabling macros.

### ✅ ITD D-30 — Where should the patched spreadsheet parser come from?

#### CONTEXT

The query engine pins `xlsx` 0.18.5. The maintainer identifies prototype pollution
in releases through 0.19.2 and regular-expression denial of service through
0.20.1. The fixed distribution is on the maintainer's CDN rather than npm's
stale `xlsx` package. Its 0.20.3 archive declares Apache-2.0, contains the Apache
license text and declares no dependencies.

#### THE PROBLEM

How should this deployment receive the parser fixes while preserving the existing
Excel upload contract and dependency-license policy?

#### OPTIONS CONSIDERED

1. Keep the old npm release and depend on child-process containment.
2. ✅ **Pin the official 0.20.3 tarball with npm lockfile integrity.**
3. Replace the parser with another library and reimplement format compatibility.

#### REASONING

Option 2 uses the upstream fix and retains the existing API and accepted formats.
The downloaded archive's SHA-256 is
`8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8`.
Verify that archive and record npm's SHA-512 integrity; never resolve an unpinned
CDN path at runtime. The CDN is an additional build availability dependency.

Option 1 leaves known parser flaws even though H4 limits their impact. Option 3
adds format/semantic migration risk without a deployment benefit. No license
exception is required; the previously approved tslib exception remains separate.

#### IMPLICATIONS

Update only the query engine's existing parser dependency and necessary lockfile
entries. Verify transitive-license changes, preserve containment and rerun upload,
Excel export, malformed-file and full-suite tests. Do not suppress advisories or
claim the whole image has no vulnerabilities after this parser update. Review the
base-image findings separately before public promotion.

Sources: [official installation](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/),
[prototype-pollution advisory](https://cdn.sheetjs.com/advisories/CVE-2023-30533),
[ReDoS advisory](https://cdn.sheetjs.com/advisories/CVE-2024-22363).
