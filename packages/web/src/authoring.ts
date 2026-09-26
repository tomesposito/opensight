import type { BundleColumnField, BundleDimensionField, BundleMeasureField, BundleVisual, BundleVisualBody } from '@opensight/bundle-parser';
import { normalizeVisual } from './compiler.js';

export const SALES_FIELDS = [
  { name: 'order_id', role: 'dimension', type: 'INTEGER' },
  { name: 'order_date', role: 'dimension', type: 'DATETIME' },
  { name: 'region', role: 'dimension', type: 'STRING' },
  { name: 'category', role: 'dimension', type: 'STRING' },
  { name: 'revenue', role: 'measure', type: 'DECIMAL' },
  { name: 'profit', role: 'measure', type: 'DECIMAL' },
] as const;
export type FieldName = typeof SALES_FIELDS[number]['name'];
export type DimensionName = Extract<typeof SALES_FIELDS[number], { role: 'dimension' }>['name'];
export type MeasureName = Extract<typeof SALES_FIELDS[number], { role: 'measure' }>['name'];
export const VISUAL_TYPES = [
  { kind: 'bar', label: 'Bar' }, { kind: 'line', label: 'Line' },
  { kind: 'pie', label: 'Pie / donut' }, { kind: 'kpi', label: 'KPI' }, { kind: 'table', label: 'Table' },
] as const;
export type VisualKind = typeof VISUAL_TYPES[number]['kind'];
export interface AuthorVisual {
  id: string;
  kind: VisualKind;
  title: string;
  dimension: DimensionName | null;
  measures: MeasureName[];
  donut: boolean;
}
export interface AuthorDraft {
  version: 1;
  visuals: AuthorVisual[];
  selectedId: string | null;
}
export const emptyDraft = (): AuthorDraft => ({ version: 1, visuals: [], selectedId: null });
export const dimensionLabel = (kind: VisualKind): string => kind === 'line' ? 'X-axis' : kind === 'table' ? 'Group-by' : 'Category';
export const singleMeasure = (kind: VisualKind): boolean => kind === 'pie' || kind === 'kpi';

export type AuthorAction =
  | { type: 'add'; kind: VisualKind }
  | { type: 'select'; id: string }
  | { type: 'remove'; id: string }
  | { type: 'move'; id: string; offset: -1 | 1 }
  | { type: 'kind'; kind: VisualKind }
  | { type: 'title'; title: string }
  | { type: 'donut'; donut: boolean }
  | { type: 'assign'; field: FieldName }
  | { type: 'unassign'; field: FieldName };

/** Immutable UI transitions; single-field wells replace, multi-value wells append once. */
export function authorReducer(draft: AuthorDraft, action: AuthorAction): AuthorDraft {
  if (action.type === 'add') {
    let number = 1;
    while (draft.visuals.some(v => v.id === `visual-${number}`)) number++;
    const visual: AuthorVisual = {
      id: `visual-${number}`, kind: action.kind, title: '', donut: false,
      dimension: action.kind === 'kpi' ? null : action.kind === 'line' ? 'order_date' : action.kind === 'pie' ? 'category' : 'region',
      measures: ['revenue'],
    };
    return { ...draft, visuals: [...draft.visuals, visual], selectedId: visual.id };
  }
  if (action.type === 'select') return draft.visuals.some(v => v.id === action.id) ? { ...draft, selectedId: action.id } : draft;
  if (action.type === 'remove' || action.type === 'move') {
    const index = draft.visuals.findIndex(v => v.id === action.id);
    if (index < 0) return draft;
    const visuals = [...draft.visuals];
    if (action.type === 'move') {
      const target = index + action.offset;
      if (target < 0 || target >= visuals.length) return draft;
      [visuals[index], visuals[target]] = [visuals[target]!, visuals[index]!];
      return { ...draft, visuals };
    }
    visuals.splice(index, 1);
    return { ...draft, visuals, selectedId: draft.selectedId === action.id ? (visuals[Math.min(index, visuals.length - 1)]?.id ?? null) : draft.selectedId };
  }
  return { ...draft, visuals: draft.visuals.map(visual => {
    if (visual.id !== draft.selectedId) return visual;
    switch (action.type) {
      case 'kind': return {
        ...visual, kind: action.kind, donut: action.kind === 'pie' && visual.donut,
        dimension: action.kind === 'kpi' ? null : visual.dimension,
        measures: singleMeasure(action.kind) ? visual.measures.slice(0, 1) : visual.measures,
      };
      case 'title': return { ...visual, title: action.title };
      case 'donut': return { ...visual, donut: visual.kind === 'pie' && action.donut };
      case 'unassign': return { ...visual, dimension: visual.dimension === action.field ? null : visual.dimension, measures: visual.measures.filter(f => f !== action.field) };
      case 'assign': {
        const field = SALES_FIELDS.find(f => f.name === action.field);
        if (!field) return visual;
        if (field.role === 'dimension') return visual.kind === 'kpi' ? visual : { ...visual, dimension: field.name };
        return { ...visual, measures: singleMeasure(visual.kind) ? [field.name] : [...new Set([...visual.measures, field.name])] };
      }
    }
  }) };
}

function columnField(name: FieldName): BundleColumnField {
  return { fieldId: name, column: { dataSetIdentifier: 'sales_data', columnName: name } };
}

/** Typed camelCase renderer projection, including the parser's opaque extensions. */
export function serializeVisual(visual: AuthorVisual): BundleVisual {
  const category: BundleDimensionField[] = visual.dimension === null ? [] : [
    visual.dimension === 'order_date'
      ? { dateDimensionField: { ...columnField(visual.dimension), dateGranularity: 'MONTH' } }
      : visual.dimension === 'order_id'
        ? { numericalDimensionField: columnField(visual.dimension) }
        : { categoricalDimensionField: columnField(visual.dimension) },
  ];
  const values: BundleMeasureField[] = visual.measures.map(name => ({
    numericalMeasureField: { ...columnField(name), aggregationFunction: { simpleNumericalAggregation: 'SUM' } },
  }));
  const body = {
    visualId: visual.id,
    ...(visual.title.trim() ? { title: { visibility: 'VISIBLE', formatText: { plainText: visual.title.trim() } } } : {}),
  } satisfies BundleVisualBody;
  switch (visual.kind) {
    case 'pie': return { pieChartVisual: { ...body, chartConfiguration: {
      fieldWells: { pieChartAggregatedFieldWells: { category, values } },
      donutOptions: { arcOptions: { arcThickness: visual.donut ? 'MEDIUM' : 'WHOLE' } },
    } } } satisfies BundleVisual;
    case 'bar': return { barChartVisual: { ...body, chartConfiguration: { fieldWells: { barChartAggregatedFieldWells: { category, values } } } } };
    case 'line': return { lineChartVisual: { ...body, chartConfiguration: { fieldWells: { lineChartAggregatedFieldWells: { category, values } } } } };
    case 'table': return { tableVisual: { ...body, chartConfiguration: { fieldWells: { tableAggregatedFieldWells: { groupBy: category, values } } } } };
    case 'kpi': return { kpiVisual: { ...body, chartConfiguration: { fieldWells: { values } } } };
  }
}

/** Export only complete definitions; drafts can retain unfinished wells. */
export function serializeDraft(draft: AuthorDraft): BundleVisual[] {
  validateDraft(draft);
  return draft.visuals.map((visual, i) => {
    const definition = serializeVisual(visual);
    normalizeVisual('bundle', definition, `$[${i}]`);
    return definition;
  });
}

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const onlyKeys = (value: Record<string, unknown>, keys: string[]): boolean => Object.keys(value).every(key => keys.includes(key));

/** localStorage is untrusted; accept only v0 state, never executable definitions/rows. */
export function validateDraft(value: unknown): asserts value is AuthorDraft {
  const fail = (): never => { throw new Error('Invalid or unsupported author draft.'); };
  if (!isObject(value) || !onlyKeys(value, ['version', 'visuals', 'selectedId']) || value.version !== 1 || !Array.isArray(value.visuals)) return fail();
  const ids = new Set<string>();
  for (const item of value.visuals) {
    if (!isObject(item) || !onlyKeys(item, ['id', 'kind', 'title', 'dimension', 'measures', 'donut']) ||
      typeof item.id !== 'string' || !/^visual-[1-9][0-9]*$/.test(item.id) || ids.has(item.id) ||
      !VISUAL_TYPES.some(t => t.kind === item.kind) || typeof item.title !== 'string' || typeof item.donut !== 'boolean' ||
      (item.dimension !== null && !SALES_FIELDS.some(f => f.role === 'dimension' && f.name === item.dimension)) ||
      !Array.isArray(item.measures) || !item.measures.every(name => SALES_FIELDS.some(f => f.role === 'measure' && f.name === name)) ||
      new Set(item.measures).size !== item.measures.length ||
      ((item.kind === 'kpi' || item.kind === 'pie') && item.measures.length > 1) ||
      (item.kind === 'kpi' && item.dimension !== null) || (item.kind !== 'pie' && item.donut)) return fail();
    ids.add(item.id);
  }
  if (value.visuals.length ? typeof value.selectedId !== 'string' || !ids.has(value.selectedId) : value.selectedId !== null) fail();
}

export const DRAFT_KEY = 'opensight.author.v0';
type DraftStorage = Pick<Storage, 'getItem' | 'setItem'>;
type GetStorage = () => DraftStorage;
export function loadDraft(getStorage: GetStorage): { draft: AuthorDraft; warning?: string } {
  try {
    const saved = getStorage().getItem(DRAFT_KEY);
    if (saved === null) return { draft: emptyDraft() };
    const draft: unknown = JSON.parse(saved);
    validateDraft(draft);
    return { draft };
  } catch {
    return { draft: emptyDraft(), warning: 'The saved draft could not be restored. Your next edit will start a new draft.' };
  }
}
export function saveDraft(draft: AuthorDraft, getStorage: GetStorage): string {
  try {
    validateDraft(draft);
    getStorage().setItem(DRAFT_KEY, JSON.stringify(draft));
    return 'Draft saved on this device.';
  } catch {
    return 'Draft could not be saved on this device. Export JSON to keep your work.';
  }
}
