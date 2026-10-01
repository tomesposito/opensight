# Issue #30: Run it verification

The README now leads with [Run it](../README.md#run-it), ahead of features and
the contributor quickstart. The [first-run](first-run.md) and
[local-data](local-data.md) guides describe the same two-terminal local flow,
sample Home, CSV preparation, live chart, and device-local draft behavior.
The static demo remains a separate no-backend preview.

## Fresh-build failure and fix

On 2026-10-01, a tracked-file export of `87efc191` into a new temporary directory
had no `node_modules`, compiled output, generated web fixtures, `.env` files or
saved pipelines. With Node 24.20.0 and npm 10.9.4, `npm ci` passed (91 packages).
`npm run build --workspace @opensight/api` then failed with TS2307:
`packages/web/src/api-client.ts` could not resolve `@opensight/o-interpreter`.

The API build compiled the web compiler before building the interpreter it
imports. Building the interpreter first fixes that dependency order, including
the root contributor build, which starts with the API workspace. No application
behavior, dependency, screenshot, README GIF, or `SOLUTION_DESIGN.md` change is
needed.

Verification continues from another clean tracked-file export with this fix.
Raw command output is kept in ignored `.opensight/issue-30/`.
