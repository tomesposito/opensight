---
status: 🚧 Draft
owner: Tom Esposito
date: 2026-10-13
labels: [idd]
---

## Purpose

Resolve the product choices required to make headless analysis authoring
an implementable v1 contract under D-37 and freeze Q5.

## Scope

Authoring granularity and names, access, edit conflicts, dataset binding
and whether incomplete analysis drafts can be saved.

## Out of Scope

Dashboard publishing semantics (D-38), prepared-dataset sharing (HQ-4),
new SQL execution capabilities, deployment and publishing this branch.

### 🚧 IDD D-39 — What analysis authoring contract should headless v1 expose?

#### CONTEXT

The frozen API inventory names analysis CRUD and authoring as gaps and
reserves their design for this slice. The local definition store only
reads startup files. Hosted embedded-console authoring already saves
single-dataset definitions with co-owner/folder grants, while v1 dataset
queries use owner-private prepared datasets that analysis metadata
cannot currently reference. UI mutations operate on `BundleDefinition`
and allow incremental construction; the API describe shape is PascalCase.

#### THE PROBLEM

Which authoring operations and access, conflict and draft-validity
semantics should agents receive as stable v1 behavior?

#### OPTIONS CONSIDERED

1. Whole-definition CRUD only, retaining existing validation and access
   restrictions wherever they apply. Clients construct full documents
   for every edit; fine-grained tools would wait for a later slice.
2. Whole-definition CRUD plus resource operations for visuals, layouts,
   filter groups and calculated fields, sharing one analysis version and
   one validation path. Exact proposed operations and unresolved policies
   are in the [slice proposal](../headless-v1-analyses.md).
3. Fine-grained operations with independently versioned child resources
   or automatic merging of unrelated edits. This supports more concurrent
   editors but introduces merge and multi-resource consistency semantics.

#### REASONING

[WIP] Option 2 is recommended for review: it lets agents express individual
builder actions and lets batch changes preserve consistency with a single
version. Option 1 is smaller but leaves agents doing document surgery;
option 3 makes concurrent editing more permissive at the cost of a new
conflict model. No option has been selected by the product owner.

Approval must also answer Q1–Q5 in the slice proposal: route/tool names
and casing, who may author/delete, conflict behavior, legacy/prepared
dataset bindings without widening HQ-4, and saving incomplete drafts.
Existing embedded behavior supplies evidence, not permission to silently
freeze new product semantics. The run brief's scope §4 explicitly gates
dependent implementation on this review.

#### IMPLICATIONS

- The analyses build is blocked on those answers; no new endpoint is
  claimed in the shipped OpenAPI contract.
- Confirm the selected option and the slice's concrete contract before
  implementing dependent routes, persistence or validation behavior.
- Share validation with the UI and reject SQL through the existing
  expression parser, including unused calculations on writes.
- Once approved, MCP names follow REST mechanically under freeze Q7;
  this decision must precede those tool names becoming stable.
- Preserve D-38's separation of working analyses and published dashboard
  definitions and HQ-4's owner-private prepared datasets.

Related: [D-37](D-37-headless-first-api.md),
[D-38](D-38-dashboard-publish-semantics.md),
[frozen API contract](../api-contract-v1-draft.md),
[issue #95](https://github.com/tomesposito/opensight/issues/95).
