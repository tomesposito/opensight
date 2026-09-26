import { serializeVisual } from './authoring.js';
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
  const grain = visual.kind === 'kpi' ? 'total-revenue'
    : visual.dimension !== null && visual.dimension !== 'order_id' ? grains[visual.dimension] : undefined;
  const rows = visual.measures.length === 1 && visual.measures[0] === 'revenue' && grain
    ? oracles.get(grain) ?? null : null;
  return {
    source: 'bundle', definition: serializeVisual(visual), rows,
    bindings: visual.dimension === 'order_date' ? { order_date: 'month' } : {},
    placement: { column: 0, columns: 36, row: 0, rows: 6 },
    path: `author.${visual.id}`,
  };
}
