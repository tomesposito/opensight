import type { AnalysisTheme } from './themes.js';
import type { Cell, Field, MultiplesOptions, Row } from './model.js';
import type { VisualKind } from './visual-catalog.js';

/** Visual kinds that render a Small multiples facet as a grid of per-facet panels. */
export const FACETED_KINDS: readonly VisualKind[] = ['bar', 'bar100', 'line', 'area', 'combo', 'pie'] as const;

export interface FacetGroup { value: Cell; rows: Row[] }

/** Group rows by the facet dimension's cell value, in first-appearance order. */
export function groupRowsByFacet(rows: Row[], facet: Field, cell: (row: Row, field: Field) => Cell): FacetGroup[] {
  const groups: FacetGroup[] = [];
  const seen = new Map<string, number>();
  for (const row of rows) {
    const value = cell(row, facet);
    const k = JSON.stringify(value);
    let i = seen.get(k);
    if (i === undefined) { i = groups.length; seen.set(k, i); groups.push({ value, rows: [] }); }
    groups[i]!.rows.push(row);
  }
  return groups;
}

export interface FacetLayout {
  shown: FacetGroup[];
  cols: number;
  gridRows: number;
  topPad: number;
  bottomPad: number;
  cellW: number;
  cellH: number;
}

/**
 * Arrange facet panels on a percentage grid. The panel's Number of panels caps
 * the grid (the 20-panel renderer limit always applies); explicit visible
 * rows/columns pin the grid, otherwise an auto heuristic picks the column
 * count. Oversized facet counts warn and truncate — never silently dropped.
 */
export function facetLayout(
  groups: FacetGroup[],
  opts: MultiplesOptions | undefined,
  path: string,
  warn: (message: string) => void,
): FacetLayout {
  const MAX_FACETS = 20;
  // The panel's Number of panels caps the grid; the 20-panel renderer limit always applies.
  const panelCap = Math.min(opts?.panelCount ?? MAX_FACETS, MAX_FACETS);
  if (groups.length > panelCap) warn(`${path}: ${groups.length} small-multiple panels exceed the ${panelCap}-panel limit; showing the first ${panelCap}.`);
  let shown = groups.slice(0, panelCap);
  // Explicit visible rows/columns pin the grid (honored together with the
  // panel cap); 'auto' keeps today's heuristic.
  const fixedRows = typeof opts?.visibleRows === 'number' ? opts.visibleRows : undefined;
  const fixedCols = typeof opts?.visibleColumns === 'number' ? opts.visibleColumns : undefined;
  let cols: number, gridRows: number;
  if (fixedRows !== undefined && fixedCols !== undefined) {
    gridRows = fixedRows; cols = fixedCols;
    const capacity = gridRows * cols;
    if (shown.length > capacity) {
      warn(`${path}: ${shown.length} small-multiple panels exceed the ${gridRows}x${cols} visible grid; showing the first ${capacity}.`);
      shown = shown.slice(0, capacity);
    }
  } else if (fixedRows !== undefined) { gridRows = fixedRows; cols = Math.max(1, Math.ceil(shown.length / gridRows)); }
  else if (fixedCols !== undefined) { cols = fixedCols; gridRows = Math.ceil(shown.length / cols); }
  else { const n = shown.length; cols = n <= 1 ? 1 : n <= 4 ? 2 : 3; gridRows = Math.ceil(n / cols); }
  const topPad = 12, bottomPad = 14, cellH = (100 - topPad - bottomPad) / gridRows, cellW = 100 / cols;
  return { shown, cols, gridRows, topPad, bottomPad, cellW, cellH };
}

/**
 * One ECharts title per panel. Absent options keep the classic rendering
 * (12px semibold, centered); explicit options apply the editor typography
 * scale and alignment. Underline has no ECharts title support and is never
 * faked — the flag stays in the model only.
 */
export function facetTitles(
  shown: FacetGroup[],
  opts: MultiplesOptions | undefined,
  cols: number,
  cellH: number,
  topPad: number,
  theme: AnalysisTheme,
  display: (value: Cell) => string,
): { text: string; left: string; top: string; textAlign: 'left' | 'center' | 'right'; textStyle: Record<string, unknown> }[] {
  const titleSize = opts ? { small: 11, medium: 13, large: 15 }[opts.title.size] : 12;
  const titleWeight = opts ? (opts.title.bold ? 700 : 400) : 600;
  const titleAlign = opts?.title.align ?? 'center';
  return shown.map((group, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    // The title anchors to the panel edge matching its alignment.
    const left = titleAlign === 'left' ? (c / cols) * 100 : titleAlign === 'right' ? ((c + 1) / cols) * 100 : ((c + 0.5) / cols) * 100;
    return {
      text: display(group.value), left: `${left.toFixed(2)}%`, top: `${(topPad + r * cellH + 1.5).toFixed(2)}%`,
      textAlign: titleAlign, textStyle: { fontSize: titleSize, fontWeight: titleWeight, ...(opts?.title.italic ? { fontStyle: 'italic' as const } : {}), color: theme.textColor, fontFamily: theme.fontFamily },
    };
  });
}

/**
 * Panel chrome: one ECharts grid per panel draws the border/background.
 * ECharts grids cannot dash their border, so dashed/dotted render solid
 * (the choice is preserved in the model and exports). The gutter option
 * opens an inter-panel gap by shrinking each panel's content (and
 * insetting its chrome); the factor is an OpenSight approximation of the
 * reference spacing, not measured QuickSight geometry.
 */
export function facetPanelGrids(
  shown: FacetGroup[],
  opts: MultiplesOptions | undefined,
  cols: number,
  cellW: number,
  cellH: number,
  topPad: number,
): { show: boolean; left: string; top: string; width: string; height: string; backgroundColor: string; borderWidth: number; borderColor: string }[] | undefined {
  if (!opts || (!opts.border.enabled && !opts.background)) return undefined;
  const inset = opts.gutter ? 1.5 : 0;
  return shown.map((_, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    return {
      show: true,
      left: `${(c * cellW + inset).toFixed(2)}%`, top: `${(topPad + r * cellH + inset).toFixed(2)}%`,
      width: `${(cellW - inset * 2).toFixed(2)}%`, height: `${(cellH - inset * 2).toFixed(2)}%`,
      backgroundColor: opts.background ? '#f4f6f8' : 'transparent',
      borderWidth: opts.border.enabled ? opts.border.widthPx : 0,
      borderColor: opts.border.color,
    };
  });
}
