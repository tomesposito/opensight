import type { BundleAnalysis, BundleColumnField, BundleDimensionField, BundleMeasureField, BundleVisual, BundleVisualBody } from '@opensight/bundle-parser';
import { normalizeVisual } from './compiler.js';

export const SALES_FIELDS = [
  { name: 'order_id', role: 'dimension', type: 'INTEGER' },
  { name: 'order_date', role: 'dimension', type: 'DATETIME' },
  { name: 'region', role: 'dimension', type: 'STRING' },
  { name: 'category', role: 'dimension', type: 'STRING' },
  { name: 'revenue', role: 'measure', type: 'DECIMAL' },
  { name: 'profit', role: 'measure', type: 'DECIMAL' },
] as const;
export interface CalculatedField { name: string; expression: string; role: 'dimension' | 'measure' }
export interface DataField { name: string; role: 'dimension' | 'measure'; type: string }
export const dataFields = (calculations: readonly CalculatedField[] = []): DataField[] => [
  ...SALES_FIELDS, ...calculations.map(f => ({ name: f.name, role: f.role, type: f.role === 'measure' ? 'DECIMAL' : 'STRING' } as const)),
];
export const VISUAL_TYPES = [
  { kind: 'bar', label: 'Bar', icon: '▥' }, { kind: 'line', label: 'Line', icon: '⌁' },
  { kind: 'pie', label: 'Pie / donut', icon: '◔' }, { kind: 'kpi', label: 'KPI', icon: '123' },
  { kind: 'table', label: 'Table', icon: '▤' }, { kind: 'pivot', label: 'Pivot', icon: '▦' },
] as const;
export type VisualKind = typeof VISUAL_TYPES[number]['kind'];
export type Well = 'dimension' | 'rows' | 'columns' | 'values';
export interface CategoryFilter { columnName: string; values: string[] }
export interface AuthorVisual {
  id: string; kind: VisualKind; title: string;
  dimension: string | null; measures: string[]; rows: string[]; columns: string[];
  donut: boolean; titleVisible: boolean; legend: boolean; labels: boolean;
  horizontal: boolean; stacked: boolean; totals: boolean; subtotals: boolean;
  filters: CategoryFilter[];
}
export interface Placement { i: string; x: number; y: number; w: number; h: number }
export interface AuthorSheet { id: string; name: string; visuals: AuthorVisual[]; layout: Placement[]; selectedId: string | null }
export interface AuthorDraft {
  version: 2; title: string; sheets: AuthorSheet[]; activeSheetId: string; calculatedFields: CalculatedField[];
}
export const GRID_COLUMNS = 12;
const newSheet = (id: string, name: string): AuthorSheet => ({ id, name, visuals: [], layout: [], selectedId: null });
export const emptyDraft = (): AuthorDraft => ({ version: 2, title: 'Untitled analysis', sheets: [newSheet('sheet-1', 'Sheet 1')], activeSheetId: 'sheet-1', calculatedFields: [] });
export const activeSheet = (draft: AuthorDraft): AuthorSheet => draft.sheets.find(s => s.id === draft.activeSheetId)!;
export const dimensionLabel = (kind: VisualKind): string => kind === 'line' ? 'X-axis' : kind === 'table' ? 'Group-by' : kind === 'pivot' ? 'Rows' : 'Category';
export const singleMeasure = (kind: VisualKind): boolean => kind === 'pie' || kind === 'kpi';
export const tabular = (kind: VisualKind): boolean => kind === 'table' || kind === 'pivot';
export const visualDimensions = (visual: AuthorVisual): string[] => visual.kind === 'kpi' ? [] : tabular(visual.kind)
  ? [...visual.rows, ...visual.columns] : visual.dimension === null ? [] : [visual.dimension];
const nextId = (prefix: string, ids: string[]): string => {
  let n = 1;
  while (ids.includes(`${prefix}-${n}`)) n++;
  return `${prefix}-${n}`;
};
const defaults = () => ({ rows: [] as string[], columns: [] as string[], titleVisible: true, legend: true, labels: false,
  horizontal: false, stacked: false, totals: false, subtotals: false, filters: [] as CategoryFilter[] });

/** Expressions are preserved, never evaluated in the browser. The query engine validates execution. */
export function calculationError(field: CalculatedField, existing: readonly DataField[]): string | undefined {
  if (!/^[A-Za-z_][A-Za-z0-9_ ]{0,127}$/.test(field.name.trim())) return 'Use a field name starting with a letter or underscore (up to 128 characters).';
  if (existing.some(f => f.name.toLowerCase() === field.name.trim().toLowerCase())) return 'A field with that name already exists.';
  if (!field.expression.trim()) return 'Enter an expression.';
  if (field.expression.length > 10000 || /[;`\0]|--|\/\*|\*\/|<\/?[a-z]|=>|\b(?:eval|Function|fetch|require|import|exec|window|document|process|globalThis)\b/i.test(field.expression)) return 'Remove scripts, comments, or statement separators from the expression.';
  if (field.role !== 'dimension' && field.role !== 'measure') return 'Choose a field role.';
}
export type AuthorAction =
  | { type: 'analysis-title'; title: string }
  | { type: 'sheet-add' }
  | { type: 'sheet-select' | 'sheet-delete'; id: string }
  | { type: 'sheet-rename'; id: string; name: string }
  | { type: 'layout'; sheetId: string; layout: readonly Placement[] }
  | { type: 'calculation-add'; field: CalculatedField }
  | { type: 'add'; kind: VisualKind }
  | { type: 'select' | 'remove'; id: string }
  | { type: 'move'; id: string; offset: -1 | 1 }
  | { type: 'kind'; kind: VisualKind }
  | { type: 'title'; title: string }
  | { type: 'donut'; donut: boolean }
  | { type: 'display'; property: 'titleVisible' | 'legend' | 'labels' | 'horizontal' | 'stacked' | 'totals' | 'subtotals'; value: boolean }
  | { type: 'filter'; columnName: string; values: string[] | null }
  | { type: 'assign' | 'unassign'; field: string; well?: Well };

function validLayout(layout: readonly Placement[], visuals: readonly AuthorVisual[]): boolean {
  return layout.length === visuals.length && new Set(layout.map(p => p.i)).size === layout.length && layout.every(p =>
    visuals.some(v => v.id === p.i) && [p.x, p.y, p.w, p.h].every(Number.isSafeInteger) && p.x >= 0 && p.y >= 0 &&
    p.w >= 3 && p.h >= 4 && p.x + p.w <= GRID_COLUMNS && p.y + p.h <= 10000);
}
const cleanLayout = (layout: readonly Placement[]): Placement[] => layout.map(({ i, x, y, w, h }) => ({ i, x, y, w, h }));

/** Immutable transitions shared by field buttons, pills, sheet tabs and drag/resize callbacks. */
export function authorReducer(draft: AuthorDraft, action: AuthorAction): AuthorDraft {
  if (action.type === 'analysis-title') return { ...draft, title: action.title };
  if (action.type === 'calculation-add') {
    if (calculationError(action.field, dataFields(draft.calculatedFields))) return draft;
    return { ...draft, calculatedFields: [...draft.calculatedFields, { ...action.field, name: action.field.name.trim() }] };
  }
  if (action.type === 'sheet-add') {
    const id = nextId('sheet', draft.sheets.map(s => s.id));
    return { ...draft, sheets: [...draft.sheets, newSheet(id, `Sheet ${id.slice(6)}`)], activeSheetId: id };
  }
  if (action.type === 'sheet-select') return draft.sheets.some(s => s.id === action.id) ? { ...draft, activeSheetId: action.id } : draft;
  if (action.type === 'sheet-rename') return action.name.trim() ? { ...draft, sheets: draft.sheets.map(s => s.id === action.id ? { ...s, name: action.name.trim() } : s) } : draft;
  if (action.type === 'sheet-delete') {
    const index = draft.sheets.findIndex(s => s.id === action.id);
    if (index < 0 || draft.sheets.length === 1) return draft;
    const sheets = draft.sheets.filter(s => s.id !== action.id);
    return { ...draft, sheets, activeSheetId: draft.activeSheetId === action.id ? sheets[Math.min(index, sheets.length - 1)]!.id : draft.activeSheetId };
  }
  if (action.type === 'layout') {
    const sheet = draft.sheets.find(s => s.id === action.sheetId);
    const layout = cleanLayout(action.layout);
    if (!sheet || !validLayout(layout, sheet.visuals) || JSON.stringify(layout) === JSON.stringify(sheet.layout)) return draft;
    return { ...draft, sheets: draft.sheets.map(s => s === sheet ? { ...s, layout } : s) };
  }
  const sheet = activeSheet(draft);
  const update = (changes: Partial<AuthorSheet>): AuthorDraft => ({ ...draft, sheets: draft.sheets.map(s => s === sheet ? { ...s, ...changes } : s) });
  if (action.type === 'add') {
    const id = nextId('visual', draft.sheets.flatMap(s => s.visuals.map(v => v.id)));
    const dimension = action.kind === 'kpi' ? null : action.kind === 'line' ? 'order_date' : action.kind === 'pie' ? 'category' : 'region';
    const visual: AuthorVisual = { ...defaults(), id, kind: action.kind, title: '', donut: false, dimension, measures: ['revenue'],
      rows: tabular(action.kind) && dimension ? [dimension] : [], labels: action.kind === 'pie' };
    const bottom = Math.max(0, ...sheet.layout.map(p => p.y + p.h));
    return update({ visuals: [...sheet.visuals, visual], selectedId: id, layout: [...sheet.layout, { i: id, x: 0, y: bottom, w: 6, h: 8 }] });
  }
  if (action.type === 'select') return sheet.visuals.some(v => v.id === action.id) ? update({ selectedId: action.id }) : draft;
  if (action.type === 'remove' || action.type === 'move') {
    const index = sheet.visuals.findIndex(v => v.id === action.id);
    if (index < 0) return draft;
    const visuals = [...sheet.visuals];
    if (action.type === 'move') {
      const target = index + action.offset;
      if (target < 0 || target >= visuals.length) return draft;
      [visuals[index], visuals[target]] = [visuals[target]!, visuals[index]!];
      const a = sheet.layout.find(p => p.i === action.id)!, b = sheet.layout.find(p => p.i === visuals[index]!.id)!;
      return update({ visuals, layout: sheet.layout.map(p => p === a ? { ...b, i: a.i } : p === b ? { ...a, i: b.i } : p) });
    }
    visuals.splice(index, 1);
    return update({ visuals, layout: sheet.layout.filter(p => p.i !== action.id), selectedId: sheet.selectedId === action.id ? (visuals[Math.min(index, visuals.length - 1)]?.id ?? null) : sheet.selectedId });
  }
  return update({ visuals: sheet.visuals.map(visual => {
    if (visual.id !== sheet.selectedId) return visual;
    switch (action.type) {
      case 'kind': return { ...visual, kind: action.kind, donut: action.kind === 'pie' && visual.donut,
        dimension: action.kind === 'kpi' ? null : visual.dimension,
        rows: tabular(action.kind) ? (tabular(visual.kind) ? visual.rows : visual.dimension ? [visual.dimension] : []) : [],
        columns: action.kind === 'pivot' ? visual.columns : [],
        measures: singleMeasure(action.kind) ? visual.measures.slice(0, 1) : visual.measures };
      case 'title': return { ...visual, title: action.title };
      case 'donut': return { ...visual, donut: visual.kind === 'pie' && action.donut };
      case 'display': return { ...visual, [action.property]: action.value };
      case 'filter': {
        if (!dataFields(draft.calculatedFields).some(f => f.name === action.columnName && f.type === 'STRING')) return visual;
        const filters = visual.filters.filter(f => f.columnName !== action.columnName);
        return { ...visual, filters: action.values === null ? filters : [...filters, { columnName: action.columnName, values: [...new Set(action.values)] }] };
      }
      case 'unassign': {
        const rows = (!action.well || action.well === 'rows') ? visual.rows.filter(f => f !== action.field) : visual.rows;
        return { ...visual, rows, columns: !action.well || action.well === 'columns' ? visual.columns.filter(f => f !== action.field) : visual.columns,
          dimension: tabular(visual.kind) ? rows[0] ?? null : visual.dimension === action.field ? null : visual.dimension,
          measures: !action.well || action.well === 'values' ? visual.measures.filter(f => f !== action.field) : visual.measures };
      }
      case 'assign': {
        const field = dataFields(draft.calculatedFields).find(f => f.name === action.field);
        if (!field) return visual;
        if (field.role === 'measure') return action.well && action.well !== 'values' ? visual : { ...visual, measures: singleMeasure(visual.kind) ? [field.name] : [...new Set([...visual.measures, field.name])] };
        if (visual.kind === 'kpi' || action.well === 'values') return visual;
        if (tabular(visual.kind)) {
          const well = visual.kind === 'pivot' && action.well === 'columns' ? 'columns' : 'rows';
          const other = well === 'rows' ? 'columns' : 'rows';
          const next = { ...visual, [well]: action.well ? [...new Set([...visual[well], field.name])] : [field.name], [other]: visual[other].filter(f => f !== field.name) };
          return { ...next, dimension: next.rows[0] ?? null };
        }
        return { ...visual, dimension: field.name };
      }
    }
    return visual;
  }) });
}

function columnField(name: string): BundleColumnField {
  return { fieldId: name, column: { dataSetIdentifier: 'sales_data', columnName: name } };
}
function dimensionField(name: string): BundleDimensionField {
  return name === 'order_date' ? { dateDimensionField: { ...columnField(name), dateGranularity: 'MONTH' } }
    : name === 'order_id' ? { numericalDimensionField: columnField(name) } : { categoricalDimensionField: columnField(name) };
}
/** Typed camelCase projection, including the parser's opaque extensions. */
export function serializeVisual(visual: AuthorVisual): BundleVisual {
  const category = visualDimensions(visual).map(dimensionField);
  const values: BundleMeasureField[] = visual.measures.map(name => ({ numericalMeasureField: { ...columnField(name), aggregationFunction: { simpleNumericalAggregation: 'SUM' } } }));
  const visibility = (show: boolean) => ({ visibility: show ? 'VISIBLE' : 'HIDDEN' });
  const body = { visualId: visual.id, ...(visual.title.trim() || !visual.titleVisible ? { title: { ...visibility(visual.titleVisible), ...(visual.title.trim() ? { formatText: { plainText: visual.title.trim() } } : {}) } } : {}) } satisfies BundleVisualBody;
  const display = { legend: visibility(visual.legend), dataLabels: visibility(visual.labels) };
  const totalVisibility = (show: boolean) => ({ totalsVisibility: show ? 'VISIBLE' : 'HIDDEN' });
  const tableTotals = { totalOptions: totalVisibility(visual.totals), opensightSubtotalOptions: totalVisibility(visual.subtotals) };
  const pivotTotals = { totalOptions: { rowTotalOptions: totalVisibility(visual.totals), columnTotalOptions: totalVisibility(visual.totals),
    rowSubtotalOptions: totalVisibility(visual.subtotals), columnSubtotalOptions: totalVisibility(visual.subtotals) } };
  switch (visual.kind) {
    case 'pie': return { pieChartVisual: { ...body, chartConfiguration: { ...display,
      fieldWells: { pieChartAggregatedFieldWells: { category, values } }, donutOptions: { arcOptions: { arcThickness: visual.donut ? 'MEDIUM' : 'WHOLE' } },
    } } };
    case 'bar': return { barChartVisual: { ...body, chartConfiguration: { ...display, orientation: visual.horizontal ? 'HORIZONTAL' : 'VERTICAL', barsArrangement: visual.stacked ? 'STACKED' : 'CLUSTERED', fieldWells: { barChartAggregatedFieldWells: { category, values } } } } };
    case 'line': return { lineChartVisual: { ...body, chartConfiguration: { ...display, fieldWells: { lineChartAggregatedFieldWells: { category, values } } } } };
    case 'table': return { tableVisual: { ...body, chartConfiguration: { ...tableTotals, fieldWells: { tableAggregatedFieldWells: { groupBy: category, values } } } } };
    case 'pivot': return { pivotTableVisual: { ...body, chartConfiguration: { ...pivotTotals, fieldWells: { pivotTableAggregatedFieldWells: { rows: visual.rows.map(dimensionField), columns: visual.columns.map(dimensionField), values } } } } };
    case 'kpi': return { kpiVisual: { ...body, chartConfiguration: { fieldWells: { values } } } };
  }
}
/** Export the analysis, including sheet layouts and scoped filters, but never result rows or UI selection. */
export function serializeDraft(draft: AuthorDraft): BundleAnalysis {
  validateDraft(draft);
  return { resourceType: 'analysis', analysisId: 'authored-analysis', name: draft.title.trim() || 'Untitled analysis', definition: {
    dataSetIdentifierDeclarations: [{ identifier: 'sales_data', dataSetArn: 'arn:aws:quicksight:us-east-1:123456789012:dataset/renderable-sales' }],
    calculatedFields: draft.calculatedFields.map(({ name, expression }) => ({ dataSetIdentifier: 'sales_data', name, expression })),
    filterGroups: draft.sheets.flatMap(sheet => sheet.visuals.flatMap(visual => visual.filters.map((filter, index) => ({
      filterGroupId: `${visual.id}-filter-${index}`, status: 'ENABLED', crossDataset: 'SINGLE_DATASET',
      scopeConfiguration: { selectedSheets: { sheetVisualScopingConfigurations: [{ sheetId: sheet.id, scope: 'SELECTED_VISUALS', visualIds: [visual.id] }] } },
      filters: [{ categoryFilter: { filterId: `${visual.id}-filter-${index}`, column: { dataSetIdentifier: 'sales_data', columnName: filter.columnName },
        configuration: { filterListConfiguration: { matchOperator: 'EQUALS', nullOption: 'NON_NULLS_ONLY', categoryValues: filter.values } } } }],
    })))),
    sheets: draft.sheets.map(sheet => ({ sheetId: sheet.id, name: sheet.name, visuals: sheet.visuals.map(visual => {
      const definition = serializeVisual(visual);
      normalizeVisual('bundle', definition, `sheets.${sheet.id}.${visual.id}`);
      return definition;
    }), layouts: [{ configuration: { gridLayout: { elements: sheet.layout.map(p => ({ elementId: p.i, elementType: 'VISUAL', columnIndex: p.x * 3, columnSpan: p.w * 3, rowIndex: p.y, rowSpan: p.h })) } } }] })),
  } };
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const onlyKeys = (v: Record<string, unknown>, keys: string[]): boolean => Object.keys(v).every(k => keys.includes(k));
/** localStorage is untrusted: validate every identity, field, layout and display option. */
export function validateDraft(value: unknown): asserts value is AuthorDraft {
  const fail = (): never => { throw new Error('Invalid or unsupported author draft.'); };
  if (!isObject(value) || !onlyKeys(value, ['version', 'title', 'sheets', 'activeSheetId', 'calculatedFields']) || value.version !== 2 || typeof value.title !== 'string' || !Array.isArray(value.sheets) || !value.sheets.length || !Array.isArray(value.calculatedFields)) return fail();
  const calculations: CalculatedField[] = [];
  for (const item of value.calculatedFields) {
    if (!isObject(item) || !onlyKeys(item, ['name', 'expression', 'role']) || typeof item.name !== 'string' || typeof item.expression !== 'string' || (item.role !== 'dimension' && item.role !== 'measure')) return fail();
    const field: CalculatedField = { name: item.name, expression: item.expression, role: item.role };
    if (field.name !== field.name.trim() || calculationError(field, dataFields(calculations))) return fail();
    calculations.push(field);
  }
  const fields = dataFields(calculations), ids = new Set<string>(), sheetIds = new Set<string>();
  const names = (v: unknown, role: string): v is string[] => Array.isArray(v) && v.every(n => fields.some(f => f.name === n && f.role === role)) && new Set(v).size === v.length;
  for (const sheet of value.sheets) {
    if (!isObject(sheet) || !onlyKeys(sheet, ['id', 'name', 'visuals', 'layout', 'selectedId']) || typeof sheet.id !== 'string' || !/^sheet-[1-9][0-9]*$/.test(sheet.id) || sheetIds.has(sheet.id) || typeof sheet.name !== 'string' || !sheet.name.trim() || !Array.isArray(sheet.visuals) || !Array.isArray(sheet.layout)) return fail();
    sheetIds.add(sheet.id);
    for (const v of sheet.visuals) {
      if (!isObject(v) || !onlyKeys(v, ['id', 'kind', 'title', 'dimension', 'measures', 'donut', ...Object.keys(defaults())]) || typeof v.id !== 'string' || !/^visual-[1-9][0-9]*$/.test(v.id) || ids.has(v.id) || !VISUAL_TYPES.some(t => t.kind === v.kind) || typeof v.title !== 'string' || !['donut', 'titleVisible', 'legend', 'labels', 'horizontal', 'stacked', 'totals', 'subtotals'].every(k => typeof v[k] === 'boolean') || !names(v.measures, 'measure') || !names(v.rows, 'dimension') || !names(v.columns, 'dimension') || (v.dimension !== null && !fields.some(f => f.role === 'dimension' && f.name === v.dimension)) || !Array.isArray(v.filters)) return fail();
      if ((v.kind === 'kpi' || v.kind === 'pie') && v.measures.length > 1 || v.kind === 'kpi' && v.dimension !== null || v.kind !== 'pie' && v.donut || v.kind !== 'pivot' && v.columns.length || (v.kind === 'table' || v.kind === 'pivot' ? v.dimension !== (v.rows[0] ?? null) : v.rows.length) || v.rows.some(n => (v.columns as string[]).includes(n))) return fail();
      const filters = new Set<string>();
      for (const f of v.filters) {
        if (!isObject(f) || !onlyKeys(f, ['columnName', 'values']) || typeof f.columnName !== 'string' || filters.has(f.columnName) || !fields.some(field => field.name === f.columnName && field.type === 'STRING') || !Array.isArray(f.values) || !f.values.every(n => typeof n === 'string' && !n.includes('\0')) || new Set(f.values).size !== f.values.length) return fail();
        filters.add(f.columnName);
      }
      ids.add(v.id);
    }
    if (sheet.visuals.length ? !sheet.visuals.some(v => v.id === sheet.selectedId) : sheet.selectedId !== null) return fail();
    if (!sheet.layout.every(p => isObject(p) && onlyKeys(p, ['i', 'x', 'y', 'w', 'h'])) || !validLayout(sheet.layout as Placement[], sheet.visuals as AuthorVisual[])) return fail();
  }
  if (typeof value.activeSheetId !== 'string' || !sheetIds.has(value.activeSheetId)) fail();
}

/** Keep the original storage key and migrate v0 drafts only after checking their complete shape. */
function migrateDraft(value: unknown): unknown {
  if (!isObject(value) || value.version !== 1) return value;
  if (!onlyKeys(value, ['version', 'visuals', 'selectedId']) || !Array.isArray(value.visuals)) throw new Error('Invalid legacy draft');
  const draft = emptyDraft();
  const visuals = value.visuals.map(v => {
    if (!isObject(v) || !onlyKeys(v, ['id', 'kind', 'title', 'dimension', 'measures', 'donut']) || v.kind === 'pivot') throw new Error('Invalid legacy visual');
    return { ...defaults(), ...v, id: v.id, rows: v.kind === 'table' && v.dimension !== null ? [v.dimension] : [], labels: v.kind === 'pie' };
  });
  return { ...draft, sheets: [{ ...draft.sheets[0], visuals, selectedId: value.selectedId, layout: visuals.map((v, index) => ({ i: v.id, x: 0, y: index * 8, w: 12, h: 8 })) }] };
}
export const DRAFT_KEY = 'opensight.author.v0';
type GetStorage = () => Pick<Storage, 'getItem' | 'setItem'>;
export function loadDraft(getStorage: GetStorage): { draft: AuthorDraft; warning?: string } {
  try {
    const saved = getStorage().getItem(DRAFT_KEY);
    if (saved === null) return { draft: emptyDraft() };
    const draft: unknown = migrateDraft(JSON.parse(saved));
    validateDraft(draft);
    return { draft };
  } catch { return { draft: emptyDraft(), warning: 'The saved draft could not be restored. Your next edit will start a new draft.' }; }
}
export function saveDraft(draft: AuthorDraft, getStorage: GetStorage): string {
  try { validateDraft(draft); getStorage().setItem(DRAFT_KEY, JSON.stringify(draft)); return 'Draft saved on this device.'; }
  catch { return 'Draft could not be saved on this device. Export JSON to keep your work.'; }
}
