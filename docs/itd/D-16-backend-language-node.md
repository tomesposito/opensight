---
status: ✅ Confirmed
owner: Tom Esposito
date: 2026-10-07
labels: [itd]
---

## Purpose

Record the decision to stay on Node.js/TypeScript for the OpenSight
backend, rejecting a rewrite in Rust, so the question does not get
re-litigated without new evidence.

## Scope

The language and runtime of the OpenSight API server and all
server-side packages (API, query planning, auth, embed sessions, job
engine, bundle parsing).

## Out of Scope

The analytical execution engine (decided in HQ-11: DuckDB in-process).
The frontend language (TypeScript, unchanged). Future per-hot-spot
native modules, which remain allowed but unscheduled.

### ✅ ITD D-16 — Should the OpenSight backend move from Node.js/TypeScript to Rust?

#### CONTEXT

The backend is Node.js/TypeScript across all server packages. Rust was
proposed on its reputation for server-side performance. Tom has very
little Rust experience. The autonomous build loop (Codex, gpt-6-astra)
builds, tests, and verifies TypeScript slices end-to-end, currently
shipping roughly one slice per sweep window.

#### THE PROBLEM

Should the OpenSight backend move from Node.js/TypeScript to Rust?

#### OPTIONS CONSIDERED

1. ✅ **Stay on Node.js/TypeScript.** No rewrite; Rust remains an option only as a surgical NAPI module if profiling ever identifies a genuine hot spot.
2. Full rewrite of the backend in Rust: reimplement the API server, auth, embed sessions (H6), tenant automation (H7), and the single-node reference (H8) in Rust.
3. Hybrid now: keep Node for orchestration but immediately rewrite one or more server packages (e.g. bundle parser, CSV ingestion) as Rust NAPI modules.

#### REASONING

Option 2 is rejected on cost versus benefit. The backend is
I/O-bound orchestration (API serving, auth, sessions, job
scheduling, Postgres metadata) where Node.js is already excellent;
the compute-heavy analytical path already runs in DuckDB (C++,
decided in HQ-11). There is no profiled Node-bound bottleneck for
Rust to fix, so a rewrite would trade months of reimplementation —
in a language the owner is still learning — for zero user-visible
gain. It would also roughly halve the velocity of the autonomous
build loop, which is currently the project's main shipping engine
and writes TypeScript natively.

Option 3 is rejected as premature: without a measured hot spot it
adds build complexity (native modules, cross-compilation, slower
iteration) for speculative gain.

Option 1 keeps one language across frontend and backend, preserves
build velocity, and leaves the door open: Rust's genuine advantages
(tiny binaries, fast cold starts) matter for the serverless HQ-11
direction, so if cold starts ever become a measured problem, that
measurement is the trigger to revisit — via option 3's surgical
path, not a rewrite.

#### IMPLICATIONS

- No backend language migration work is scheduled; do not file it as an issue.
- Revisit only on profiling evidence: a measured, Node-bound hot spot or measured cold-start problem in the serverless path.
- The revisit path is a targeted NAPI module or microservice, never a full rewrite without a new decision.
- This decision does not constrain the analytical engine (DuckDB, HQ-11).
