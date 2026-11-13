import { validOProvenance } from './o-provenance.js';
import { formatMetric } from './governed-metrics.js';
import { formatNumber, groupedPeriodDate, shiftDate, resultDate } from '@opensight/query-engine/browser';
import { computeForecast, forecastConfigValid, MIN_FORECAST_POINTS, type ForecastConfig } from './forecast.js';
import { convertDefinition } from './definition-converter.js';
import { InsightError, projectInsightBody, normalizeInsight } from './insight-configuration.js';
import { insightNarrative, type InsightNarrative } from './insight-narrative.js';
import { insightGraphic } from './insight-graphic.js';
import { LIGHT_THEME, themeValid, paletteValid } from './themes.js';
import { formattingValid, fieldName, matchingRule, LEGEND_POSITIONS, type LegendPosition } from './formatting.js';
import type { EChartsOption, BarSeriesOption, LineSeriesOption, PieSeriesOption } from 'echarts';
import type { Cell, Field, FixtureVisual, MultiplesOptions, Row, VisualModel } from './model.js';

import { EXTRA_VISUALS, extraKind, variantKinds, type VisualKind } from './visual-catalog.js';
import { compileExtra } from './extra-charts.js';
import { applyDisplayOptions, legendTextStyle } from './display-options.js';
import { FACETED_KINDS, applyFacetLimit, facetLayout, facetPanelGrids, facetTitles, groupRowsByFacet, type FacetGroup } from './facet-layout.js';

export const DATA_REQUIRED_LABEL = 'Needs data';

type ObjectValue = Record<string, unknown>;
type Input = Pick<FixtureVisual, 'source' | 'rows' | 'bindings' | 'path' | 'theme'> & { definition: unknown };
export interface CompiledVisual {
  model: VisualModel;
  narrative?: InsightNarrative;
  option: EChartsOption;
  /** Ordered, validated cells also used by the accessible HTML data table. */
  table: { columns: string[]; visibleColumns?: string[]; rows: Cell[][]; rowKinds?: ('detail' | 'subtotal' | 'total')[];
    /** Pivot layouts can move or hide measures; retain their identities for cell formatting. */
    dimensionCount?: number; measureIndices?: number[][];
    /** Typed row-group path per row (pivot only): subtotal rows carry their prefix, the grand total carries []. */
    rowGroupPaths?: Cell[][] };
  /** Quiet note rendered under the chart for a render-time forecast state
   *  (issue #235): insufficient history, or a skipped seasonal fit. */
  forecastNote?: string;
  state: 'ready' | 'empty' | 'unavailable';
}

export class CompileError extends Error {
  constructor(readonly path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'CompileError';
  }
}
function fail(path: string, message: string): never { throw new CompileError(path, message); }
function object(value: unknown, path: string): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'expected an object');
  return value as ObjectValue;
}
function list(value: unknown, path: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(path, 'expected an array');
  return value;
}
function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) fail(path, 'expected a nonempty string');
  return value;
}
function keys(value: ObjectValue, allowed: string[], path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`${path}.${key}`, 'unsupported property');
  }
}
function enumValue(value: unknown, choices: string[], fallback: string, path: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !choices.includes(value)) fail(path, `unsupported value; expected ${choices.join(', ')}`);
  return value;
}
/** OpenSight extension: persisted reference lines must be validated before they reach the model. */
function extensionReferenceLines(value: unknown, path: string): { referenceLines?: VisualModel['referenceLines'] } {
  if (value === undefined) return {};
  if (!Array.isArray(value)) fail(path, 'expected an array');
  return { referenceLines: value
    .filter(line => !!line && typeof line === 'object' && !Array.isArray(line) && typeof (line as { value?: unknown }).value === 'number' && Number.isFinite((line as { value: number }).value))
    .map(line => { const raw = line as { value: number; label?: unknown; color?: unknown }; return { value: raw.value, label: String(raw.label ?? ''), color: String(raw.color ?? '#c0392b') }; }) };
}

/** QuickSight LineChartConfiguration.ForecastConfigurations[0] → the model's
 *  forecast config (issue #235). Fail-closed on malformed shapes, like every
 *  other configuration gate; only the first configuration maps (the rest are
 *  noted in warnings by the caller-visible parse result). */
function parseForecastConfigurations(value: unknown, key: (a: string, b: string) => string, path: string): { forecast?: ForecastConfig; extra: number } {
  if (value === undefined) return { extra: 0 };
  if (!Array.isArray(value)) fail(path, 'expected an array');
  if (!value.length) return { extra: 0 };
  const raw = object(value[0], `${path}[0]`);
  keys(raw, [key('periodsForward', 'PeriodsForward'), key('periodsBackward', 'PeriodsBackward'), key('predictionInterval', 'PredictionInterval'), key('seasonality', 'Seasonality'), key('customSeasonalityValue', 'CustomSeasonalityValue'), key('upperBoundary', 'UpperBoundary'), key('lowerBoundary', 'LowerBoundary')], `${path}[0]`);
  const intIn = (v: unknown, fallback: number, name: string): number => {
    if (v === undefined) return fallback;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 100) fail(`${path}[0].${name}`, 'expected an integer between 0 and 100');
    return v as number;
  };
  const intervalRaw = raw[key('predictionInterval', 'PredictionInterval')];
  if (intervalRaw !== undefined && ![80, 90, 95].includes(intervalRaw as number)) fail(`${path}[0].${key('predictionInterval', 'PredictionInterval')}`, 'prediction interval must be 80, 90 or 95');
  const seasonalityRaw = enumValue(raw[key('seasonality', 'Seasonality')], ['AUTOMATIC', 'NONE', 'CUSTOM'], 'AUTOMATIC', `${path}[0].${key('seasonality', 'Seasonality')}`);
  const customRaw = raw[key('customSeasonalityValue', 'CustomSeasonalityValue')];
  if (seasonalityRaw === 'CUSTOM' && (typeof customRaw !== 'number' || !Number.isInteger(customRaw) || customRaw < 2 || customRaw > 366)) fail(`${path}[0].${key('customSeasonalityValue', 'CustomSeasonalityValue')}`, 'a custom seasonality period between 2 and 366 is required');
  const bound = (v: unknown, name: string): number | undefined => {
    if (v === undefined) return undefined;
    if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${path}[0].${name}`, 'expected a finite number');
    return v as number;
  };
  const forecast: ForecastConfig = {
    enabled: true,
    periodsForward: intIn(raw[key('periodsForward', 'PeriodsForward')], 3, key('periodsForward', 'PeriodsForward')),
    periodsBackward: intIn(raw[key('periodsBackward', 'PeriodsBackward')], 0, key('periodsBackward', 'PeriodsBackward')),
    predictionInterval: (intervalRaw ?? 95) as 80 | 90 | 95,
    seasonality: seasonalityRaw === 'AUTOMATIC' ? 'auto' : seasonalityRaw === 'NONE' ? 'none' : (customRaw as number),
    ...(bound(raw[key('lowerBoundary', 'LowerBoundary')], key('lowerBoundary', 'LowerBoundary')) !== undefined ? { lowerBoundary: bound(raw[key('lowerBoundary', 'LowerBoundary')], key('lowerBoundary', 'LowerBoundary')) } : {}),
    ...(bound(raw[key('upperBoundary', 'UpperBoundary')], key('upperBoundary', 'UpperBoundary')) !== undefined ? { upperBoundary: bound(raw[key('upperBoundary', 'UpperBoundary')], key('upperBoundary', 'UpperBoundary')) } : {}),
  };
  if (!forecastConfigValid(forecast)) fail(`${path}[0]`, 'invalid forecast configuration');
  return { forecast, extra: value.length - 1 };
}

/** OpenSight extension: per-extra-tooltip-field label and aggregation annotations. Fail-closed on malformed shape. */
function extensionTooltipExtras(value: unknown, path: string): Map<string, { label?: string; aggregation: 'SUM' | 'AVG' | 'MIN' | 'MAX' | 'COUNT' }> {
  const result = new Map<string, { label?: string; aggregation: 'SUM' | 'AVG' | 'MIN' | 'MAX' | 'COUNT' }>();
  if (value === undefined) return result;
  const ext = object(value, path);
  for (const [fieldId, entry] of Object.entries(ext)) {
    if (!fieldId || fieldId.includes('\0')) fail(path, 'invalid tooltip extra field id');
    const o = object(entry, `${path}.${fieldId}`);
    keys(o, ['label', 'aggregation'], `${path}.${fieldId}`);
    const label = o.label === undefined ? undefined : text(o.label, `${path}.${fieldId}.label`);
    if (label !== undefined && label.length > 128) fail(`${path}.${fieldId}.label`, 'label is too long');
    const aggregation = (o.aggregation === undefined ? 'SUM' : enumValue(o.aggregation, ['SUM', 'AVG', 'MIN', 'MAX', 'COUNT'], 'SUM', `${path}.${fieldId}.aggregation`)) as 'SUM' | 'AVG' | 'MIN' | 'MAX' | 'COUNT';
    result.set(fieldId, { ...(label ? { label } : {}), aggregation });
  }
  return result;
}

/** OpenSight extension: QuickSight's "Multiples Options" panel for pie small
 *  multiples, persisted as chartConfiguration.opensightMultiplesOptions.
 *  Fail-closed on malformed shapes (named errors); absent keeps today's
 *  automatic layout exactly. */
function parseMultiplesOptions(value: unknown, path: string): MultiplesOptions {
  const o = object(value, path);
  keys(o, ['visibleRows', 'visibleColumns', 'panelCount', 'title', 'border', 'gutter', 'background'], path);
  const invalid = (name: string, expected: string): never => fail(name ? `${path}.${name}` : path, `MULTIPLES_OPTIONS_INVALID: expected ${expected}`);
  const oneOf = <T extends string>(raw: unknown, choices: readonly T[], fallback: T, name: string): T => {
    if (raw === undefined) return fallback;
    if (typeof raw === 'string' && (choices as readonly string[]).includes(raw)) return raw as T;
    return invalid(name, `one of: ${choices.join(', ')}`);
  };
  const autoOrPositiveInt = (raw: unknown, name: string): 'auto' | number => {
    if (raw === undefined || raw === 'auto') return 'auto';
    if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 1) return raw;
    return invalid(name, '"auto" or a positive integer');
  };
  const panelCountRaw = o.panelCount === undefined ? 20 : o.panelCount;
  const panelCount = typeof panelCountRaw === 'number' && Number.isInteger(panelCountRaw) && panelCountRaw >= 1 && panelCountRaw <= 20
    ? panelCountRaw : invalid('panelCount', 'an integer from 1 to 20');
  const title = object(o.title ?? {}, `${path}.title`);
  keys(title, ['size', 'bold', 'italic', 'underline', 'align'], `${path}.title`);
  for (const flag of ['bold', 'italic', 'underline'] as const) if (title[flag] !== undefined && typeof title[flag] !== 'boolean') invalid(`title.${flag}`, 'a boolean');
  const border = object(o.border ?? {}, `${path}.border`);
  keys(border, ['enabled', 'widthPx', 'style', 'color'], `${path}.border`);
  if (border.enabled !== undefined && typeof border.enabled !== 'boolean') invalid('border.enabled', 'a boolean');
  const widthPxRaw = border.widthPx === undefined ? 1 : border.widthPx;
  const widthPx = typeof widthPxRaw === 'number' && Number.isFinite(widthPxRaw) && widthPxRaw > 0
    ? widthPxRaw : invalid('border.widthPx', 'a positive number');
  const colorRaw = border.color === undefined ? '#9aa3b2' : border.color;
  const color = typeof colorRaw === 'string' && /^#[0-9a-f]{6}$/i.test(colorRaw)
    ? colorRaw : invalid('border.color', 'a #rrggbb color');
  for (const flag of ['gutter', 'background'] as const) if (o[flag] !== undefined && typeof o[flag] !== 'boolean') invalid(flag, 'a boolean');
  return {
    visibleRows: autoOrPositiveInt(o.visibleRows, 'visibleRows'),
    visibleColumns: autoOrPositiveInt(o.visibleColumns, 'visibleColumns'),
    panelCount,
    title: {
      size: oneOf(title.size, ['small', 'medium', 'large'], 'small', 'title.size'),
      bold: title.bold === true, italic: title.italic === true, underline: title.underline === true,
      align: oneOf(title.align, ['left', 'center', 'right'], 'center', 'title.align'),
    },
    border: {
      enabled: border.enabled === true, widthPx,
      style: oneOf(border.style, ['solid', 'dashed', 'dotted'], 'solid', 'border.style'),
      color,
    },
    gutter: o.gutter === true,
    background: o.background === true,
  };
}

/** QuickSight SelectedTooltipType / FieldBasedTooltip → renderer tooltip detail. Fail-closed on bad enums; unknown field ids are reported, never rendered. */
function parseTooltipDetail(tooltip: ObjectValue, key: (archive: string, api: string) => string, path: string, fields: Field[]): { type: 'basic' | 'detailed'; titleType: 'primaryValue' | 'fieldId'; aggregations: boolean; hiddenFields: string[]; extraFields: { id: string; label?: string; aggregation: 'SUM' | 'AVG' | 'MIN' | 'MAX' | 'COUNT' }[] } | undefined {
  const typeKey = key('selectedTooltipType', 'SelectedTooltipType');
  const fieldKey = key('fieldBasedTooltip', 'FieldBasedTooltip');
  if (tooltip[typeKey] === undefined && tooltip[fieldKey] === undefined) return undefined;
  const type = enumValue(tooltip[typeKey], ['BASIC', 'DETAILED'], 'BASIC', `${path}.${typeKey}`) === 'DETAILED' ? 'detailed' : 'basic';
  const fb = object(tooltip[fieldKey] ?? {}, `${path}.${fieldKey}`);
  const extrasKey = key('opensightTooltipExtras', 'OpensightTooltipExtras');
  keys(fb, [key('aggregationVisibility', 'AggregationVisibility'), key('tooltipTitleType', 'TooltipTitleType'), key('tooltipFields', 'TooltipFields'), extrasKey], `${path}.${fieldKey}`);
  const aggregations = enumValue(fb[key('aggregationVisibility', 'AggregationVisibility')], ['VISIBLE', 'HIDDEN'], 'VISIBLE', `${path}.${fieldKey}`) === 'VISIBLE';
  const titleType = enumValue(fb[key('tooltipTitleType', 'TooltipTitleType')], ['PRIMARY_VALUE', 'FIELD_ID'], 'PRIMARY_VALUE', `${path}.${fieldKey}`) === 'FIELD_ID' ? 'fieldId' : 'primaryValue';
  const annotated = extensionTooltipExtras(fb[extrasKey], `${path}.${fieldKey}.${extrasKey}`);
  const fieldsKey = key('tooltipFields', 'TooltipFields');
  const itemsPath = `${path}.${fieldKey}.${fieldsKey}`;
  const rawFields = fb[fieldsKey];
  // Real QuickSight shape is a list of wrappers: [{ fieldTooltipItem: {...} }, ...].
  // The object shape { fieldTooltipItem: [...] } is accepted too (never emitted).
  const wrapped: unknown[] = rawFields === undefined ? []
    : Array.isArray(rawFields) ? rawFields.map((item, i) => {
      const o = object(item, `${itemsPath}[${i}]`);
      keys(o, [key('fieldTooltipItem', 'FieldTooltipItem')], `${itemsPath}[${i}]`);
      return o[key('fieldTooltipItem', 'FieldTooltipItem')];
    })
    : list(object(rawFields, itemsPath)[key('fieldTooltipItem', 'FieldTooltipItem')], itemsPath);
  const hiddenFields: string[] = [];
  const extraFields: { id: string; label?: string; aggregation: 'SUM' | 'AVG' | 'MIN' | 'MAX' | 'COUNT' }[] = [];
  const seenExtras = new Set<string>();
  wrapped.forEach((item, i) => {
    const o = object(item, `${itemsPath}[${i}]`);
    keys(o, [key('fieldId', 'FieldId'), key('visibility', 'Visibility')], `${itemsPath}[${i}]`);
    const fieldId = text(o[key('fieldId', 'FieldId')], `${itemsPath}[${i}]`);
    const visible = enumValue(o[key('visibility', 'Visibility')], ['VISIBLE', 'HIDDEN'], 'VISIBLE', `${itemsPath}[${i}]`) === 'VISIBLE';
    if (!fields.some(f => f.id === fieldId)) {
      // A tooltip field outside the visual's wells is an added dataset field (measures only;
      // dimensions would change the visual's grain and are refused upstream). The OpenSight
      // extension annotates label/aggregation; foreign bundles without it get SUM defaults.
      if (seenExtras.has(fieldId)) fail(`${itemsPath}[${i}]`, `duplicate tooltip field '${fieldId}'`);
      seenExtras.add(fieldId);
      const annotation = annotated.get(fieldId);
      extraFields.push({ id: fieldId, ...(annotation?.label ? { label: annotation.label } : {}), aggregation: annotation?.aggregation ?? 'SUM' });
      return;
    }
    if (!visible) hiddenFields.push(fieldId);
  });
  return { type, titleType, aggregations, hiddenFields, extraFields };
}

/** Explicit dialect selection; camelCase includes the API converter's projections. */
export function normalizeVisual(source: Input['source'], definition: Input['definition'], path = '$'): VisualModel {
  if (source !== 'api' && source !== 'bundle') fail(path, 'unknown definition dialect');
  if (source === 'api' && definition && typeof definition === 'object' && Object.hasOwn(definition, 'InsightVisual')) {
    const converted = convertDefinition({ DataSetIdentifierDeclarations: [], Sheets: [{ SheetId: 'insight', Visuals: [definition] }] });
    return normalizeVisual('bundle', converted.sheets![0]!.visuals![0], path);
  }
  const bundle = source === 'bundle';
  const key = (archive: string, api: string): string => bundle ? archive : api;
  const visual = object(definition, path);
  const entries = Object.entries(visual);
  if (entries.length !== 1) fail(path, 'expected exactly one visual variant');
  const [variant, raw] = entries[0]!;
  const kinds = bundle ? variantKinds : Object.fromEntries(Object.entries(variantKinds).map(([name, kind]) => [kind === 'waterfall' ? 'WaterfallVisual' : name === 'kpiVisual' ? 'KPIVisual' : name[0]!.toUpperCase() + name.slice(1), kind]));
  let kind = Object.hasOwn(kinds, variant) ? kinds[variant] : undefined;
  if (!kind) fail(`${path}.${variant}`, 'unsupported visual variant in this dialect');
  const p = `${path}.${variant}`;
  let body = object(raw, p);
  if (kind === 'insight') {
    try { body = projectInsightBody(body); } catch (error) { if (error instanceof InsightError) fail(p, error.message); throw error; }
  }
  keys(body, [...(kind === 'insight' ? ['insightConfiguration', 'dataSetIdentifier'] : []), key('opensightO', 'OpenSightO'), key('opensightFormatting', 'OpenSightFormatting'), key('opensightPalette', 'OpenSightPalette'), key('opensightReferenceLines', 'OpenSightReferenceLines'), key('visualId', 'VisualId'), key('title', 'Title'), key('subtitle', 'Subtitle'), key('chartConfiguration', 'ChartConfiguration'), key('actions', 'Actions'), key('columnHierarchies', 'ColumnHierarchies')], p);
  for (const name of [key('actions', 'Actions'), key('columnHierarchies', 'ColumnHierarchies')]) {
    if (list(body[name], `${p}.${name}`).length) fail(`${p}.${name}`, 'actions and drill hierarchies are not supported');
  }
  const provenance = body[key('opensightO', 'OpenSightO')];
  if (provenance !== undefined && !validOProvenance(provenance)) fail(p, 'invalid Ask O provenance');
  const palette = body[key('opensightPalette', 'OpenSightPalette')];
  if (palette !== undefined && !paletteValid(palette)) fail(p, 'invalid visual palette');
  const formatting = body[key('opensightFormatting', 'OpenSightFormatting')];
  if (formatting !== undefined && !formattingValid(formatting)) fail(p, 'invalid visual formatting');
  const id = text(body[key('visualId', 'VisualId')], p);
  const cpath = `${p}.${key('chartConfiguration', 'ChartConfiguration')}`;
  const config = object(body[key('chartConfiguration', 'ChartConfiguration')], cpath);
  const lineFamily = kind === 'line';
  if (kind === 'bar' && config[key('barsArrangement', 'BarsArrangement')] === 'STACKED_PERCENT') kind = 'bar100';
  if (kind === 'line' && config[key('type', 'Type')] === 'AREA') kind = 'area';
  const extra = extraKind(kind) ? EXTRA_VISUALS[kind] : undefined;
  const common = [key('fieldWells', 'FieldWells')];
  if (kind !== 'insight' && kind !== 'kpi' && kind !== 'table' && kind !== 'pivot') common.push(key('sortConfiguration', 'SortConfiguration'), key('dataLabels', 'DataLabels'), key('tooltip', 'Tooltip'), key('legend', 'Legend'));
  if (kind === 'pie') common.push(key('donutOptions', 'DonutOptions'));
  if (FACETED_KINDS.includes(kind)) common.push(key('opensightMultiplesOptions', 'OpenSightMultiplesOptions'));
  if (kind === 'bar' || kind === 'bar100') common.push(key('orientation', 'Orientation'), key('barsArrangement', 'BarsArrangement'));
  if (kind === 'table' || kind === 'pivot') common.push(key('totalOptions', 'TotalOptions'));
  if (kind === 'table') common.push(key('opensightSubtotalOptions', 'OpenSightSubtotalOptions'));
  if (kind === 'area') common.push(key('type', 'Type'));
  if (lineFamily) common.push(key('forecastConfigurations', 'ForecastConfigurations'));
  if (kind === 'gauge') common.push(key('opensightGauge', 'OpenSightGauge'));
  if (kind === 'histogram') common.push(key('opensightBins', 'OpenSightBins'));
  keys(config, common, cpath);
  const fpath = `${cpath}.${key('fieldWells', 'FieldWells')}`;
  const outer = object(config[key('fieldWells', 'FieldWells')], fpath);
  const wellsKey = extra ? (extra.wells ? key(extra.wells, extra.wells[0]!.toUpperCase() + extra.wells.slice(1)) : '') : kind === 'pie' ? key('pieChartAggregatedFieldWells', 'PieChartAggregatedFieldWells')
    : { bar: key('barChartAggregatedFieldWells', 'BarChartAggregatedFieldWells'), line: key('lineChartAggregatedFieldWells', 'LineChartAggregatedFieldWells'), table: key('tableAggregatedFieldWells', 'TableAggregatedFieldWells'), pivot: key('pivotTableAggregatedFieldWells', 'PivotTableAggregatedFieldWells'), kpi: '' }[kind as 'bar' | 'line' | 'table' | 'pivot' | 'kpi'];
  if (wellsKey) keys(outer, [wellsKey], fpath);
  const wells = wellsKey ? object(outer[wellsKey], `${fpath}.${wellsKey}`) : outer;
  const wpath = wellsKey ? `${fpath}.${wellsKey}` : fpath;
  const categoryKey = kind === 'pivot' ? key('rows', 'Rows') : kind === 'table' ? key('groupBy', 'GroupBy') : key('category', 'Category');
  const valueKey = key('values', 'Values');
  // Empty optional wells are harmless; nonempty colors/targets/trends change semantics.
  // Small multiples facets render as a grid of per-facet panels for the faceted
  // kinds; every other kind still rejects the well.
  const smallMultiplesKey = key('smallMultiples', 'SmallMultiples');
  const faceted = FACETED_KINDS.includes(kind);
  const unused = [key('colors', 'Colors'), key('targetValues', 'TargetValues'), key('trendGroups', 'TrendGroups'), ...(faceted ? [] : [smallMultiplesKey])];
  const wellKey = (name: string) => key(name, kind === 'waterfall' && name === 'category' ? 'Categories' : name.startsWith('opensight') ? `OpenSight${name.slice(9)}` : name[0]!.toUpperCase() + name.slice(1));
  keys(wells, [...(extra ? [...extra.dimensions, ...extra.measures].map(wellKey) : [categoryKey, valueKey]), ...(kind === 'pivot' ? [key('columns', 'Columns')] : []), ...(kind === 'waterfall' ? [key('breakdowns', 'Breakdowns')] : []), ...(faceted ? [smallMultiplesKey] : []), ...unused], wpath);
  for (const name of unused) if (list(wells[name], `${wpath}.${name}`).length) fail(`${wpath}.${name}`, 'field well not supported');
  const field = (value: unknown, measure: boolean, fp: string): Field => {
    const wrapper = object(value, fp);
    const variants = measure ? [key('numericalMeasureField', 'NumericalMeasureField')]
      : [key('categoricalDimensionField', 'CategoricalDimensionField'), key('dateDimensionField', 'DateDimensionField'), key('numericalDimensionField', 'NumericalDimensionField')];
    keys(wrapper, variants, fp);
    const pair = Object.entries(wrapper);
    if (pair.length !== 1) fail(fp, 'expected one supported field variant');
    const [name, content] = pair[0]!;
    const f = object(content, `${fp}.${name}`);
    keys(f, [key('fieldId', 'FieldId'), key('column', 'Column'), ...(measure ? [key('aggregationFunction', 'AggregationFunction')] : name === key('dateDimensionField', 'DateDimensionField') ? [key('dateGranularity', 'DateGranularity')] : [])], fp);
    if (measure) {
      const aggKey = key('aggregationFunction', 'AggregationFunction');
      const agg = object(f[aggKey], `${fp}.${aggKey}`);
      const sumKey = key('simpleNumericalAggregation', 'SimpleNumericalAggregation');
      keys(agg, [sumKey], fp);
      if (agg[sumKey] !== 'SUM' && !(String(object(f[key('column', 'Column')], fp)[key('columnName', 'ColumnName')]).startsWith('__metric_') && ['AVG', 'COUNT', 'MIN', 'MAX', 'DISTINCT_COUNT'].includes(String(agg[sumKey])))) fail(`${fp}.${aggKey}`, 'only explicit SUM result bindings are supported');
    }
    if (name === key('dateDimensionField', 'DateDimensionField')) enumValue(f[key('dateGranularity', 'DateGranularity')], ['DAY', 'MONTH', 'QUARTER', 'YEAR'], 'DAY', `${fp}.${key('dateGranularity', 'DateGranularity')}`);
    const column = object(f[key('column', 'Column')], `${fp}.${key('column', 'Column')}`);
    keys(column, [key('columnName', 'ColumnName'), key('dataSetIdentifier', 'DataSetIdentifier')], fp);
    return {
      id: text(f[key('fieldId', 'FieldId')], fp),
      column: text(column[key('columnName', 'ColumnName')], fp),
      dataSet: text(column[key('dataSetIdentifier', 'DataSetIdentifier')], fp),
      ...(name === key('dateDimensionField', 'DateDimensionField') ? { dateGranularity: (f[key('dateGranularity', 'DateGranularity')] ?? 'DAY') as Field['dateGranularity'] } : {}),
    };
  };
  const dimensionNames = extra ? extra.dimensions.map(wellKey) : [categoryKey];
  const measureNames = extra ? extra.measures.map(wellKey) : [valueKey];
  const rowDimensions = dimensionNames.flatMap(name => list(wells[name], `${wpath}.${name}`).map((v, i) => field(v, false, `${wpath}.${name}[${i}]`)));
  const columnDimensions = kind === 'pivot' ? list(wells[key('columns', 'Columns')], wpath).map((v, i) => field(v, false, `${wpath}.columns[${i}]`)) : [];
  const dimensions = [...rowDimensions, ...columnDimensions];
  const measures = measureNames.flatMap(name => list(wells[name], `${wpath}.${name}`).map((v, i) => field(v, true, `${wpath}.${name}[${i}]`)));
  // Small multiples: one facet dimension, rendered as a grid of per-facet panels.
  let facet: Field | undefined;
  if (faceted) {
    const sm = list(wells[smallMultiplesKey], `${wpath}.${smallMultiplesKey}`);
    if (sm.length > 1) fail(`${wpath}.${smallMultiplesKey}`, 'at most one Small multiples field is supported');
    if (sm.length) facet = field(sm[0], false, `${wpath}.${smallMultiplesKey}[0]`);
  }
  // Waterfall breakdowns (QuickSight Breakdowns well parity): one breakdown
  // dimension whose values interleave as floating delta bars between the
  // category subtotals. At most one; a measure here would change the
  // aggregation grain, so only dimensions are accepted.
  let breakdown: Field | undefined;
  if (kind === 'waterfall') {
    const bdKey = key('breakdowns', 'Breakdowns');
    const bd = list(wells[bdKey], `${wpath}.${bdKey}`);
    if (bd.length > 1) fail(`${wpath}.${bdKey}`, 'WATERFALL_BREAKDOWN_LIMIT: at most one Breakdowns field is supported');
    if (bd.length) breakdown = field(bd[0], false, `${wpath}.${bdKey}[0]`);
  }
  if (extra) {
    const d = dimensions.length, m = measures.length;
    if (kind === 'insight') {
      if (d !== 1) fail(wpath, 'INSIGHT_CATEGORY_REQUIRED: expected exactly one Category dimension');
      if (m < 1 || m > 2) fail(wpath, 'INSIGHT_VALUES_REQUIRED: expected one Values measure, or two for comparison');
      try { normalizeInsight(body.insightConfiguration ?? {}, dimensions, measures); }
      catch (error) { if (error instanceof InsightError) fail(cpath, error.message); throw error; }
      if (body.dataSetIdentifier !== undefined && measures.some(f => f.dataSet !== body.dataSetIdentifier)) fail(p, 'INSIGHT_FIELD_UNBOUND: dataset does not match computation fields');
    }
    if (kind === 'waterfall') {
      if (d !== 1) fail(wpath, 'WATERFALL_CATEGORY_REQUIRED: expected exactly one Categories dimension');
      if (m !== 1) fail(wpath, 'WATERFALL_VALUES_REQUIRED: expected exactly one Values measure');
    }
    if (kind === 'sankey') {
      if (list(wells[wellKey('source')], wpath).length !== 1) fail(wpath, 'SANKEY_SOURCE_REQUIRED: expected exactly one Source dimension');
      if (list(wells[wellKey('destination')], wpath).length !== 1) fail(wpath, 'SANKEY_DESTINATION_REQUIRED: expected exactly one Destination dimension');
      if (m !== 1) fail(wpath, 'SANKEY_WEIGHT_REQUIRED: expected exactly one Weight measure');
    }
    if (kind === 'radar') {
      if (list(wells[wellKey('category')], wpath).length !== 1) fail(wpath, 'RADAR_CATEGORY_REQUIRED: expected exactly one Category dimension');
      if (list(wells[wellKey('color')], wpath).length > 1) fail(wpath, 'RADAR_COLOR_LIMIT: expected at most one Color dimension');
      if (!m) fail(wpath, 'RADAR_VALUES_REQUIRED: expected one or more Values measures');
    }
    const validDimensions = kind === 'radar' ? d >= 1 && d <= 2 : kind === 'gauge' ? d === 0 : kind === 'scatter' || kind === 'histogram' ? d <= 1 : kind === 'heatmap' || kind === 'pointMap' || kind === 'sankey' ? d === 2 && dimensionNames.every(n => list(wells[n], wpath).length === 1) : kind === 'treemap' || kind === 'box' ? d >= 1 : d === 1;
    const validMeasures = kind === 'insight' ? m >= 1 && m <= 2 : kind === 'scatter' ? m >= 2 && m <= 3 && measureNames.slice(0, 2).every(n => list(wells[n], wpath).length === 1) && list(wells[measureNames[2]!], wpath).length <= 1 : kind === 'combo' ? m >= 2 && list(wells[measureNames[0]!], wpath).length === 1 && measureNames.every(n => list(wells[n], wpath).length >= 1) : kind === 'radar' || kind === 'bar100' || kind === 'area' ? m >= 1 : m === 1;
    if (!validDimensions || !validMeasures) fail(wpath, extra.note);
  } else {
    if (kind === 'kpi' ? dimensions.length !== 0 : kind === 'pivot' || kind === 'table' ? dimensions.length < 1 : dimensions.length !== 1) fail(wpath, kind === 'kpi' ? 'KPI must have no category' : 'exactly one category/group field is supported');
    if (!measures.length || ((kind === 'pie' || kind === 'kpi') && measures.length !== 1)) fail(wpath, 'expected supported number of measures (pie/KPI: one)');
  }
  const fields = [...dimensions, ...(breakdown ? [breakdown] : []), ...(facet ? [facet] : []), ...measures];
  if (new Set(fields.map(f => f.id)).size !== fields.length) fail(wpath, 'duplicate field IDs');
  if (new Set(fields.map(f => f.dataSet)).size !== 1) fail(wpath, 'multiple datasets are unsupported');
  const warnings: string[] = extra ? [`${p}: ${extra.note}`] : [];
  const gauge = object(config[key('opensightGauge', 'OpenSightGauge')] ?? {}, cpath);
  keys(gauge, ['min', 'max'], cpath);
  const gaugeMin = gauge.min ?? 0, gaugeMax = gauge.max ?? 100, bins = config[key('opensightBins', 'OpenSightBins')] ?? 10;
  if (typeof gaugeMin !== 'number' || typeof gaugeMax !== 'number' || !Number.isFinite(gaugeMin) || !Number.isFinite(gaugeMax) || gaugeMin >= gaugeMax) fail(cpath, 'gauge requires finite min < max');
  if (typeof bins !== 'number' || !Number.isInteger(bins) || bins < 1 || bins > 100) fail(cpath, 'histogram bins must be 1–100');
  const titleKey = key('title', 'Title');
  const title = object(body[titleKey] ?? {}, `${p}.${titleKey}`);
  keys(title, [key('visibility', 'Visibility'), key('formatText', 'FormatText')], `${p}.${titleKey}`);
  const format = object(title[key('formatText', 'FormatText')] ?? {}, `${p}.${titleKey}`);
  keys(format, [key('plainText', 'PlainText'), key('richText', 'RichText')], `${p}.${titleKey}`);
  const plain = format[key('plainText', 'PlainText')];
  if (plain !== undefined && typeof plain !== 'string') fail(`${p}.${titleKey}`, 'title must be text');
  if (format[key('richText', 'RichText')] !== undefined) warnings.push(`${p}.${titleKey}: rich title formatting is not rendered; using a plain fallback.`);
  const subtitleKey = key('subtitle', 'Subtitle');
  const subtitle = object(body[subtitleKey] ?? {}, `${p}.${subtitleKey}`);
  keys(subtitle, [key('visibility', 'Visibility'), key('formatText', 'FormatText')], `${p}.${subtitleKey}`);
  const subtitleFormat = object(subtitle[key('formatText', 'FormatText')] ?? {}, `${p}.${subtitleKey}`);
  keys(subtitleFormat, [key('plainText', 'PlainText'), key('richText', 'RichText')], `${p}.${subtitleKey}`);
  const subtitleText = subtitleFormat[key('plainText', 'PlainText')] ?? '';
  if (typeof subtitleText !== 'string') fail(`${p}.${subtitleKey}`, 'subtitle must be text');
  if (subtitleFormat[key('richText', 'RichText')] !== undefined) warnings.push(`${p}.${subtitleKey}: rich subtitle formatting is not rendered; using a plain fallback.`);
  const visibility = (o: ObjectValue, name: string, defaultValue = 'VISIBLE'): boolean => enumValue(o[name], ['VISIBLE', 'HIDDEN'], defaultValue, `${cpath}.${name}`) === 'VISIBLE';
  const totalVisibility = (raw: unknown, name: string): boolean => {
    const option = object(raw ?? {}, `${cpath}.${name}`);
    keys(option, [key('totalsVisibility', 'TotalsVisibility')], `${cpath}.${name}`);
    return visibility(option, key('totalsVisibility', 'TotalsVisibility'), 'HIDDEN');
  };
  let totals = false, subtotals = false, columnTotals = false, columnSubtotals = false;
  if (kind === 'pivot') {
    const totalOptions = object(config[key('totalOptions', 'TotalOptions')] ?? {}, cpath);
    const rowTotal = key('rowTotalOptions', 'RowTotalOptions'), colTotal = key('columnTotalOptions', 'ColumnTotalOptions');
    const rowSub = key('rowSubtotalOptions', 'RowSubtotalOptions'), colSub = key('columnSubtotalOptions', 'ColumnSubtotalOptions');
    keys(totalOptions, [rowTotal, colTotal, rowSub, colSub], cpath);
    totals = totalVisibility(totalOptions[rowTotal], rowTotal);
    columnTotals = totalVisibility(totalOptions[colTotal], colTotal);
    subtotals = totalVisibility(totalOptions[rowSub], rowSub);
    columnSubtotals = totalVisibility(totalOptions[colSub], colSub);
  } else if (kind === 'table') {
    totals = totalVisibility(config[key('totalOptions', 'TotalOptions')], 'totalOptions');
    subtotals = totalVisibility(config[key('opensightSubtotalOptions', 'OpenSightSubtotalOptions')], 'opensightSubtotalOptions');
  }
  const labels = object(config[key('dataLabels', 'DataLabels')] ?? {}, cpath);
  keys(labels, [key('visibility', 'Visibility'), key('overlap', 'Overlap')], cpath);
  enumValue(labels[key('overlap', 'Overlap')], ['DISABLE_OVERLAP'], 'DISABLE_OVERLAP', cpath);
  const tooltip = object(config[key('tooltip', 'Tooltip')] ?? {}, cpath);
  keys(tooltip, ['radar', 'sankey'].includes(kind) ? [key('tooltipVisibility', 'TooltipVisibility')] : [key('tooltipVisibility', 'TooltipVisibility'), key('selectedTooltipType', 'SelectedTooltipType'), key('fieldBasedTooltip', 'FieldBasedTooltip')], `${cpath}.${key('tooltip', 'Tooltip')}`);
  const tooltipPath = `${cpath}.${key('tooltip', 'Tooltip')}`;
  const tooltipDetail = parseTooltipDetail(tooltip, key, tooltipPath, [...dimensions, ...(breakdown ? [breakdown] : []), ...(facet ? [facet] : []), ...measures]);
  const legend = object(config[key('legend', 'Legend')] ?? {}, cpath);
  keys(legend, [key('visibility', 'Visibility'), key('position', 'Position')], cpath);
  let innerRadius = '0%';
  if (kind === 'pie') {
    const donut = object(config[key('donutOptions', 'DonutOptions')] ?? {}, cpath);
    keys(donut, [key('arcOptions', 'ArcOptions')], cpath);
    const arc = object(donut[key('arcOptions', 'ArcOptions')] ?? {}, cpath);
    keys(arc, [key('arcThickness', 'ArcThickness')], cpath);
    const thickness = enumValue(arc[key('arcThickness', 'ArcThickness')], ['WHOLE', 'SMALL', 'MEDIUM', 'LARGE'], 'WHOLE', cpath);
    innerRadius = ({ WHOLE: '0%', SMALL: '56%', MEDIUM: '42%', LARGE: '28%' } as const)[thickness as 'WHOLE' | 'SMALL' | 'MEDIUM' | 'LARGE'];
    if (thickness !== 'WHOLE') warnings.push(`${cpath}: donut radii are OpenSight approximations, not measured reference geometry.`);
  }
  // OpenSight extension: the Multiples Options panel persists its state for the
  // faceted kinds (other kinds fail the chartConfiguration key gate above,
  // like the well).
  const multiplesKey = key('opensightMultiplesOptions', 'OpenSightMultiplesOptions');
  const multiplesOptions = FACETED_KINDS.includes(kind) && config[multiplesKey] !== undefined
    ? parseMultiplesOptions(config[multiplesKey], `${cpath}.${multiplesKey}`) : undefined;
  // Forecast configurations (line family only; the key gate above rejects them
  // elsewhere). A stored config stays on the model even when it cannot apply —
  // a non-date category or an area chart — so it round-trips; rendering ignores
  // it and the warnings below say why.
  const forecastKey = key('forecastConfigurations', 'ForecastConfigurations');
  const parsedForecast = lineFamily ? parseForecastConfigurations(config[forecastKey], key, `${cpath}.${forecastKey}`) : { extra: 0 } as { forecast?: ForecastConfig; extra: number };
  const forecast = parsedForecast.forecast;
  if (parsedForecast.extra > 0) warnings.push(`${cpath}.${forecastKey}: ${parsedForecast.extra} additional forecast configuration${parsedForecast.extra === 1 ? '' : 's'} ignored; only the first is applied.`);
  if (forecast && !dimensions[0]?.dateGranularity) warnings.push(`${cpath}.${forecastKey}: forecast ignored — the chart's category field is not a date dimension.`);
  const sort = object(config[key('sortConfiguration', 'SortConfiguration')] ?? {}, cpath);
  const sortsKey = key('categorySort', 'CategorySort');
  const breakdownLimitKey = key('breakdownItemsLimit', 'BreakdownItemsLimit');
  keys(sort, ['radar', 'sankey'].includes(kind) ? [sortsKey] : kind === 'waterfall' ? [sortsKey, breakdownLimitKey] : [sortsKey, key('categoryItemsLimit', 'CategoryItemsLimit'), key('smallMultiplesLimitConfiguration', 'SmallMultiplesLimitConfiguration')], `${cpath}.${key('sortConfiguration', 'SortConfiguration')}`);
  let sliceLimit: VisualModel['sliceLimit'];
  const categoryLimitKey = key('categoryItemsLimit', 'CategoryItemsLimit');
  if (sort[categoryLimitKey] !== undefined) {
    const limit = object(sort[categoryLimitKey], `${cpath}.${categoryLimitKey}`);
    keys(limit, [key('otherCategories', 'OtherCategories'), key('itemsLimit', 'ItemsLimit')], `${cpath}.${categoryLimitKey}`);
    const other = enumValue(limit[key('otherCategories', 'OtherCategories')], ['INCLUDE', 'EXCLUDE'], 'INCLUDE', cpath);
    const count = limit[key('itemsLimit', 'ItemsLimit')];
    if (count === undefined) {
      warnings.push(`${cpath}.${categoryLimitKey}: no slice limit specified; all supplied result rows are shown.`);
    } else if (kind !== 'pie') {
      fail(`${cpath}.${categoryLimitKey}`, 'slice limits are only computed for pie visuals');
    } else if (!Number.isInteger(count) || (count as number) < 1 || (count as number) > 100) {
      fail(`${cpath}.${categoryLimitKey}`, 'slice limit count must be an integer between 1 and 100');
    } else {
      sliceLimit = { count: count as number, includeOther: other === 'INCLUDE' };
    }
  }
  const smallLimitKey = key('smallMultiplesLimitConfiguration', 'SmallMultiplesLimitConfiguration');
  let facetLimit: VisualModel['facetLimit'];
  if (sort[smallLimitKey] !== undefined) {
    const limit = object(sort[smallLimitKey], `${cpath}.${smallLimitKey}`);
    keys(limit, [key('otherCategories', 'OtherCategories'), key('itemsLimit', 'ItemsLimit')], `${cpath}.${smallLimitKey}`);
    const other = enumValue(limit[key('otherCategories', 'OtherCategories')], ['INCLUDE', 'EXCLUDE'], 'INCLUDE', cpath);
    const count = limit[key('itemsLimit', 'ItemsLimit')];
    if (count === undefined) {
      warnings.push(`${cpath}.${smallLimitKey}: no top-N/Other bucket is computed; all supplied result rows are shown.`);
    } else if (!FACETED_KINDS.includes(kind)) {
      fail(`${cpath}.${smallLimitKey}`, 'small multiples limits are only computed for faceted visuals');
    } else if (!Number.isInteger(count) || (count as number) < 1 || (count as number) > 100) {
      fail(`${cpath}.${smallLimitKey}`, 'small multiples limit count must be an integer between 1 and 100');
    } else if (!facet) {
      fail(`${cpath}.${smallLimitKey}`, 'small multiples limits require a SmallMultiples field');
    } else {
      facetLimit = { count: count as number, includeOther: other === 'INCLUDE' };
    }
  }
  // Waterfall breakdown limits (QuickSight BreakdownItemsLimit parity): show the
  // top N breakdown values in first-appearance order, rolling the rest into a
  // per-category "Other" delta bar when OtherCategories is INCLUDE.
  let breakdownLimit: VisualModel['breakdownLimit'];
  if (sort[breakdownLimitKey] !== undefined) {
    const limit = object(sort[breakdownLimitKey], `${cpath}.${breakdownLimitKey}`);
    keys(limit, [key('otherCategories', 'OtherCategories'), key('itemsLimit', 'ItemsLimit')], `${cpath}.${breakdownLimitKey}`);
    const other = enumValue(limit[key('otherCategories', 'OtherCategories')], ['INCLUDE', 'EXCLUDE'], 'INCLUDE', cpath);
    const count = limit[key('itemsLimit', 'ItemsLimit')];
    if (count === undefined) {
      warnings.push(`${cpath}.${breakdownLimitKey}: no breakdown limit specified; all supplied breakdown values are shown.`);
    } else if (kind !== 'waterfall') {
      fail(`${cpath}.${breakdownLimitKey}`, 'breakdown item limits are only computed for waterfall visuals');
    } else if (!Number.isInteger(count) || (count as number) < 1 || (count as number) > 100) {
      fail(`${cpath}.${breakdownLimitKey}`, 'breakdown limit count must be an integer between 1 and 100');
    } else if (!breakdown) {
      fail(`${cpath}.${breakdownLimitKey}`, 'breakdown item limits require a Breakdowns field');
    } else {
      breakdownLimit = { count: count as number, includeOther: other === 'INCLUDE' };
    }
  }
  const sorts = list(sort[sortsKey], `${cpath}.${sortsKey}`);
  if (sorts.length > 1) fail(cpath, 'only one field sort is supported');
  let fieldSort: VisualModel['sort'];
  if (sorts.length) {
    const wrapper = object(sorts[0], cpath);
    const fsKey = key('fieldSort', 'FieldSort');
    keys(wrapper, [fsKey], cpath);
    const fs = object(wrapper[fsKey], cpath);
    keys(fs, [key('fieldId', 'FieldId'), key('direction', 'Direction')], cpath);
    const fieldId = text(fs[key('fieldId', 'FieldId')], cpath);
    if (!fields.some(f => f.id === fieldId)) fail(cpath, 'sort references an unbound field');
    const direction = enumValue(fs[key('direction', 'Direction')], ['ASC', 'DESC'], 'ASC', cpath) as 'ASC' | 'DESC';
    fieldSort = { fieldId, direction };
  }
  return {
    id, kind, ...(kind === 'insight' ? { insightConfiguration: object(body.insightConfiguration ?? {}, p) } : {}), ...(formattingValid(formatting) ? { formatting } : {}), ...(palette ? { palette: palette as string[] } : {}), gaugeMin, gaugeMax, bins, title: plain as string | undefined ?? `${measures.map(f => fieldName(f, formattingValid(formatting) ? formatting : undefined)).join(', ')}${dimensions[0] ? ` by ${fieldName(dimensions[0], formattingValid(formatting) ? formatting : undefined)}` : ''}`,
    titleVisible: visibility(title, key('visibility', 'Visibility')),
    subtitle: subtitleText, subtitleVisible: visibility(subtitle, key('visibility', 'Visibility')),
    legendPosition: enumValue(legend[key('position', 'Position')] ?? (formattingValid(formatting) ? formatting.legendPosition : undefined), [...LEGEND_POSITIONS], 'BOTTOM', `${cpath}.legend.position`) as LegendPosition,
    dimensions, rowDimensions, columnDimensions, measures, totals, subtotals, columnTotals, columnSubtotals, innerRadius, sort: fieldSort, warnings,
    ...(sliceLimit ? { sliceLimit } : {}),
    ...(facetLimit ? { facetLimit } : {}),
    ...(breakdownLimit ? { breakdownLimit } : {}),
    ...(facet ? { facet } : {}),
    ...(breakdown ? { breakdown } : {}),
    ...(forecast ? { forecast } : {}),
    ...(multiplesOptions ? { multiplesOptions } : {}),
    horizontal: (kind === 'bar' || kind === 'bar100') && enumValue(config[key('orientation', 'Orientation')], ['VERTICAL', 'HORIZONTAL'], 'VERTICAL', `${cpath}.${key('orientation', 'Orientation')}`) === 'HORIZONTAL',
    stacked: kind === 'bar' && enumValue(config[key('barsArrangement', 'BarsArrangement')], ['CLUSTERED', 'STACKED'], 'CLUSTERED', `${cpath}.${key('barsArrangement', 'BarsArrangement')}`) === 'STACKED',
    labels: visibility(labels, key('visibility', 'Visibility'), kind === 'pie' ? 'VISIBLE' : 'HIDDEN'),
    tooltip: visibility(tooltip, key('tooltipVisibility', 'TooltipVisibility')),
    ...(tooltipDetail ? { tooltipDetail: { type: tooltipDetail.type, titleType: tooltipDetail.titleType, aggregations: tooltipDetail.aggregations, hiddenFields: tooltipDetail.hiddenFields } } : {}),
    ...(tooltipDetail?.extraFields.length ? { tooltipExtraFields: tooltipDetail.extraFields } : {}),
    legend: visibility(legend, key('visibility', 'Visibility')),
    ...extensionReferenceLines(body[key('opensightReferenceLines', 'OpenSightReferenceLines')], `${p}.${key('opensightReferenceLines', 'OpenSightReferenceLines')}`),
  };
}

/** Pure renderer: rows must already be authorized, filtered and aggregated. No query execution. */
export function compileVisual(input: Input): CompiledVisual {
  if (input.theme !== undefined && !themeValid(input.theme)) fail(input.path, 'invalid analysis theme');
  const theme = input.theme ?? LIGHT_THEME;
  const model = normalizeVisual(input.source, input.definition, input.path);
  const fields = [...model.dimensions, ...(model.breakdown ? [model.breakdown] : []), ...(model.facet ? [model.facet] : []), ...model.measures];
  // Extra tooltip fields ride the result rows as additional measures; they never join the wells,
  // the series, or the data table. Their column alias is the field id (the query plans outputName = fieldId).
  const extraFields: Field[] = (model.tooltipExtraFields ?? []).map(e =>
    ({ id: e.id, column: e.id, dataSet: fields[0]?.dataSet ?? '' }));
  for (const fieldId of Object.keys(input.bindings)) if (![...fields, ...extraFields].some(f => f.id === fieldId)) fail(input.path, `binding references unknown field ${fieldId}`);
  const cell = (row: Row, field: Field): Cell => {
    const alias = Object.hasOwn(input.bindings, field.id) ? input.bindings[field.id]! : field.column;
    if (!Object.hasOwn(row, alias)) fail(input.path, `missing result column ${alias} for field ${field.id}`);
    const value = row[alias];
    if (value !== null && typeof value !== 'string' && typeof value !== 'boolean' && !(typeof value === 'number' && Number.isFinite(value))) fail(input.path, `invalid result cell ${alias}`);
    return value;
  };
  const number = (row: Row, field: Field): number | null => {
    const value = cell(row, field);
    if (value !== null && typeof value !== 'number') fail(input.path, `measure ${field.id} must be a finite number or null`);
    return value;
  };
  if (input.rows !== null && !Array.isArray(input.rows)) fail(input.path, 'expected result rows or null (unavailable)');
  const rows = [...(input.rows ?? [])];
  for (const row of rows) {
    object(row, input.path);
    for (const field of fields) cell(row, field);
    for (const field of model.measures) number(row, field);
  }
  // Extra tooltip fields are adornments, not load-bearing: a result set that cannot
  // supply one (pinned fixtures, hosted plans built from wells) warns loudly and skips
  // the row instead of failing the visual or showing a wrong value.
  const extraColumn = (field: Field): string => Object.hasOwn(input.bindings, field.id) ? input.bindings[field.id]! : field.column;
  const availableExtras = extraFields.filter(field => rows.every(row => Object.hasOwn(row, extraColumn(field))));
  for (const e of model.tooltipExtraFields ?? []) {
    if (!availableExtras.some(f => f.id === e.id)) model.warnings.push(`${input.path}: tooltip field '${e.id}' has no data in this result and will not be shown.`);
  }
  if (model.sort) {
    const sort = model.sort;
    const field = fields.find(f => f.id === sort.fieldId)!;
    rows.sort((a, b) => {
      const av = cell(a, field), bv = cell(b, field);
      if (av === null) return bv === null ? 0 : 1;
      if (bv === null) return -1;
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av) < String(bv) ? -1 : String(av) > String(bv) ? 1 : 0;
      return sort.direction === 'DESC' ? -cmp : cmp;
    });
  }
  if (model.dimensions[0] && !['box', 'histogram', 'scatter', 'pointMap', 'sankey'].includes(model.kind)) {
    // Validate source rows before limiting: collapsing or dropping rows must
    // not hide genuinely duplicated categories (#126).
    // Faceted pies group by (facet, category); waterfall breakdowns group by
    // (category, breakdown): the same category may repeat across breakdown values.
    const keyFields = model.breakdown ? [...model.dimensions, model.breakdown] : model.facet ? [model.facet, ...model.dimensions] : model.dimensions;
    const categories = rows.map(row => JSON.stringify(keyFields.map(f => cell(row, f))));
    if (new Set(categories).size !== categories.length) fail(input.path, 'duplicate categories: expected aggregated result rows');
  }
  // Compute facet limits once, before any of the three layout paths or per-panel
  // slice limits. Explicit groups keep a retained literal "Other" facet distinct
  // from the extra panel, even though both have the fixed English title.
  let facetGroups: FacetGroup[] | undefined;
  if (model.facet && model.facetLimit) {
    const facet = model.facet;
    const groups = groupRowsByFacet(rows, facet, cell);
    facetGroups = applyFacetLimit(groups, model.facetLimit, rest => {
      const merged = new Map<string, Record<string, Cell>>();
      for (const row of rest) {
        const key = JSON.stringify(model.dimensions.map(field => cell(row, field)));
        let other = merged.get(key);
        if (!other) {
          other = { ...row, [extraColumn(facet)]: 'Other' };
          for (const measure of model.measures) other[extraColumn(measure)] = null;
          // As with slice limits, extra tooltip values cannot be inferred from
          // already aggregated rows. Never inherit one source facet's value.
          for (const extra of extraFields) other[extraColumn(extra)] = null;
          merged.set(key, other);
        }
        for (const measure of model.measures) {
          const value = number(row, measure);
          if (value !== null) {
            const total = (number(other, measure) ?? 0) + value;
            if (!Number.isFinite(total)) fail(input.path, 'small multiples Other totals must be finite');
            other[extraColumn(measure)] = total;
          }
        }
      }
      return [...merged.values()];
    });
    if (facetGroups !== groups) {
      rows.length = 0;
      rows.push(...facetGroups.flatMap(group => group.rows));
    }
  }
  // Pie slice limit (QuickSight CategoryItemsLimit parity): keep the top N rows
  // in display order per facet group, rolling the rest into one "Other" bucket
  // (per-measure SUM, null when every contributing value is null) or dropping
  // them when Other is excluded. Unset limit: all supplied rows are shown.
  if (model.sliceLimit && model.kind === 'pie' && model.dimensions[0]) {
    const limit = model.sliceLimit;
    const category = model.dimensions[0];
    const keyOf = (row: Row) => model.facet ? JSON.stringify(cell(row, model.facet)) : '';
    const groups = new Map<string, Row[]>();
    for (const row of rows) {
      const k = keyOf(row);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(row);
    }
    const limited: Row[] = [];
    for (const group of facetGroups?.map(group => group.rows) ?? groups.values()) {
      const start = limited.length;
      if (group.length <= limit.count) { limited.push(...group); continue; }
      const kept = group.slice(0, limit.count), rest = group.slice(limit.count);
      // Fold a retained literal "Other" into this facet's bucket (#126).
      // One row/name keeps series, legends, tooltips, tables and label-based
      // selections consistent while preserving totals. Do not promote another
      // row into its place; EXCLUDE leaves the retained rows unchanged.
      for (const row of kept) {
        if (limit.includeOther && cell(row, category) === 'Other') rest.push(row);
        else limited.push(row);
      }
      if (limit.includeOther) {
        const other: Record<string, Cell> = { ...kept[0]! };
        const alias = (f: Field) => Object.hasOwn(input.bindings, f.id) ? input.bindings[f.id]! : f.column;
        other[alias(category)] = 'Other';
        for (const measure of model.measures) {
          const values = rest.map(r => number(r, measure)).filter((v): v is number => v !== null);
          other[alias(measure)] = values.length ? values.reduce((a, b) => a + b, 0) : null;
        }
        // Tooltip extra fields are per-row adornments, not additive facts: the
        // Other bucket has no meaningful value for them, so they read as empty
        // rather than inheriting one slice's value.
        for (const extra of extraFields) other[alias(extra)] = null;
        limited.push(other);
      }
      if (facetGroups) group.splice(0, group.length, ...limited.slice(start));
    }
    rows.length = 0;
    rows.push(...limited);
  }
  const state = input.rows === null ? 'unavailable' : rows.length ? 'ready' : 'empty';
  const option: EChartsOption = {
    animation: false,
    color: model.palette ?? theme.palette, backgroundColor: theme.surface,
    textStyle: { fontFamily: theme.fontFamily, color: theme.textColor },
    // Titles belong to the React card heading. Native tables use the same cells.
    tooltip: { show: model.tooltip, trigger: model.kind === 'pie' ? 'item' : 'axis', renderMode: 'richText', confine: true },
    aria: { enabled: true },
  };
  let narrative: InsightNarrative | undefined;
  // Faceted charts flatten several series per panel (one per measure, except
  // pies with one per panel), so per-series row lookups (detailed tooltips,
  // conditional-formatting rules) cannot index per-panel row groups by the
  // global series index (#125). Carry an explicit mapping from each series,
  // in option.series order, to its facet rows and its measure index.
  let facetSeriesMap: { rows: Row[]; measureIndex: number }[] | undefined;
  // Line/area panels for the forecast post-pass (issue #235): rows per panel,
  // the option.series indices of its measure series, and its axis index.
  // Forecast extras are appended after every other pass so these indices and
  // facetSeriesMap stay valid for the passes that consume them.
  let forecastPanels: { rows: Row[]; measureSeries: number[]; axisIndex: number }[] | undefined;
  if (model.kind === 'insight') {
    try { narrative = insightNarrative(rows.map(row => ({ category: cell(row, model.dimensions[0]!), values: model.measures.map(f => number(row, f)) })), { category: model.dimensions[0], measures: model.measures, computations: model.insightConfiguration, formatting: model.formatting }); }
    catch (error) { if (error instanceof InsightError) fail(input.path, error.message); throw error; }
    option.tooltip = { show: false };
    option.graphic = insightGraphic(narrative, theme, model.formatting?.fontSize).graphic;
  } else if (extraKind(model.kind)) {
    // compileExtra returns per-panel row groups only for faceted
    // area/combo/bar100, whose panels each emit one series per measure in
    // panel order — expand those groups into the per-series map.
    const extraGroups = compileExtra(model, rows, cell, number, option, message => fail(input.path, message),
      { path: input.path, theme, warn: message => model.warnings.push(message), facetGroups });
    if (extraGroups) facetSeriesMap = extraGroups.flatMap(groupRows => model.measures.map((_, measureIndex) => ({ rows: groupRows, measureIndex })));
    if (model.kind === 'area') forecastPanels = (extraGroups ?? [rows]).map((panelRows, i) => ({ rows: panelRows, measureSeries: model.measures.map((_, mi) => i * model.measures.length + mi), axisIndex: i }));
  } else if (model.kind === 'pie') {
    const measure = model.measures[0]!;
    option.legend = { show: model.legend, bottom: 4, type: 'scroll' };
    const pieDatum = (row: Row): { name: string; value: number } => {
      const value = number(row, measure);
      if (value === null || value < 0) fail(input.path, 'pie values must be nonnegative numbers; null slices are unsupported');
      return { name: displayCell(cell(row, model.dimensions[0]!)), value };
    };
    const pieSeries = (data: { name: string; value: number }[], center: [string, string], radius: [string, string]): PieSeriesOption => ({
      type: 'pie', name: fieldName(measure, model.formatting), radius, center,
      showEmptyCircle: false, stillShowZeroSum: false, avoidLabelOverlap: true,
      label: { show: model.labels, formatter: '{b}: {d}%' }, labelLine: { show: model.labels },
      data,
    });
    if (model.facet) {
      // Small multiples: one pie per facet value on a grid, first-appearance order.
      const opts = model.multiplesOptions;
      const { shown, cols, topPad, cellW, cellH } =
        facetLayout(facetGroups ?? groupRowsByFacet(rows, model.facet, cell), opts, input.path, w => model.warnings.push(w));
      // Gutter opens an inter-panel gap by shrinking each panel's content (and
      // insetting its chrome below); the factor is an OpenSight approximation
      // of the reference spacing, not measured QuickSight geometry.
      const gutterShrink = opts?.gutter ? 0.92 : 1;
      // Radius is % of the container's smaller side; the fit holds for card
      // aspect ratios between roughly 2:3 and 5:2 (checked against the fit math).
      const outer = `${(Math.min(34 / cols, 0.42 * cellH) * gutterShrink).toFixed(1)}%`;
      option.series = shown.map((group, i) => {
        const c = i % cols, r = Math.floor(i / cols);
        return pieSeries(group.rows.map(pieDatum),
          [`${(((c + 0.5) / cols) * 100).toFixed(2)}%`, `${(topPad + (r + 0.5) * cellH).toFixed(2)}%`],
          [model.innerRadius, outer]);
      });
      option.title = facetTitles(shown, opts, cols, cellH, topPad, theme, displayCell);
      // Panel chrome: one ECharts grid per panel draws the border/background.
      const chrome = facetPanelGrids(shown, opts, cols, cellW, cellH, topPad);
      if (chrome) option.grid = chrome;
      facetSeriesMap = shown.map(group => ({ rows: group.rows, measureIndex: 0 }));
    } else {
      option.series = [pieSeries(rows.map(pieDatum), ['50%', '45%'], [model.innerRadius, '70%'])];
    }
  } else if (model.kind === 'bar' || model.kind === 'line') {
    const panelParts = (panelRows: Row[]) => {
      const category = { type: 'category' as const, data: panelRows.map(row => displayCell(cell(row, model.dimensions[0]!))), axisLabel: { hideOverlap: true }, ...(model.horizontal ? { inverse: true } : {}) };
      const value = { type: 'value' as const, splitLine: { lineStyle: { color: '#e7edef' } } };
      const series = model.measures.map((field): BarSeriesOption | LineSeriesOption => model.kind === 'bar' ? {
        type: 'bar', name: fieldName(field, model.formatting), data: panelRows.map(row => number(row, field)),
        barMaxWidth: 72, ...(model.stacked ? { stack: 'values' } : {}),
        label: { show: model.labels },
      } : {
        type: 'line', name: fieldName(field, model.formatting), data: panelRows.map(row => number(row, field)),
        connectNulls: false, symbolSize: 8, label: { show: model.labels },
      });
      return { category, value, series };
    };
    if (model.facet) {
      // Small multiples: one cartesian panel per facet value on a grid.
      const opts = model.multiplesOptions;
      const { shown, cols, topPad, cellW, cellH } =
        facetLayout(facetGroups ?? groupRowsByFacet(rows, model.facet, cell), opts, input.path, w => model.warnings.push(w));
      const inset = opts?.gutter ? 1.5 : 0;
      option.grid = shown.map((_, i) => {
        const c = i % cols, r = Math.floor(i / cols);
        const chrome = opts && (opts.border.enabled || opts.background);
        return {
          show: !!chrome,
          left: `${(c * cellW + inset).toFixed(2)}%`, top: `${(topPad + r * cellH + inset).toFixed(2)}%`,
          width: `${(cellW - inset * 2).toFixed(2)}%`, height: `${(cellH - inset * 2).toFixed(2)}%`,
          outerBoundsMode: 'same', outerBoundsContain: 'axisLabel',
          // Panel chrome: border/background piggyback on the layout grid.
          // Dashed/dotted borders render solid (the choice stays in the model).
          ...(chrome ? {
            backgroundColor: opts.background ? '#f4f6f8' : 'transparent',
            borderWidth: opts.border.enabled ? opts.border.widthPx : 0,
            borderColor: opts.border.color,
          } : {}),
        };
      });
      const panels = shown.map(group => panelParts(group.rows));
      option.xAxis = panels.map((panel, i) => ({ ...(model.horizontal ? panel.value : panel.category), gridIndex: i }));
      option.yAxis = panels.map((panel, i) => ({ ...(model.horizontal ? panel.category : panel.value), gridIndex: i }));
      option.series = panels.flatMap((panel, i) => panel.series.map(s => ({ ...s, xAxisIndex: i, yAxisIndex: i })));
      if (model.kind === 'line') forecastPanels = shown.map((group, i) => ({ rows: group.rows, measureSeries: model.measures.map((_, mi) => i * model.measures.length + mi), axisIndex: i }));
      option.title = facetTitles(shown, opts, cols, cellH, topPad, theme, displayCell);
      facetSeriesMap = shown.flatMap(group => model.measures.map((_, measureIndex) => ({ rows: group.rows, measureIndex })));
    } else {
      const { category, value, series } = panelParts(rows);
      option.grid = { left: 20, right: 24, top: 36, bottom: 40, outerBoundsMode: 'same', outerBoundsContain: 'axisLabel' };
      option.xAxis = model.horizontal ? value : category;
      option.yAxis = model.horizontal ? category : value;
      option.series = series;
      if (model.kind === 'line') forecastPanels = [{ rows, measureSeries: model.measures.map((_, mi) => mi), axisIndex: 0 }];
    }
    option.legend = { show: model.legend, bottom: 0 };
  } else if (model.kind === 'kpi') {
    if (rows.length > 1) fail(input.path, 'KPI expects exactly one aggregate row, not a client-side sum');
    const row = rows[0];
    const value = row ? number(row, model.measures[0]!) : null;
    const label = state === 'unavailable' ? DATA_REQUIRED_LABEL : state === 'empty' ? 'No results' : value === null ? 'No value' : formatMetric(value, model.formatting?.metricFormats?.[model.measures[0]!.column]) ?? displayCell(value);
    option.tooltip = { show: false };
    option.graphic = [{ type: 'text', left: 'center', top: 'middle', style: { text: label, fill: (model.palette ?? theme.palette)[0], fontSize: value === null ? 22 : 56, fontWeight: 600, fontFamily: theme.fontFamily } }];
  }
  applyDisplayOptions(model, option, theme);
  if (model.tooltip && model.tooltipDetail?.type === 'detailed') {
    if (['box', 'histogram'].includes(model.kind) && model.tooltipExtraFields?.length) {
      model.warnings.push(`Extra fields are not shown in ${model.kind} detailed tooltips because each datum aggregates multiple rows.`);
    }
    if (DETAILED_TOOLTIP_KINDS.includes(model.kind)) {
      option.tooltip = { ...(typeof option.tooltip === 'object' && !Array.isArray(option.tooltip) ? option.tooltip : {}),
        formatter: ['treemap', 'wordCloud'].includes(model.kind)
          ? transformedTooltipFormatter(model, rows, cell, availableExtras)
          : ['box', 'histogram'].includes(model.kind)
            ? distributionTooltipFormatter(model, option)
            : model.kind === 'waterfall'
              ? waterfallTooltipFormatter(model, rows, cell, availableExtras)
              : detailedTooltipFormatter(model, rows, cell, availableExtras, facetSeriesMap) };
    } else {
      model.warnings.push(`detailed tooltips are not rendered for ${model.kind} visuals; using basic tooltips.`);
    }
  }
  if (input.theme || model.palette) {
    for (const axis of [option.xAxis, option.yAxis].flat()) if (axis) { axis.axisLabel = { ...axis.axisLabel, color: theme.textColor }; axis.nameTextStyle = { color: theme.textColor }; }
    if (option.legend && !Array.isArray(option.legend)) option.legend.textStyle = legendTextStyle(theme, model.formatting?.legendValueStyle,
      typeof option.legend.textStyle === 'object' && option.legend.textStyle ? option.legend.textStyle as Record<string, unknown> : undefined);
    if (option.visualMap && !Array.isArray(option.visualMap)) { option.visualMap.textStyle = { color: theme.textColor }; option.visualMap.inRange = { color: [theme.surface, ...(model.palette ?? theme.palette)] }; }
    if (Array.isArray(option.series)) for (const series of option.series) {
      if ('label' in series) {
        // An explicit label color (data-label text styling) survives the theme pass.
        const explicit = (series.label as { color?: unknown } | undefined)?.color;
        series.label = { ...series.label, ...(typeof explicit === 'string' ? {} : { color: theme.textColor }) };
      }
      if (series.type === 'gauge') { series.itemStyle = { color: (model.palette ?? theme.palette)[0] }; series.axisLabel = { color: theme.textColor }; series.detail = { ...series.detail, color: theme.textColor }; series.title = { color: theme.textColor }; }
    }
  }
  // Rules evaluate supplied measures, before chart-specific transforms such as percentages.
  if (model.formatting?.rules?.length && ['bar', 'line', 'pie', 'scatter', 'funnel', 'area', 'combo', 'bar100'].includes(model.kind) && Array.isArray(option.series)) {
    option.series.forEach((series, index) => {
      if (!('data' in series) || !Array.isArray(series.data)) return;
      const facetEntry = facetSeriesMap?.[index];
      const measures = model.kind === 'scatter' ? model.measures : [model.measures[facetEntry ? facetEntry.measureIndex : index] ?? model.measures[0]!];
      series.data = series.data.map((datum: unknown, rowIndex: number) => {
        const row = (facetEntry?.rows ?? rows)[rowIndex];
        const rule = row && model.formatting?.rules?.find(rule => {
          const field = measures.find(f => f.column === rule.fieldId || f.id === rule.fieldId);
          return field && matchingRule([rule], rule.fieldId, number(row, field));
        });
        return rule ? { ...(datum && typeof datum === 'object' && !Array.isArray(datum) ? datum : { value: datum }), itemStyle: { color: rule.color } } : datum;
      }) as typeof series.data;
    });
  }
  if (model.kind === 'pivot' || model.kind === 'table' && (model.totals || model.subtotals)) {
    const table = compilePivotTable(model, rows, cell, number, input.path);
    return { model, option, state: state === 'ready' && !table.rows.length ? 'empty' : state, table };
  }
  // Forecast post-pass (issue #235): appended extras keep every earlier index
  // (facet map, conditional formatting, detailed tooltips) valid.
  let forecastNote: string | undefined;
  if (model.forecast?.enabled && forecastPanels && model.dimensions[0]?.dateGranularity && Array.isArray(option.series)) {
    const config = model.forecast;
    const grain = model.dimensions[0].dateGranularity;
    const dimension = model.dimensions[0];
    let anyApplied = false, anyInsufficient = false, anySeasonalSkipped = false, anyInapplicable = false;
    const extras: LineSeriesOption[] = [];
    for (const panel of forecastPanels) {
      if (!panel.rows.length) continue;
      const dates = panel.rows.map(row => groupedPeriodDate(cell(row, dimension), grain));
      if (dates.some(d => d === null)) { anyInapplicable = true; continue; }
      const n = panel.rows.length;
      const axis = (Array.isArray(option.xAxis) ? option.xAxis[panel.axisIndex] : option.xAxis) as { data?: string[] } | undefined;
      const labels = axis?.data ?? panel.rows.map(row => displayCell(cell(row, dimension)));
      const rawLast = String(cell(panel.rows.at(-1)!, dimension));
      const extended = [...labels];
      for (let h = 1; h <= config.periodsForward; h++) extended.push(periodLabel(shiftPeriod(dates.at(-1)!, grain, h), grain, rawLast));
      panel.measureSeries.forEach((seriesIndex, mi) => {
        const parent = (option.series as LineSeriesOption[])[seriesIndex]!;
        const measure = model.measures[mi]!;
        const pts = panel.rows.map((row, idx) => ({ idx, v: number(row, measure) })).filter(p => p.v !== null) as { idx: number; v: number }[];
        if (pts.length < MIN_FORECAST_POINTS) { anyInsufficient = true; return; }
        const result = computeForecast(pts.map(p => p.v), grain, config);
        if (!result) { anyInsufficient = true; return; }
        if (result.seasonalSkipped) anySeasonalSkipped = true;
        if (!config.periodsForward && !config.periodsBackward) return;
        anyApplied = true;
        const color = (model.palette ?? theme.palette)[seriesIndex % (model.palette ?? theme.palette).length]!;
        const total = n + config.periodsForward;
        const last = pts.at(-1)!;
        type SegDatum = { value: number; forecastKind: 'fit' | 'join' | 'future'; lower?: number; upper?: number } | null;
        const seg: SegDatum[] = new Array<SegDatum>(total).fill(null);
        const back = Math.min(config.periodsBackward, pts.length);
        for (let j = pts.length - back; j < pts.length; j++) {
          const fitted = result.fitted[j];
          if (fitted !== null && fitted !== undefined) seg[pts[j]!.idx] = { value: fitted, forecastKind: 'fit' };
        }
        seg[last.idx] = { value: last.v, forecastKind: 'join' };
        result.future.forEach((point, h) => { seg[n + h] = { value: point.value, forecastKind: 'future', lower: point.lower, upper: point.upper }; });
        const bandLower: (number | null)[] = new Array<number | null>(total).fill(null);
        const bandDelta: (number | null)[] = new Array<number | null>(total).fill(null);
        if (config.periodsForward) {
          bandLower[last.idx] = last.v; bandDelta[last.idx] = 0;
          result.future.forEach((point, h) => { bandLower[n + h] = point.lower; bandDelta[n + h] = point.upper - point.lower; });
        }
        const stack = `forecast-band-${panel.axisIndex}-${mi}`;
        const axes = model.facet ? { xAxisIndex: panel.axisIndex, yAxisIndex: panel.axisIndex } : {};
        if (config.periodsForward) extras.push(
          { type: 'line', id: `forecast-band-lo-${panel.axisIndex}-${mi}`, name: '', stack, data: bandLower, symbol: 'none', silent: true, tooltip: { show: false }, emphasis: { disabled: true }, lineStyle: { opacity: 0 }, itemStyle: { color }, ...axes } as LineSeriesOption,
          { type: 'line', id: `forecast-band-hi-${panel.axisIndex}-${mi}`, name: '', stack, data: bandDelta, symbol: 'none', silent: true, tooltip: { show: false }, emphasis: { disabled: true }, lineStyle: { opacity: 0 }, itemStyle: { color }, areaStyle: { color, opacity: 0.16 }, ...axes } as LineSeriesOption,
        );
        extras.push({
          type: 'line', id: `forecast-seg-${panel.axisIndex}-${mi}`, name: parent.name as string, data: seg, connectNulls: false, symbolSize: 6,
          lineStyle: { type: 'dashed', color }, itemStyle: { color }, label: { show: false },
          ...(mi === 0 && config.periodsForward ? { markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { type: 'solid' as const, width: 1, color: '#98a4ab' }, data: [{ xAxis: n - 1 }] } } : {}),
          ...axes,
        } as LineSeriesOption);
      });
      if (axis && extended.length !== labels.length) axis.data = extended;
    }
    if (extras.length) option.series = [...option.series, ...extras];
    if (anyInapplicable) model.warnings.push(`${input.path}: forecast was not rendered because the category values are not dates at the chart grain.`);
    if (!anyApplied && anyInsufficient) forecastNote = 'Not enough history to forecast — showing actuals. A forecast needs at least 4 data points.';
    else if (anySeasonalSkipped) forecastNote = 'Seasonality was skipped: a seasonal forecast needs at least 2 full cycles of history. Showing a trend forecast instead.';
    if (anyApplied && model.tooltip && option.tooltip && !Array.isArray(option.tooltip) && !(option.tooltip as { formatter?: unknown }).formatter) {
      (option.tooltip as { formatter?: unknown }).formatter = (params: unknown) => {
        const list = (Array.isArray(params) ? params : [params]) as { seriesId?: string; seriesName?: string; value?: unknown; data?: unknown; axisValue?: unknown }[];
        const fmt = (v: number): string => formatNumber(Math.round(v * 100) / 100);
        const lines: string[] = [];
        for (const p of list) {
          if (p.seriesId?.startsWith('forecast-band')) continue;
          if (!lines.length && p.axisValue !== undefined) lines.push(richTextEscape(String(p.axisValue)));
          const d = p.data as { forecastKind?: string; lower?: number; upper?: number } | null;
          const v = typeof p.value === 'number' ? p.value : null;
          if (v === null) continue;
          if (d?.forecastKind === 'future') lines.push(`${richTextEscape(p.seriesName ?? '')} (Forecast): ${fmt(v)} · ${config.predictionInterval}% interval ${fmt(d.lower!)}–${fmt(d.upper!)}`);
          else if (d?.forecastKind === 'fit') lines.push(`${richTextEscape(p.seriesName ?? '')} (Forecast fit): ${fmt(v)}`);
          else if (d?.forecastKind === 'join') continue;
          else lines.push(`${richTextEscape(p.seriesName ?? '')}: ${fmt(v)}`);
        }
        return lines.join('\n');
      };
    }
  }
  return { model, option, state, ...(forecastNote ? { forecastNote } : {}), ...(narrative ? { narrative } : {}), table: { columns: fields.map(f => fieldName(f, model.formatting)), rows: rows.map(row => fields.map(field => cell(row, field))),
    ...(model.formatting ? { visibleColumns: fields.map(f => (model.measures.includes(f) ? model.formatting?.valueNamesVisible : model.formatting?.rowNamesVisible) === false ? '' : fieldName(f, model.formatting)) } : {}),
  } };
}

/** Kinds with exact detailed tooltips, either per-row or from compiled datums.
 *  scatter, funnel, heatmap, filledMap and pointMap build their series with rows.map
 *  (index-preserving); gauge renders a single datum from the single aggregate row.
 *  treemap and wordCloud retain leaf/word source indices for extra fields;
 *  box and histogram resolve compiled statistics/bins, without source-row extras;
 *  waterfall delta bars retain their source row, while subtotal/Other/Total
 *  bars (compiled aggregates) keep the basic tooltip. */
const DETAILED_TOOLTIP_KINDS = ['bar', 'line', 'pie', 'combo', 'area', 'bar100', 'scatter', 'funnel', 'gauge', 'heatmap', 'filledMap', 'pointMap', 'treemap', 'wordCloud', 'box', 'histogram', 'waterfall'];
/** Kinds whose tooltip config accepts the detailed keys (mirrors the chartConfiguration gate). */
export const tooltipDetailKinds = (kind: VisualKind): boolean => !['insight', 'kpi', 'table', 'pivot', 'radar', 'sankey'].includes(kind);
/** All config-accepting kinds now render detailed tooltips. */
export const detailedTooltipKinds = (kind: VisualKind): boolean => DETAILED_TOOLTIP_KINDS.includes(kind);

/** Escape richText markup characters in dynamic tooltip text (display encoding; table data stays exact). */
const richTextEscape = (value: string): string => value.replace(/[{}]/g, ch => ch === '{' ? '｛' : '｝');

/**
 * Detailed tooltip: title line plus one row per visible field (QuickSight parity).
 * Title is the category value (primaryValue) or the field label (fieldId); measures
 * show the aggregation ("Sum of") unless hidden. Visual measure bindings are SUM
 * (enforced at normalization), so the label is exact; extra fields carry their own
 * aggregation from the model. Plain text: the richText parser only treats
 * `{name|...}` as markup, and dynamic braces are escaped below.
 */
const TOOLTIP_AGGREGATION_WORD: Record<'SUM' | 'AVG' | 'MIN' | 'MAX' | 'COUNT', string> =
  { SUM: 'Sum', AVG: 'Avg', MIN: 'Min', MAX: 'Max', COUNT: 'Count' };
function detailedTooltipFormatter(model: VisualModel, rows: Row[], cell: (row: Row, field: Field) => Cell, extraFields: Field[], facetSeries?: { rows: Row[]; measureIndex: number }[]): (params: unknown) => string {
  const detail = model.tooltipDetail!;
  const fields = [...model.dimensions, ...(model.facet ? [model.facet] : []), ...model.measures].filter(f => !detail.hiddenFields.includes(f.id));
  const extras = (model.tooltipExtraFields ?? []).flatMap(e => {
    const field = extraFields.find(f => f.id === e.id);
    return field ? [{ ...e, field }] : [];
  });
  return (params: unknown): string => {
    const first = (Array.isArray(params) ? params[0] : params) as { dataIndex?: unknown; seriesIndex?: unknown } | undefined;
    // Faceted series report a per-series dataIndex; resolve it against that
    // series' own facet rows via the explicit series map (#125), never by
    // indexing per-panel groups with the global series index.
    const pool = facetSeries && typeof first?.seriesIndex === 'number' ? facetSeries[first.seriesIndex]?.rows ?? rows : rows;
    const row = typeof first?.dataIndex === 'number' ? pool[first.dataIndex] : undefined;
    if (!row) return '';
    const titleField = model.dimensions[0] ?? model.measures[0];
    const title = detail.titleType === 'primaryValue' && model.dimensions[0]
      ? displayCell(cell(row, model.dimensions[0]))
      : titleField ? fieldName(titleField, model.formatting) : model.title;
    const lines = [richTextEscape(title)];
    for (const field of fields) {
      const governed = model.formatting?.metricFormats?.[field.column];
      const label = detail.aggregations && model.measures.includes(field) && !governed ? `Sum of ${fieldName(field, model.formatting)}` : fieldName(field, model.formatting);
      lines.push(`${richTextEscape(label)}: ${richTextEscape(formatMetric(cell(row, field), governed) ?? displayCell(cell(row, field)))}`);
    }
    for (const extra of extras) {
      const name = extra.label ?? fieldName(extra.field, model.formatting);
      const label = detail.aggregations ? `${TOOLTIP_AGGREGATION_WORD[extra.aggregation]} of ${name}` : name;
      lines.push(`${richTextEscape(label)}: ${richTextEscape(displayCell(cell(row, extra.field)))}`);
    }
    return lines.join('\n');
  };
}

/** Transformed datums carry their own displayed values. Only explicit leaf/word
 * source indices can resolve extras; an ECharts dataIndex is never a row index. */
function transformedTooltipFormatter(model: VisualModel, rows: Row[], cell: (row: Row, field: Field) => Cell, extraFields: Field[]): (params: unknown) => string {
  const detail = model.tooltipDetail!;
  const measure = model.measures[0]!;
  const titleField = model.dimensions[0] ?? measure;
  const visible = (field: Field): boolean => !detail.hiddenFields.includes(field.id);
  const line = (field: Field, value: Cell): string => {
    const governed = model.formatting?.metricFormats?.[field.column];
    const name = fieldName(field, model.formatting);
    const label = detail.aggregations && field === measure && !governed ? `Sum of ${name}` : name;
    return `${richTextEscape(label)}: ${richTextEscape(formatMetric(value, governed) ?? displayCell(value))}`;
  };
  const extras = (model.tooltipExtraFields ?? []).flatMap(extra => {
    const field = extraFields.find(f => f.id === extra.id);
    return field ? [{ ...extra, field }] : [];
  });
  return (params: unknown): string => {
    const first = (Array.isArray(params) ? params[0] : params) as {
      name?: string; value?: unknown;
      data?: { sourceRowIndex?: number; children?: unknown[] };
      treePathInfo?: { name: string }[];
    } | undefined;
    if (!first) return '';
    // ECharts prepends the synthetic series root to the treemap path.
    const path = model.kind === 'treemap' ? first.treePathInfo?.slice(1).map(node => node.name) : [first.name];
    const value = model.kind === 'wordCloud' && Array.isArray(first.value) ? first.value[2] : first.value;
    if (!path?.length || path[0] === undefined || typeof value !== 'number' || !Number.isFinite(value)) return '';
    const lines = [richTextEscape(detail.titleType === 'primaryValue' ? path[0] : fieldName(titleField, model.formatting))];
    model.dimensions.forEach((field, i) => {
      const value = path[i];
      if (value !== undefined && visible(field)) lines.push(line(field, value));
    });
    if (visible(measure)) lines.push(line(measure, value));
    const index = first.data?.sourceRowIndex;
    const row = !first.data?.children?.length && typeof index === 'number' && Number.isInteger(index) ? rows[index] : undefined;
    if (row) for (const extra of extras) {
      const name = extra.label ?? fieldName(extra.field, model.formatting);
      const label = detail.aggregations ? `${TOOLTIP_AGGREGATION_WORD[extra.aggregation]} of ${name}` : name;
      lines.push(`${richTextEscape(label)}: ${richTextEscape(displayCell(cell(row, extra.field)))}`);
    }
    return lines.join('\n');
  };
}

/** Waterfall bars are compiled datums: a delta bar carries the index of the
 * single result row it decomposes, so its detailed tooltip reads that row
 * (category, breakdown, measure, extras). Subtotal, Other and Total bars
 * aggregate several rows (or the running total) — no row is invented for
 * them; they keep the basic `name: delta` text. */
function waterfallTooltipFormatter(model: VisualModel, rows: Row[], cell: (row: Row, field: Field) => Cell, extraFields: Field[]): (params: unknown) => string {
  const detail = model.tooltipDetail!;
  const measure = model.measures[0]!;
  const fields = [...model.dimensions, ...(model.breakdown ? [model.breakdown] : []), ...model.measures];
  const extras = (model.tooltipExtraFields ?? []).flatMap(e => {
    const field = extraFields.find(f => f.id === e.id);
    return field ? [{ ...e, field }] : [];
  });
  const line = (field: Field, value: Cell): string => {
    const governed = model.formatting?.metricFormats?.[field.column];
    const name = fieldName(field, model.formatting);
    const label = detail.aggregations && model.measures.includes(field) && !governed ? `Sum of ${name}` : name;
    return `${richTextEscape(label)}: ${richTextEscape(formatMetric(value, governed) ?? displayCell(value))}`;
  };
  return (params: unknown): string => {
    const first = (Array.isArray(params) ? params[0] : params) as {
      name?: unknown;
      data?: { delta?: unknown; sourceRowIndex?: number };
    } | undefined;
    if (!first) return '';
    const name = typeof first.name === 'string' ? first.name : '';
    const index = first.data?.sourceRowIndex;
    const row = typeof index === 'number' && Number.isInteger(index) ? rows[index] : undefined;
    if (!row) return `${name}: ${String(first.data?.delta ?? '')}`;
    const title = detail.titleType === 'primaryValue' ? name : fieldName(model.dimensions[0] ?? measure, model.formatting);
    const lines = [richTextEscape(title)];
    for (const field of fields) {
      if (detail.hiddenFields.includes(field.id)) continue;
      lines.push(line(field, cell(row, field)));
    }
    for (const extra of extras) {
      const name = extra.label ?? fieldName(extra.field, model.formatting);
      const label = detail.aggregations ? `${TOOLTIP_AGGREGATION_WORD[extra.aggregation]} of ${name}` : name;
      lines.push(`${richTextEscape(label)}: ${richTextEscape(displayCell(cell(row, extra.field)))}`);
    }
    return lines.join('\n');
  };
}

/** Distributions describe compiled groups/bins, never any particular input row.
 * Read the compiled series: ECharts may add a category coordinate to box values. */
function distributionTooltipFormatter(model: VisualModel, option: EChartsOption): (params: unknown) => string {
  const detail = model.tooltipDetail!;
  const measure = model.measures[0]!;
  const dimension = model.dimensions[0];
  const titleField = model.kind === 'box' ? dimension ?? measure : measure;
  const axis = Array.isArray(option.xAxis) ? option.xAxis[0] : option.xAxis;
  const categories = axis && 'data' in axis ? axis.data : undefined;
  const series = Array.isArray(option.series) ? option.series[0] : option.series;
  const data: readonly unknown[] = series && 'data' in series && Array.isArray(series.data) ? series.data : [];
  const measureName = fieldName(measure, model.formatting);
  const governed = model.formatting?.metricFormats?.[measure.column];
  return (params: unknown): string => {
    const first = (Array.isArray(params) ? params[0] : params) as { dataIndex?: number } | undefined;
    const index = first?.dataIndex;
    if (typeof index !== 'number' || !Number.isInteger(index)) return '';
    const category = categories?.[index];
    if (typeof category !== 'string') return '';
    const lines = [richTextEscape(detail.titleType === 'primaryValue' ? category : fieldName(titleField, model.formatting))];
    const value = data?.[index];
    if (model.kind === 'box') {
      if (dimension && !detail.hiddenFields.includes(dimension.id)) {
        lines.push(`${richTextEscape(fieldName(dimension, model.formatting))}: ${richTextEscape(category)}`);
      }
      // Empty groups contain five '-': preserve their identity, omit statistics.
      if (!detail.hiddenFields.includes(measure.id) && Array.isArray(value)) {
        ['min', 'Q1', 'median', 'Q3', 'max'].forEach((stat, i) => {
          const n: unknown = value[i];
          if (typeof n === 'number' && Number.isFinite(n)) {
            lines.push(`${richTextEscape(measureName)} ${stat}: ${richTextEscape(formatMetric(n, governed) ?? displayCell(n))}`);
          }
        });
      }
    } else {
      if (!detail.hiddenFields.includes(measure.id)) lines.push(`${richTextEscape(measureName)}: ${richTextEscape(category)}`);
      if (typeof value === 'number' && Number.isFinite(value)) lines.push(`Frequency: ${richTextEscape(displayCell(value))}`);
    }
    return lines.join('\n');
  };
}

export function displayCell(value: Cell): string {
  return value === null ? '(null)' : typeof value === 'number' ? formatNumber(value) : String(value);
}

/** Step a period-start date by whole grain units (forecast axis extension). */
function shiftPeriod(date: Date, grain: 'DAY' | 'MONTH' | 'QUARTER' | 'YEAR', steps: number): Date {
  return resultDate(shiftDate(date.toISOString(), steps, { DAY: 'DD', MONTH: 'MM', QUARTER: 'Q', YEAR: 'YYYY' }[grain]));
}

/** Format a future period in the same shape as the axis' existing labels:
 *  period strings stay period strings; full ISO timestamps stay ISO. */
function periodLabel(date: Date, grain: 'DAY' | 'MONTH' | 'QUARTER' | 'YEAR', rawLast: string): string {
  if (/^\d{4}-\d{2}-\d{2}T/.test(rawLast)) return date.toISOString();
  const iso = date.toISOString();
  if (grain === 'YEAR') return iso.slice(0, 4);
  if (grain === 'MONTH') return iso.slice(0, 7);
  if (grain === 'QUARTER') return `${iso.slice(0, 4)}-Q${Math.floor(Number(iso.slice(5, 7)) / 3) + 1}`;
  return iso.slice(0, 10);
}

interface AxisEntry { cells: Cell[]; kind: 'detail' | 'subtotal' | 'total' }
/** Hierarchical axes preserve typed keys (null, strings and numbers never collide). */
function axisEntries(paths: Cell[][], depth: number, subtotals: boolean, totals: boolean): AxisEntry[] {
  if (!depth) return [{ cells: [], kind: 'detail' }];
  const result: AxisEntry[] = [];
  const visit = (prefix: Cell[], candidates: Cell[][]) => {
    if (prefix.length === depth) { result.push({ cells: prefix, kind: 'detail' }); return; }
    const groups = new Map<string, Cell[][]>();
    for (const path of candidates) {
      const key = JSON.stringify(path[prefix.length]);
      const group = groups.get(key) ?? [];
      group.push(path); groups.set(key, group);
    }
    for (const group of groups.values()) visit([...prefix, group[0]![prefix.length]!], group);
    if (subtotals && prefix.length) result.push({ cells: prefix, kind: 'subtotal' });
  };
  visit([], paths);
  if (totals && paths.length) result.push({ cells: [], kind: 'total' });
  return result;
}

/** Stable key for a typed row-group path; numbers, strings and null never collide. */
export const rowGroupKey = (path: Cell[]): string => JSON.stringify(path);

/**
 * Row-group expand/collapse visibility: a row is hidden only when a collapsed
 * group path is a strict prefix of its own path, so the group's subtotal row
 * stays visible as the collapsed anchor and the grand total never hides.
 */
export function rowGroupVisibility(paths: Cell[][], collapsed: ReadonlySet<string>): boolean[] {
  return paths.map(path => {
    for (let depth = 1; depth < path.length; depth++) if (collapsed.has(rowGroupKey(path.slice(0, depth)))) return false;
    return true;
  });
}

/** Presentation anchors when subtotals are hidden; never invent aggregate values. */
export function pivotRowGroupHeaders(table: CompiledVisual['table']): { beforeRow: number; path: Cell[] }[] {
  const seen = new Set<string>(), headers: { beforeRow: number; path: Cell[] }[] = [];
  table.rowGroupPaths?.forEach((path, beforeRow) => {
    if (table.rowKinds?.[beforeRow] !== 'detail') return;
    for (let depth = 1; depth < path.length; depth++) {
      const prefix = path.slice(0, depth), key = rowGroupKey(prefix);
      if (!seen.has(key)) { seen.add(key); headers.push({ beforeRow, path: prefix }); }
    }
  });
  return headers;
}

/** Native HTML pivot: only additive SUM bindings are accepted, so rollups are exact over the supplied groups. */
function compilePivotTable(model: VisualModel, rows: Row[], cell: (row: Row, field: Field) => Cell,
  number: (row: Row, field: Field) => number | null, path: string): CompiledVisual['table'] {
  const rowFields = model.rowDimensions, columnFields = model.columnDimensions;
  const rowPaths = rows.map(row => rowFields.map(f => cell(row, f)));
  const colPaths = rows.map(row => columnFields.map(f => cell(row, f)));
  const rowAxis = axisEntries(rowPaths, rowFields.length, model.subtotals, model.totals);
  const colAxis = axisEntries(colPaths, columnFields.length, model.columnSubtotals, model.columnTotals);
  const label = (entry: AxisEntry, fields: Field[], visible = false): string => entry.kind === 'total' ? 'Grand total' : [
    ...entry.cells.map((value, i) => `${visible && model.formatting?.columnNamesVisible === false ? '' : `${fieldName(fields[i]!, model.formatting)}: `}${displayCell(value)}`),
    ...(entry.kind === 'subtotal' ? ['Subtotal'] : []),
  ].join(' / ');
  const matches = (entry: AxisEntry, values: Cell[]): boolean => entry.cells.every((value, i) => value === values[i]);
  const columns = [...rowFields.map(f => fieldName(f, model.formatting)), ...colAxis.flatMap(entry => model.measures.map(f => [label(entry, columnFields), fieldName(f, model.formatting)].filter(Boolean).join(' · ')))];
  const visibleColumns = model.formatting ? [...rowFields.map(f => model.formatting?.rowNamesVisible === false ? '' : fieldName(f, model.formatting)), ...colAxis.flatMap(entry => model.measures.map(f => [label(entry, columnFields, true), model.formatting?.valueNamesVisible === false ? '' : fieldName(f, model.formatting)].filter(Boolean).join(' · ')))] : undefined;
  const output = rows.length ? rowAxis.map(rowEntry => {
    const labels: Cell[] = rowFields.map((_, i) => rowEntry.cells[i] ?? (i === rowEntry.cells.length ? rowEntry.kind === 'total' ? 'Grand total' : 'Subtotal' : ''));
    // A null dimension is a value, not a missing level.
    rowEntry.cells.forEach((value, i) => { labels[i] = value; });
    return [...labels, ...colAxis.flatMap(colEntry => model.measures.map(measure => {
      let total: number | null = null;
      rows.forEach((row, i) => {
        if (!matches(rowEntry, rowPaths[i]!) || !matches(colEntry, colPaths[i]!)) return;
        const value = number(row, measure);
        if (value !== null) total = (total ?? 0) + value;
      });
      if (total !== null && !Number.isFinite(total)) fail(path, 'pivot total must be finite');
      return total;
    }))];
  }) : [];
  let table: CompiledVisual['table'] = { columns, ...(visibleColumns ? { visibleColumns } : {}), rows: output, rowKinds: rows.length ? rowAxis.map(entry => entry.kind) : [] };
  if (model.kind !== 'pivot') return table;
  const pivot = model.formatting?.pivot;
  const metricsOnRows = pivot?.metricPlacement === 'rows';
  const dimensionCount = rowFields.length + (metricsOnRows ? 1 : 0);
  let rowGroupPaths = rows.length ? rowAxis.map(entry => entry.kind === 'total' ? [] : entry.cells) : [];
  if (metricsOnRows) {
    table = {
      columns: [...columns.slice(0, rowFields.length), 'Value', ...colAxis.map(entry => label(entry, columnFields) || 'Value')],
      visibleColumns: [...rowFields.map(f => model.formatting?.rowNamesVisible === false ? '' : fieldName(f, model.formatting)), model.formatting?.valueNamesVisible === false ? '' : 'Value', ...colAxis.map(entry => label(entry, columnFields, true) || (model.formatting?.valueNamesVisible === false ? '' : 'Value'))],
      rows: output.flatMap(row => model.measures.map((measure, m) => [...row.slice(0, rowFields.length), fieldName(measure, model.formatting), ...colAxis.map((_, c) => row[rowFields.length + c * model.measures.length + m]!)])),
      rowKinds: table.rowKinds!.flatMap(kind => model.measures.map(() => kind)),
    };
    rowGroupPaths = rowGroupPaths.flatMap(path => model.measures.map(() => path));
  }
  const measureIndices = table.rows.map((row, i) => row.map((_, j) => j < dimensionCount ? -1 : metricsOnRows ? i % model.measures.length : (j - dimensionCount) % model.measures.length));
  const keptRows = table.rows.flatMap((row, i) => !pivot?.hideEmptyRows || row.slice(dimensionCount).some(value => value !== null) ? [i] : []);
  const keptColumns = table.columns.flatMap((_, j) => j < dimensionCount || !pivot?.hideEmptyColumns || table.rows.some(row => row[j] !== null) ? [j] : []);
  return {
    columns: keptColumns.map(j => table.columns[j]!),
    ...(table.visibleColumns ? { visibleColumns: keptColumns.map(j => table.visibleColumns![j]!) } : {}),
    rows: keptRows.map(i => keptColumns.map(j => table.rows[i]![j]!)),
    rowKinds: keptRows.map(i => table.rowKinds![i]!), dimensionCount,
    measureIndices: keptRows.map(i => keptColumns.map(j => measureIndices[i]![j]!)),
    rowGroupPaths: keptRows.map(i => rowGroupPaths[i]!),
  };
}
