import { hierarchyError, type DimensionHierarchy, type DateGrain } from './drill.js';
import { validFilterActions, type FilterAction, type InteractionFilter } from './interactions.js';
import { serializeControl, serializeFilter } from './bundle-controls.js';
import { controlError, validateControls, type AuthorControl } from './controls.js';
import { parameterError, parameterValueError, validateAuthorParameters, serializeParameter } from './parameters.js';
import type { AuthorParameter, ParameterValue } from './parameters.js';
import type { BundleAnalysis, BundleColumnField, BundleDimensionField, BundleMeasureField, BundleVisual, BundleVisualBody } from '@opensight/bundle-parser';
import { summarizeQsBundle } from '@opensight/bundle-parser/browser';
import type { QsBundle } from '@opensight/bundle-parser';
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
export interface CategoryFilter { columnName: string; values: string[]; parameterName?: string; operator?: 'EQUALS' | 'GREATER_THAN_OR_EQUAL_TO' | 'LESS_THAN_OR_EQUAL_TO' }
export interface ImportedVisual {
  visualId: string; variant: string; local: boolean; replaced?: boolean; remapped?: boolean;
  dataSets: { identifier: string; arn?: string }[];
  issues: string[]; unmappedFields: string[];
  baseline: Omit<AuthorVisual, 'imported'>;
  filterGroups: { id: string; columnName: string }[];
}
export interface ImportedSheet {
  memberPath: string; sheetId: string; name: string; layout: Placement[]; controls?: AuthorControl[];
}
export interface ImportResult { path: string; name: string; messages: string[] }
export interface BundleOrigin {
  original: QsBundle; primaryPath: string; title: string;
  report: ImportResult[]; calculations: CalculatedField[]; emptySheetId?: string;
}
export interface AuthorVisual {
  id: string; kind: VisualKind; title: string;
  dimension: string | null; measures: string[]; rows: string[]; columns: string[];
  donut: boolean; titleVisible: boolean; legend: boolean; labels: boolean;
  horizontal: boolean; stacked: boolean; totals: boolean; subtotals: boolean;
  filters: CategoryFilter[];
  filterActions?: FilterAction[];
  hierarchy?: DimensionHierarchy;
  dateGrain?: DateGrain;
  interactionFilters?: InteractionFilter[];
  imported?: ImportedVisual;
}
export interface Placement { i: string; x: number; y: number; w: number; h: number }
export interface AuthorSheet { controls: AuthorControl[]; id: string; name: string; visuals: AuthorVisual[]; layout: Placement[]; selectedId: string | null; imported?: ImportedSheet }
export interface AuthorDraft {
  version: 2; parameters: AuthorParameter[]; title: string; sheets: AuthorSheet[]; activeSheetId: string; calculatedFields: CalculatedField[]; bundle?: BundleOrigin;
}
export const GRID_COLUMNS = 12;
const newSheet = (id: string, name: string): AuthorSheet => ({ id, name, controls: [], visuals: [], layout: [], selectedId: null });
export const emptyDraft = (): AuthorDraft => ({ version: 2, parameters: [], title: 'Untitled analysis', sheets: [newSheet('sheet-1', 'Sheet 1')], activeSheetId: 'sheet-1', calculatedFields: [] });
export const activeSheet = (draft: AuthorDraft): AuthorSheet => draft.sheets.find(s => s.id === draft.activeSheetId)!;
export const sheetParameters = (draft: AuthorDraft, sheet = activeSheet(draft)): AuthorParameter[] => draft.parameters.filter(p => !p.memberPath || p.memberPath === (sheet.imported?.memberPath ?? draft.bundle?.primaryPath));
export const dimensionLabel = (kind: VisualKind): string => kind === 'line' ? 'X-axis' : kind === 'table' ? 'Group-by' : kind === 'pivot' ? 'Rows' : 'Category';
export const singleMeasure = (kind: VisualKind): boolean => kind === 'pie' || kind === 'kpi';
export const tabular = (kind: VisualKind): boolean => kind === 'table' || kind === 'pivot';
export const visualDimensions = (visual: AuthorVisual): string[] => visual.kind === 'kpi' ? [] : tabular(visual.kind)
  ? [...visual.rows, ...visual.columns] : visual.dimension === null ? [] : [visual.dimension];
const originalIds = (draft: AuthorDraft, visual: boolean): string[] => (draft.bundle?.original.members ?? []).flatMap(({ resource }) => resource.resourceType === 'analysis' || resource.resourceType === 'dashboard' ? (resource.definition.sheets ?? []).flatMap(s => visual ? (s.visuals ?? []).map(v => Object.values(v)[0]!.visualId) : [s.sheetId]) : []);
const nextId = (prefix: string, ids: string[]): string => {
  let n = 1;
  while (ids.includes(`${prefix}-${n}`)) n++;
  return `${prefix}-${n}`;
};
export const defaults = () => ({ rows: [] as string[], columns: [] as string[], titleVisible: true, legend: true, labels: false,
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
  | { type: 'hierarchy'; hierarchy: DimensionHierarchy | null }
  | { type: 'filter-actions'; actions: FilterAction[] }
  | { type: 'import'; draft: AuthorDraft }
  | { type: 'parameter-add'; parameter: Omit<AuthorParameter, 'id'> }
  | { type: 'parameter-value'; id: string; values: ParameterValue[] }
  | { type: 'parameter-default'; id: string; values: ParameterValue[] }
  | { type: 'remap'; id: string }
  | { type: 'sheet-remap'; id: string }
  | { type: 'analysis-title'; title: string }
  | { type: 'sheet-add' }
  | { type: 'control-add'; control: Omit<AuthorControl, 'id'> }
  | { type: 'control-remove'; id: string }
  | { type: 'control-move'; id: string; offset: -1 | 1 }
  | { type: 'control-bind'; id: string; parameterId: string }
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
  | { type: 'filter-parameter'; columnName: string; parameterName: string; operator?: CategoryFilter['operator'] }
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
  if (action.type === 'import') { validateDraft(action.draft); return action.draft; }
  if (action.type === 'parameter-add') {
    const p = { ...action.parameter, id: nextId('parameter', draft.parameters.map(p => p.id)) };
    if (parameterError(p) || draft.parameters.some(e => e.name === p.name && (!e.memberPath || !p.memberPath || e.memberPath === p.memberPath))) return draft;
    return { ...draft, parameters: [...draft.parameters, p] };
  }
  if (action.type === 'parameter-value' || action.type === 'parameter-default') return { ...draft, parameters: draft.parameters.map(p => p.id !== action.id || parameterValueError(p, action.values) ? p : { ...p, [action.type === 'parameter-value' ? 'values' : 'defaultValues']: [...action.values] }) };
  if (action.type === 'analysis-title') return { ...draft, title: action.title };
  if (action.type === 'calculation-add') {
    if (calculationError(action.field, dataFields(draft.calculatedFields))) return draft;
    return { ...draft, calculatedFields: [...draft.calculatedFields, { ...action.field, name: action.field.name.trim() }] };
  }
  if (action.type === 'sheet-add') {
    const id = nextId('sheet', [...draft.sheets.map(s => s.id), ...originalIds(draft, false)]);
    return { ...draft, sheets: [...draft.sheets, newSheet(id, `Sheet ${id.slice(6)}`)], activeSheetId: id };
  }
  if (action.type === 'sheet-select') return draft.sheets.some(s => s.id === action.id) ? { ...draft, activeSheetId: action.id } : draft;
  if (action.type === 'sheet-remap') return { ...draft, sheets: draft.sheets.map(s => s.id === action.id
    ? { ...s, visuals: s.visuals.map(v => v.imported && !v.imported.local ? remapVisual(v) : v) } : s) };
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
  if (action.type === 'control-add') {
    const source = draft.bundle?.original.members.find(m => m.path === sheet.imported?.memberPath)?.resource;
    const raw = source && (source.resourceType === 'analysis' || source.resourceType === 'dashboard') ? source.definition.sheets?.find(s => s.sheetId === sheet.imported?.sheetId)?.parameterControls : undefined;
    const reserved = Array.isArray(raw) ? raw.flatMap(value => { const body = Object.values(value as Record<string, unknown>)[0]; return isObject(body) && typeof body.parameterControlId === 'string' ? [body.parameterControlId] : []; }) : [];
    const c = { ...action.control, ...(action.control.source?.local ? { source: { ...action.control.source, dataSetIdentifier: draft.bundle?.primaryPath ? 'opensight_local_sales' : 'sales_data' } } : {}), id: nextId('control', [...sheet.controls.map(c => c.id), ...reserved]) };
    if (controlError(c, sheetParameters(draft))) return draft;
    try { validateControls([...sheet.controls, c], sheetParameters(draft)); } catch { return draft; }
    return update({ controls: [...sheet.controls, c] });
  }
  if (action.type === 'control-remove') return update({ controls: sheet.controls.filter(c => c.id !== action.id).map(c => ({ ...c, ...(c.cascade ? { cascade: c.cascade.filter(p => p.controlId !== action.id) } : {}) })) });
  if (action.type === 'control-bind') return update({ controls: sheet.controls.map(c => c.id !== action.id || controlError({ ...c, parameterId: action.parameterId }, sheetParameters(draft)) ? c : { ...c, parameterId: action.parameterId }) });
  if (action.type === 'control-move') {
    const controls = [...sheet.controls], i = controls.findIndex(c => c.id === action.id), j = i + action.offset;
    if (i < 0 || j < 0 || j >= controls.length) return draft;
    [controls[i], controls[j]] = [controls[j]!, controls[i]!]; return update({ controls });
  }
  if (action.type === 'add') {
    const id = nextId('visual', [...draft.sheets.flatMap(s => s.visuals.map(v => v.id)), ...originalIds(draft, true)]);
    const dimension = action.kind === 'kpi' ? null : action.kind === 'line' ? 'order_date' : action.kind === 'pie' ? 'category' : 'region';
    const visual: AuthorVisual = { ...defaults(), id, kind: action.kind, title: '', donut: false, dimension, measures: ['revenue'],
      rows: tabular(action.kind) && dimension ? [dimension] : [], labels: action.kind === 'pie' };
    const bottom = Math.max(0, ...sheet.layout.map(p => p.y + p.h));
    return update({ visuals: [...sheet.visuals, visual], selectedId: id, layout: [...sheet.layout, { i: id, x: 0, y: bottom, w: 6, h: 8 }] });
  }
  if (action.type === 'remap') return update({ visuals: sheet.visuals.map(v => v.id === action.id ? remapVisual(v) : v) });
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
      case 'kind': return { ...visual, ...(visual.imported ? { imported: { ...visual.imported, replaced: visual.imported.replaced || action.kind !== visual.kind || visual.imported.issues.some(i => i.startsWith('Unsupported visual type:')) } } : {}), kind: action.kind, donut: action.kind === 'pie' && visual.donut,
        dimension: action.kind === 'kpi' ? null : visual.dimension,
        rows: tabular(action.kind) ? (tabular(visual.kind) ? visual.rows : visual.dimension ? [visual.dimension] : []) : [],
        columns: action.kind === 'pivot' ? visual.columns : [],
        measures: singleMeasure(action.kind) ? visual.measures.slice(0, 1) : visual.measures };
      case 'hierarchy': {
        if (!action.hierarchy) { const { hierarchy: _old, ...rest } = visual; return rest; }
        if (visual.kind === 'kpi' || hierarchyError(action.hierarchy, draft.calculatedFields)) return visual;
        const root = action.hierarchy.levels[0]!.columnName;
        return { ...visual, hierarchy: action.hierarchy, dimension: root, ...(tabular(visual.kind) ? { rows: [root, ...visual.rows.slice(1).filter(f => f !== root)], columns: visual.columns.filter(f => f !== root) } : {}) };
      }
      case 'filter-actions': return validFilterActions(action.actions) ? { ...visual, filterActions: action.actions } : visual;
      case 'title': return { ...visual, title: action.title };
      case 'donut': return { ...visual, donut: visual.kind === 'pie' && action.donut };
      case 'display': return { ...visual, [action.property]: action.value };
      case 'filter-parameter': {
        const p = sheetParameters(draft).find(p => p.name === action.parameterName), field = dataFields(draft.calculatedFields).find(f => f.name === action.columnName);
        const type = field?.type === 'STRING' ? 'string' : field?.type === 'DATETIME' ? 'datetime' : 'number';
        if (!p || !field || p.type !== type || action.operator && action.operator !== 'EQUALS' && (p.multiple || p.type === 'string')) return visual;
        return { ...visual, filters: [...visual.filters.filter(f => f.columnName !== action.columnName), { columnName: action.columnName, values: [], parameterName: p.name, operator: action.operator ?? 'EQUALS' }] };
      }
      case 'filter': {
        if (!dataFields(draft.calculatedFields).some(f => f.name === action.columnName && (f.type === 'STRING' || action.values === null))) return visual;
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

/** Explicit remapping authorizes only matching sales columns; it never guesses by ARN. */
export function remapVisual(visual: AuthorVisual): AuthorVisual {
  if (!visual.imported) return visual;
  const missing = new Set<string>();
  const match = (names: string[], role: string): string[] => names.flatMap(name => {
    const field = SALES_FIELDS.find(f => f.role === role && f.name.toLowerCase() === name.toLowerCase());
    if (!field) { missing.add(name); return []; }
    return [field.name];
  }).filter((name, index, all) => all.indexOf(name) === index);
  const rows = match(visual.rows, 'dimension'), columns = match(visual.columns, 'dimension').filter(n => !rows.includes(n));
  const dimension = tabular(visual.kind) ? rows[0] ?? null : match(visual.dimension ? [visual.dimension] : [], 'dimension')[0] ?? null;
  const measures = match(visual.measures, 'measure');
  const filters = visual.filters.flatMap(f => {
    const field = SALES_FIELDS.find(c => (f.parameterName || c.type === 'STRING') && c.name.toLowerCase() === f.columnName.toLowerCase());
    if (!field) { missing.add(f.columnName); return []; }
    return [{ ...f, columnName: field.name }];
  });
  return { ...visual, rows, columns, dimension, measures, filters, imported: { ...visual.imported, local: true, remapped: true, unmappedFields: [...missing] } };
}
export function authorVisualProblem(visual: AuthorVisual): string | undefined {
  if (!visual.imported) return;
  if (!visual.imported.local) return `Unresolved dataset: ${visual.imported.dataSets.map(d => d.arn ?? d.identifier).join(', ') || 'no dataset binding'}`;
  const issues = visual.imported.replaced ? visual.imported.issues.filter(i => i.startsWith('Filter group ') || i.startsWith('Calculated field ')) : visual.imported.issues;
  if (issues.length) return `Unsupported features: ${issues.join('; ')}`;
}

function columnField(name: string): BundleColumnField {
  return { fieldId: name, column: { dataSetIdentifier: 'sales_data', columnName: name } };
}
function dimensionField(name: string, granularity: DateGrain = 'MONTH'): BundleDimensionField {
  return name === 'order_date' ? { dateDimensionField: { ...columnField(name), dateGranularity: granularity } }
    : name === 'order_id' ? { numericalDimensionField: columnField(name) } : { categoricalDimensionField: columnField(name) };
}
/** Typed camelCase projection, including the parser's opaque extensions. */
export function serializeVisual(visual: AuthorVisual): BundleVisual {
  const category = visualDimensions(visual).map(name => dimensionField(name, visual.dateGrain));
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
    case 'pivot': return { pivotTableVisual: { ...body, chartConfiguration: { ...pivotTotals, fieldWells: { pivotTableAggregatedFieldWells: { rows: visual.rows.map(name => dimensionField(name, visual.dateGrain)), columns: visual.columns.map(name => dimensionField(name, visual.dateGrain)), values } } } } };
    case 'kpi': return { kpiVisual: { ...body, chartConfiguration: { fieldWells: { values } } } };
  }
}
/** Export the analysis, including sheet layouts and scoped filters, but never result rows or UI selection. */
export function serializeDraft(draft: AuthorDraft): BundleAnalysis {
  validateDraft(draft);
  return { resourceType: 'analysis', analysisId: 'authored-analysis', name: draft.title.trim() || 'Untitled analysis', definition: {
    dataSetIdentifierDeclarations: [{ identifier: 'sales_data', dataSetArn: 'arn:aws:quicksight:us-east-1:123456789012:dataset/renderable-sales' }],
    ...(draft.parameters.length ? { parameterDeclarations: draft.parameters.map(serializeParameter) } : {}),
    calculatedFields: draft.calculatedFields.map(({ name, expression }) => ({ dataSetIdentifier: 'sales_data', name, expression })),
    filterGroups: draft.sheets.flatMap(sheet => sheet.visuals.flatMap(visual => visual.filters.map((filter, index) => ({
      filterGroupId: `${visual.id}-filter-${index}`, status: 'ENABLED', crossDataset: 'SINGLE_DATASET',
      scopeConfiguration: { selectedSheets: { sheetVisualScopingConfigurations: [{ sheetId: sheet.id, scope: 'SELECTED_VISUALS', visualIds: [visual.id] }] } },
      filters: [serializeFilter(filter, `${visual.id}-filter-${index}`, 'sales_data', sheetParameters(draft, sheet))],
    })))),
    sheets: draft.sheets.map(sheet => ({ sheetId: sheet.id, name: sheet.name, ...(sheet.controls.length ? { parameterControls: sheet.controls.map(c => serializeControl(c, sheetParameters(draft, sheet), sheet.controls)) } : {}), visuals: sheet.visuals.map(visual => {
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
  if (!isObject(value) || !onlyKeys(value, ['version', 'title', 'sheets', 'activeSheetId', 'calculatedFields', 'parameters', 'bundle']) || value.version !== 2 || typeof value.title !== 'string' || !Array.isArray(value.sheets) || !value.sheets.length || !Array.isArray(value.calculatedFields)) return fail();
  validateAuthorParameters(value.parameters);
  if (value.bundle !== undefined) {
    const b = value.bundle;
    if (!isObject(b) || !onlyKeys(b, ['original', 'primaryPath', 'title', 'report', 'calculations', 'emptySheetId']) || typeof b.primaryPath !== 'string' || typeof b.title !== 'string' || (b.emptySheetId !== undefined && typeof b.emptySheetId !== 'string') || !Array.isArray(b.report) || !Array.isArray(b.calculations)) return fail();
    const summary = summarizeQsBundle(b.original as QsBundle);
    if (!summary.memberCount || (b.primaryPath && !summary.members.some(m => m.path === b.primaryPath && (m.resourceType === 'analysis' || m.resourceType === 'dashboard'))) || !b.report.every(r => isObject(r) && typeof r.path === 'string' && typeof r.name === 'string' && Array.isArray(r.messages) && r.messages.every(m => typeof m === 'string')) || !b.calculations.every(c => isObject(c) && typeof c.name === 'string' && typeof c.expression === 'string' && (c.role === 'measure' || c.role === 'dimension'))) return fail();
  }
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
    if (!isObject(sheet) || !onlyKeys(sheet, ['id', 'name', 'controls', 'visuals', 'layout', 'selectedId', 'imported']) || typeof sheet.id !== 'string' || !/^sheet-[1-9][0-9]*$/.test(sheet.id) || sheetIds.has(sheet.id) || typeof sheet.name !== 'string' || !sheet.name.trim() || !Array.isArray(sheet.visuals) || !Array.isArray(sheet.layout)) return fail();
    if (sheet.imported !== undefined && (!value.bundle || !isObject(sheet.imported) || typeof sheet.imported.memberPath !== 'string' || typeof sheet.imported.sheetId !== 'string' || typeof sheet.imported.name !== 'string' || !Array.isArray(sheet.imported.layout))) return fail();
    const origin = isObject(value.bundle) ? value.bundle.original as QsBundle : undefined;
    const source = isObject(sheet.imported) ? origin?.members.find(m => m.path === (sheet.imported as Record<string, unknown>).memberPath)?.resource : undefined;
    const sourceSheet = source && (source.resourceType === 'analysis' || source.resourceType === 'dashboard') ? source.definition.sheets?.find(s => s.sheetId === (sheet.imported as Record<string, unknown>).sheetId) : undefined;
    if (sheet.imported !== undefined && (!sourceSheet || !(sheet.imported as Record<string, unknown>).layout || !(sheet.imported as { layout: unknown[] }).layout.every(p => isObject(p) && typeof p.i === 'string' && [p.x, p.y, p.w, p.h].every(Number.isSafeInteger)))) return fail();
    const parameters = (value.parameters as AuthorParameter[]).filter(p => !p.memberPath || p.memberPath === (isObject(sheet.imported) ? sheet.imported.memberPath : isObject(value.bundle) ? value.bundle.primaryPath : undefined));
    validateControls(sheet.controls, parameters);
    if (isObject(sheet.imported) && sheet.imported.controls !== undefined) validateControls(sheet.imported.controls, parameters);
    sheetIds.add(sheet.id);
    for (const v of sheet.visuals) {
      const imported = isObject(v) && isObject(v.imported) ? v.imported : undefined;
      if (isObject(v) && v.imported !== undefined) {
        if (!value.bundle || !imported || typeof imported.visualId !== 'string' || typeof imported.variant !== 'string' || typeof imported.local !== 'boolean' || (imported.replaced !== undefined && typeof imported.replaced !== 'boolean') || (imported.remapped !== undefined && typeof imported.remapped !== 'boolean') || !isObject(imported.baseline) || !Array.isArray(imported.dataSets) || !imported.dataSets.every(d => isObject(d) && typeof d.identifier === 'string' && (d.arn === undefined || typeof d.arn === 'string')) || !Array.isArray(imported.issues) || !imported.issues.every(i => typeof i === 'string') || !Array.isArray(imported.unmappedFields) || !imported.unmappedFields.every(i => typeof i === 'string') || !Array.isArray(imported.filterGroups) || !imported.filterGroups.every(g => isObject(g) && typeof g.id === 'string' && typeof g.columnName === 'string')) return fail();
      }
      if (imported) {
        const baseline = imported.baseline as Record<string, unknown>;
        const strings = (a: unknown): a is string[] => Array.isArray(a) && a.every(n => typeof n === 'string' && !!n && !n.includes('\0'));
        if (!sourceSheet?.visuals?.some(raw => raw[imported.variant as string]?.visualId === imported.visualId) || !isObject(v) || baseline.id !== v.id || !VISUAL_TYPES.some(t => t.kind === baseline.kind) || typeof baseline.title !== 'string' || (baseline.dimension !== null && typeof baseline.dimension !== 'string') || !['rows', 'columns', 'measures'].every(k => strings(baseline[k])) || !['donut', 'titleVisible', 'legend', 'labels', 'horizontal', 'stacked', 'totals', 'subtotals'].every(k => typeof baseline[k] === 'boolean') || !Array.isArray(baseline.filters) || !baseline.filters.every(f => isObject(f) && typeof f.columnName === 'string' && Array.isArray(f.values) && f.values.every(n => typeof n === 'string'))) return fail();
      }
      const fieldNames = (v: unknown, role: string): v is string[] => imported ? Array.isArray(v) && v.every(n => typeof n === 'string' && !!n && !n.includes('\0')) && new Set(v).size === v.length : names(v, role);

      if (!isObject(v) || !onlyKeys(v, ['id', 'kind', 'title', 'dimension', 'measures', 'donut', 'imported', 'filterActions', 'hierarchy', ...Object.keys(defaults())]) || typeof v.id !== 'string' || !/^visual-[1-9][0-9]*$/.test(v.id) || ids.has(v.id) || !VISUAL_TYPES.some(t => t.kind === v.kind) || typeof v.title !== 'string' || !['donut', 'titleVisible', 'legend', 'labels', 'horizontal', 'stacked', 'totals', 'subtotals'].every(k => typeof v[k] === 'boolean') || !fieldNames(v.measures, 'measure') || !fieldNames(v.rows, 'dimension') || !fieldNames(v.columns, 'dimension') || (v.dimension !== null && !fieldNames([v.dimension], 'dimension')) || !Array.isArray(v.filters)) return fail();
      if ((v.kind === 'kpi' || v.kind === 'pie') && v.measures.length > 1 || v.kind === 'kpi' && v.dimension !== null || v.kind !== 'pie' && v.donut || v.kind !== 'pivot' && v.columns.length || (v.kind === 'table' || v.kind === 'pivot' ? v.dimension !== (v.rows[0] ?? null) : v.rows.length) || v.rows.some(n => (v.columns as string[]).includes(n))) return fail();
      if (v.hierarchy !== undefined && hierarchyError(v.hierarchy as DimensionHierarchy, calculations, !!imported)) return fail();
      if (v.filterActions !== undefined && !validFilterActions(v.filterActions)) return fail();
      const filters = new Set<string>();
      for (const f of v.filters) {
        if (!isObject(f) || !onlyKeys(f, ['columnName', 'values', 'parameterName', 'operator']) || typeof f.columnName !== 'string' || filters.has(f.columnName) || (!imported && !fields.some(field => field.name === f.columnName && (f.parameterName !== undefined || field.type === 'STRING'))) || !Array.isArray(f.values) || !f.values.every(n => typeof n === 'string' && !n.includes('\0')) || new Set(f.values).size !== f.values.length) return fail();
        if (f.parameterName !== undefined && (typeof f.parameterName !== 'string' || !parameters.some(p => p.name === f.parameterName)) || f.operator !== undefined && !['EQUALS', 'GREATER_THAN_OR_EQUAL_TO', 'LESS_THAN_OR_EQUAL_TO'].includes(String(f.operator))) return fail();
        if (f.parameterName !== undefined) {
          const p = parameters.find(p => p.name === f.parameterName)!;
          const field = fields.find(c => c.name === f.columnName);
          if (!imported && (!field || p.type !== (field.type === 'STRING' ? 'string' : field.type === 'DATETIME' ? 'datetime' : 'number')) || f.operator && f.operator !== 'EQUALS' && (p.type === 'string' || p.multiple) || f.values.length) return fail();
        }
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
  if (isObject(value) && value.version === 2) return { parameters: [], ...value, sheets: Array.isArray(value.sheets) ? value.sheets.map(s => isObject(s) ? { controls: [], ...s } : s) : value.sheets };
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
