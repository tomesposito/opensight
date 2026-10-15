---
status: ✅ Confirmed (product owner, 2026-10-14)
owner: Tom Esposito
date: 2026-10-14
labels: [idd]
---

## Purpose

Resolve the CLI's default output for headless v1.

## Scope

What `opensight` prints on success and on error, and how a caller
changes it. Output contract only — wire shapes are frozen.

## Out of Scope

Subcommand vocabulary (D-71), credential carriage (D-73), packaging
(D-74), generation (D-75).

### ✅ IDD D-72 — What should the CLI print by default?

#### CONTEXT

#95's principles put "machine-readable first" at the top of the
headless vision, and the CLI serves agents as much as humans
("scripts and humans who live in terminals", D-37). The v1 REST
contract already returns stable machine shapes (stable result rows,
named `errorCode` errors); the question is only what the CLI renders
when nobody asks.

#### THE PROBLEM

A human default (tables, spinners, prose) makes piping fragile for
agents and scripts; a machine default (JSON) makes humans reach for
`jq`. The choice sets the CLI's primary audience and decides whether
error output is parseable by construction.

#### OPTIONS CONSIDERED

1. **JSON default; `--format` flag for the rest.** Every command
   prints the API response JSON by default (errors included:
   `{"errorCode": "...", ...}` on stderr, non-zero exit). `--format
   table` renders key resources as human tables; `--format yaml` for
   config-shaped output. Predictable for agents; humans opt in.
2. **Human-table default; `--format json` for machines.** The
   friendlier terminal experience out of the box, matching how most
   CLIs feel. Agents must remember the flag every call — one missed
   flag breaks a pipeline.
3. **JSON always, no human rendering.** The CLI is a pure
   machine front door; humans use the SDK or the web app. Cheapest
   to build, but abandons the "humans who live in terminals" half
   of D-37.

#### RECOMMENDATION

Option 1. The headless vision's primary customer is the agent; the
default must serve it without flags. Table rendering stays, but as
an explicit choice, and the flag applies uniformly to every command.

#### IMPLICATIONS

- Errors are structured on stderr with a non-zero exit in every
  format — scripts can branch on `errorCode` without parsing prose.
- `--format` is a global flag, not per-command; table renderers
  exist only for list/describe-shaped commands in this slice.

Related: [#95](https://github.com/tomesposito/opensight/issues/95), [D-37](D-37-headless-first-api.md)
