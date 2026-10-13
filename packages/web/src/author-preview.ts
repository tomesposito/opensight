import { authorVisualProblem, dataFields, noDimensions, serializeVisual, visualDimensions } from './authoring.js';
import type { AuthorVisual, AuthorDataset, CalculatedField } from './authoring.js';
import { buildAuthorQuery } from './author-query.js';
import { executeFixtureQuery } from './fixture-query.js';
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
  const grain = noDimensions(visual.kind) ? 'total-revenue'
    : dimensions.length === 1 ? grains[dimensions[0] as keyof typeof grains] : undefined;
  // Pinned oracles cover only the four reviewed grains and cannot supply extra tooltip
  // measures or facet groupings. Extras and pie small-multiples facets go through the same
  // query-engine evaluation the live fixture path uses, so the preview shows real values
  // at the visual's grain; failures yield no rows.
  const faceted = visual.kind === 'pie' && !!visual.smallMultiples?.length;
  const rows = visual.tooltipExtraFields.length || faceted
    ? (() => { const request = buildAuthorQuery(visual); return request ? executeFixtureQuery(request).rows : null; })()
    : !authorVisualProblem(visual) && !visual.filters.length && visual.measures.length === 1 && visual.measures[0] === 'revenue' && grain
      ? oracles.get(grain) ?? null : null;
  return { ...buildAuthorVisual(visual), rows };
}

/** A row-free definition shared by the fixture and live previews. */
export function buildAuthorVisual(visual: AuthorVisual, calculations: readonly CalculatedField[] = [], dataset?: AuthorDataset): FixtureVisual {
  return {
    source: 'bundle', definition: serializeVisual(visual, false, calculations, dataset), rows: null,
    // Thread interaction actions so view-mode surfaces can offer them; absent stays absent.
    ...(visual.filterActions?.length ? { filterActions: [...visual.filterActions] } : {}),
    ...(visual.urlActions?.length ? { urlActions: [...visual.urlActions] } : {}),
    ...(visual.navigationActions?.length ? { navigationActions: [...visual.navigationActions] } : {}),
    bindings: Object.fromEntries([...visualDimensions(visual), ...(visual.kind === 'pie' ? visual.smallMultiples ?? [] : [])].filter(name => dataFields(calculations, dataset).some(f => f.name === name && f.type === 'DATETIME')).map(name => [name, (visual.dateGrain ?? 'MONTH').toLowerCase()])),
    placement: { column: 0, columns: 36, row: 0, rows: 6 },
    path: `author.${visual.id}`,
  };
}

/** Distinct lists are taken only from the pinned results; they never authorize new preview grains. */
export function fixtureCategoryValues(column: string): string[] {
  const grain = grains[column as keyof typeof grains];
  return [...new Set((grain ? oracles.get(grain) ?? [] : []).flatMap(row => typeof row[column] === 'string' ? [row[column]] : []))];
}
