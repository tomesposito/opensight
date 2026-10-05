# Decision records — IDD and ITD

Two kinds of consequential decisions are recorded here. They share the
same format below; the label marks what kind of decision it is.

- **IDD — Important Design Decision.** What the customer experiences
  or what the business commits to: customer experience and business
  decisions. (e.g. white-labeling scope, embed session model, pilot
  availability commitments, usage entitlement policy.)
- **ITD — Important Technical Decision.** How we will accomplish and
  build it: technical implementation decisions. (e.g. the hosted
  analytical executor, dependency selection, data-plane choices.)

A decision record captures the *why* behind a consequential decision.

Use one when a choice meaningfully shapes what you are building, how
something will work, who or what it serves, what you are committing
to, or what future decisions become possible.

A decision record should capture decisions, not documentation. It is
not a requirements document, project plan, or general collection of
notes. It exists to make a decision and preserve the reasoning behind
it.

Keep it concise. If it reads like a novel, it won't get reviewed.
Write like you're explaining the decision to a sharp colleague at a
whiteboard: plain words, active voice, no corporate language.

Writing one is also a test of whether a decision is ready. If THE
PROBLEM won't resolve into one clean question, or REASONING can't
clearly explain the alternatives and trade-offs, the decision probably
isn't ready.

## Where decision records live

- IDDs: one file per decision under `docs/idd/`
- ITDs: one file per decision under `docs/itd/`

Files are named `<ID>-<short-slug>.md` (e.g.
`HQ-11-hosted-analytical-executor.md`). IDs are short and stable so
they can be referenced elsewhere: keep the existing `HQ-N` / `D-N`
numbering for continuity, and cross-reference related decisions by ID.

## Frontmatter

At minimum, capture:

```yaml
---
status: ✅ Confirmed     # 🚧 Draft | ✅ Confirmed
owner: Tom Esposito     # product owner
date: 2026-10-05
labels: [itd]           # [idd] or [itd]
---
```

## Wrapper sections

Before individual decisions:

### Purpose

One or two sentences explaining why this record exists.

### Scope

The decision areas covered.

### Out of Scope

Related areas intentionally excluded.

These sections establish the boundaries of the discussion. They should
not contain the decisions themselves.

## Decision heading format

```md
### ✅ ITD <ID> — <Decision question>
```

For example:

```md
### ✅ ITD HQ-11 — How should D11 serverless hosting, D12 production Postgres/local-only DuckDB and D13 local Parquet readers be reconciled?
```

Use:

- 🚧 for draft / unresolved, ✅ for confirmed
- `IDD` or `ITD` according to the kind of decision
- A short, stable ID that can be referenced elsewhere
- A heading phrased as the decision being made

Separate multiple decisions clearly. Sequence decisions foundational →
dependent: if Decision B depends on the answer to Decision A, Decision A
comes first.

## Decision anatomy

Every decision contains these five sections, in this order:

#### CONTEXT

The situation that makes this decision necessary. Lead with evidence
rather than generic observations: specific numbers or measurements,
user/customer evidence, existing behavior, constraints, prior decisions,
known limitations, research or testing results, commitments already
made. Aim for 3–5 sentences. Include only context that changes how
someone would evaluate the decision.

#### THE PROBLEM

The exact question this decision must answer. One sentence ending in a
question mark. Not a statement, not a paragraph. Do not embed reasoning
or a preferred answer in the question. A good problem statement makes
it possible to disagree about the answer while agreeing on the
question.

#### OPTIONS CONSIDERED

List meaningfully distinct approaches — usually 3–5, but don't
manufacture alternatives. State options neutrally; don't rig the
decision by describing the preferred option favorably and the others
negatively.

```md
1. Option A
2. ✅ **Option B**
3. Option C
```

When confirmed: bold the selected option and mark it ✅. When open:
mark unresolved elements [WIP] and explain what must be learned or
resolved in REASONING.

#### REASONING

Explain why each option was selected or rejected, walking through the
options by number. For the selected option: why it best addresses the
problem, what evidence supports it, why the alternatives lose, and
what trade-offs are knowingly accepted. This section should make the
decision understandable even to someone who disagrees with it. If it's
difficult to write clearly, the reasoning probably isn't mature enough
yet.

#### IMPLICATIONS

What becomes true because of this decision? Concrete downstream
consequences: work that must now happen, requirements created, work no
longer necessary, dependencies, constraints, risks accepted, decisions
unblocked or newly required, conditions before proceeding, other
decisions affected. Reference related decisions by ID.

## Pre-publish checklist

- ☐ A meaningful decision, not documentation of a requirement or task.
- ☐ Correctly labeled IDD (customer/business) or ITD (technical).
- ☐ Purpose, Scope, and Out of Scope establish clear boundaries.
- ☐ Decisions ordered foundational → dependent.
- ☐ Every decision has a stable ID.
- ☐ Headings indicate 🚧 draft or ✅ confirmed.
- ☐ CONTEXT begins with evidence or concrete facts.
- ☐ THE PROBLEM is exactly one sentence ending in a question mark.
- ☐ OPTIONS are meaningfully distinct and neutrally described.
- ☐ The selected option is bolded and marked ✅.
- ☐ REASONING addresses every option and acknowledges trade-offs.
- ☐ IMPLICATIONS describe specific downstream consequences.
- ☐ Related decisions are cross-referenced.
- ☐ Open decisions state what must be resolved before they can close.
- ☐ Concise enough to understand quickly.

The core test: someone unfamiliar with the discussion should be able to
read the record and answer: what situation forced us to decide? What
exactly did we need to decide? What choices did we seriously consider?
Why did we choose this one? What changes because we chose it?
