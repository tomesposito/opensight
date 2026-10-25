# Changelog

All notable changes to OpenSight are recorded in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

No numbered release has been cut yet, so every shipped change so far sits
under Unreleased. When the first release is cut, the release flow moves the
Unreleased entries into a new version section (see AGENTS.md §1).

## [Unreleased]

### Added

- This changelog, with the update process documented in AGENTS.md (#116).
- Workspace display names and a login-screen workspace picker: operators set
  a display name and unique slug at provisioning, the name shows in the
  invitation, the picker, and the app header, and `tenant_id` stays internal
  and never needs to be typed or remembered (#146, D-83).
- Per-tenant AI spend caps, enforced against the tenant's usage meter (#114).
- Dependency audit gate: `npm run audit` fails on high/critical advisories,
  with the triage process documented in `docs/dependency-triage.md`
  (#111, automation groundwork; the Dependabot and CI files are an owner
  web-UI step and are still pending).
- New OpenSight brand identity — mark, lowercase wordmark, and brand-blue
  accents — across the app header and navigation, first-run, sign-in, the
  author topbar, the README, and the marketing site (#109).
- Headless API v1: the versioned API contract and surfaces for analyses,
  dashboards, datasets and sources, and querying, with a TypeScript SDK, a
  Python SDK, a CLI, and an MCP server (#95).
- Marketing site for getopensight.org: landing page, live-demo entry points,
  and the packaged apex/app routing (#93, #106).

### Changed

- The question side panel is branded "Ask O" (trigger mark "O", heading
  "ASK O") and docks into the layout — the shell reserves its width instead
  of the panel overlaying the canvas (#135, #136).
- Editor polish passes: an exhaustive interactive audit of the app
  (866 elements, 637 unique surfaces, light and dark) drove a long run of
  hover and paint fixes; the final re-audit came back empty and the polish
  bucket closed (#108).

### Fixed

- AI spend accounting: a charge now commits together with a durable warning
  intent, so an accounting or audit failure can no longer leave repeated
  provider calls unmetered past the tenant's cap; stranded warnings are
  retried and delivered exactly once after recovery (#138).
