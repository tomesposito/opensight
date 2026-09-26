# Research notes

Phase 0 findings live here. Each note should answer: what did we learn, where did it
come from (real export? AWS docs? experiment?), and what decision in
`SOLUTION_DESIGN.md` does it affect?

Observed notes:

- [bundle-format.md](bundle-format.md) — observed ZIP/member layout, camelCase
  definitions, API mapping and remaining gaps, grounded in the sanitized AWS export (OQ-2).

Planned notes:
- `api-surface.md` — inventory of QuickSight API actions, prioritized for
  implementation (Phase 1 read paths first).
- `visual-types.md` — the ~15+ visual types and their definition shapes, mapped to
  ECharts compile targets (D4).
- `calculated-fields.md` — function surface inventory for the expression engine (D9).
