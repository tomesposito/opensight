# Research notes

Phase 0 findings live here. Each note should answer: what did we learn, where did it
come from (real export? AWS docs? experiment?), and what decision in
`SOLUTION_DESIGN.md` does it affect?

Planned notes:

- `bundle-format.md` — exact schema + zip/manifest layout of
  `StartAssetBundleExportJob` output, verified against a real export (OQ-2).
- `api-surface.md` — inventory of QuickSight API actions, prioritized for
  implementation (Phase 1 read paths first).
- `visual-types.md` — the ~15+ visual types and their definition shapes, mapped to
  ECharts compile targets (D4).
- `calculated-fields.md` — function surface inventory for the expression engine (D9).
