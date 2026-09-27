import { authorVisualProblem, serializeVisual, visualDimensions } from './authoring.js';
import type { AuthorVisual } from './authoring.js';
import { normalizeVisual } from './compiler.js';
import type { Fixture, FixtureVisual } from './model.js';
import generated from './fixtures.generated.json' with { type: 'json' };

// The generation step pins the entire sales dependency graph and result oracles.
// Deliberately enumerate the four reviewed grains. Never query, join or sum rows,
// match by coincidental column names, or reuse the discounted-revenue calculation.
const sales = (generated as Fixture[]).find(f => f.id === 'renderable-sales');
const oracles = new Map(sales?.sheets.flatMap(s => s.visuals).map(v => [
  normalizeVisual(v.source, v.definition, v.path).id, v.rows,
]));
const grains = {
  region: 'revenue-by-region', category: 'share-by-category', order_date: 'revenue-trend',
} as const;

export function buildAuthorPreview(visual: AuthorVisual): FixtureVisual {
  const dimensions = visualDimensions(visual);
  const grain = visual.kind === 'kpi' ? 'total-revenue'
    : dimensions.length === 1 ? grains[dimensions[0] as keyof typeof grains] : undefined;
  const rows = !authorVisualProblem(visual) && !visual.filters.length && visual.measures.length === 1 && visual.measures[0] === 'revenue' && grain
    ? oracles.get(grain) ?? null : null;
  return { ...buildAuthorVisual(visual), rows };
}

/** A row-free definition shared by the fixture and live previews. */
export function buildAuthorVisual(visual: AuthorVisual): FixtureVisual {
  return {
    source: 'bundle', definition: serializeVisual(visual), rows: null,
    bindings: visualDimensions(visual).includes('order_date') ? { order_date: 'month' } : {},
    placement: { column: 0, columns: 36, row: 0, rows: 6 },
    path: `author.${visual.id}`,
  };
}

/** Distinct lists are taken only from the pinned results; they never authorize new preview grains. */
export function fixtureCategoryValues(column: string): string[] {
  const grain = grains[column as keyof typeof grains];
  return [...new Set((grain ? oracles.get(grain) ?? [] : []).flatMap(row => typeof row[column] === 'string' ? [row[column]] : []))];
}
