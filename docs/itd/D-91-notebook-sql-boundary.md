---
status: ✅ Confirmed
owner: OpenSight maintainers
date: 2026-11-04
labels: [itd]
---

# D-91 — Notebook SQL execution boundary

## Purpose

Record how #164 enforces the decided SQL-only, viewer-permissioned notebook IDD.

## Scope

SQL validation, engine isolation and retention of governed result access.

## Out of Scope

Hosted notebooks, language expansion, AI and the already-decided product rules.

### ✅ ITD D-91 — How should local notebooks admit and execute SQL safely?

#### CONTEXT

The existing general query API accepts definitions rather than SQL. The #164 IDD
permits notebook SQL only with declared, caller-authorized inputs and read-only
bounded execution. The pinned DuckDB dependency already includes SQL AST
serialization, and prep already provides isolated memory tables, bounded reads
and security projection. No new dependency is permitted for this slice.

#### THE PROBLEM

How can notebook SQL be admitted without granting source access or allowing
statements and functions outside the read-only contract?

#### OPTIONS CONSIDERED

1. Validate SQL with keyword matching and execute on an existing source session.
2. **✅ Parse with DuckDB's built-in AST, enforce relation/function constraints,
   and execute only caller-authorized materialized tables in a fresh engine.**
3. Defer all execution until an additional SQL parser/runtime is available.

#### REASONING

Keyword matching cannot reliably validate nested relations or distinguish text
from SQL, and an existing connection exposes more resources than the declared
inputs. DuckDB's parser matches the executing dialect without a new dependency.
AST traversal rejects unsupported query/relation forms, every undeclared table
and unreviewed function before user SQL is prepared. Materialization uses the
existing governed paths; disabled external access plus a read-only transaction
provides another boundary. The existing seams can enforce the brief's
constraints, so deferring all execution is unnecessary. The trade-off is a
conservative SQL subset and per-cell materialization cost.

#### IMPLICATIONS

The engine version is pinned and bypass tests cover nested queries, parameters,
DDL/DML, extensions, dynamic SQL and file access. Parser schema changes require
review. SQL bindings go through the shared parameter validator and driver
binding; SQL normalization retains the original serialized AST to avoid losing
64-bit parser metadata in a JavaScript JSON round-trip. Historical rows and
snapshots remain caller-private and are withheld after source-access or security
fingerprint changes. This preserves D-85's recipe/data distinction. No new product
decision, permission grant, scheduler or metering system is introduced.
