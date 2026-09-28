import { LIGHT_THEME, themeValid, paletteValid } from './themes.js';
import { formattingValid, fieldName, matchingRule, LEGEND_POSITIONS, type LegendPosition } from './formatting.js';
import type { EChartsOption, BarSeriesOption, LineSeriesOption } from 'echarts';
import type { Cell, Field, FixtureVisual, Row, VisualModel } from './model.js';

import { EXTRA_VISUALS, extraKind, variantKinds } from './visual-catalog.js';
import { compileExtra } from './extra-charts.js';
import { applyDisplayOptions } from './display-options.js';

type ObjectValue = Record<string, unknown>;
type Input = Pick<FixtureVisual, 'source' | 'rows' | 'bindings' | 'path' | 'theme'> & { definition: unknown };
export interface CompiledVisual {
  model: VisualModel;
  option: EChartsOption;
  /** Ordered, validated cells also used by the accessible HTML data table. */
  table: { columns: string[]; visibleColumns?: string[]; rows: Cell[][]; rowKinds?: ('detail' | 'subtotal' | 'total')[];
    /** Pivot layouts can move or hide measures; retain their identities for cell formatting. */
    dimensionCount?: number; measureIndices?: number[][] };
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

/** Explicit dialect selection; camelCase includes the API converter's projections. */
export function normalizeVisual(source: Input['source'], definition: Input['definition'], path = '$'): VisualModel {
  if (source !== 'api' && source !== 'bundle') fail(path, 'unknown definition dialect');
  const bundle = source === 'bundle';
  const key = (archive: string, api: string): string => bundle ? archive : api;
  const visual = object(definition, path);
  const entries = Object.entries(visual);
  if (entries.length !== 1) fail(path, 'expected exactly one visual variant');
  const [variant, raw] = entries[0]!;
  const kinds = bundle ? variantKinds : Object.fromEntries(Object.entries(variantKinds).map(([name, kind]) => [name === 'kpiVisual' ? 'KPIVisual' : name[0]!.toUpperCase() + name.slice(1), kind]));
  let kind = Object.hasOwn(kinds, variant) ? kinds[variant] : undefined;
  if (!kind) fail(`${path}.${variant}`, 'unsupported visual variant in this dialect');
  const p = `${path}.${variant}`;
  const body = object(raw, p);
  keys(body, [key('opensightFormatting', 'OpenSightFormatting'), key('opensightPalette', 'OpenSightPalette'), key('visualId', 'VisualId'), key('title', 'Title'), key('subtitle', 'Subtitle'), key('chartConfiguration', 'ChartConfiguration'), key('actions', 'Actions'), key('columnHierarchies', 'ColumnHierarchies')], p);
  for (const name of [key('actions', 'Actions'), key('columnHierarchies', 'ColumnHierarchies')]) {
    if (list(body[name], `${p}.${name}`).length) fail(`${p}.${name}`, 'actions and drill hierarchies are not supported');
  }
  const palette = body[key('opensightPalette', 'OpenSightPalette')];
  if (palette !== undefined && !paletteValid(palette)) fail(p, 'invalid visual palette');
  const formatting = body[key('opensightFormatting', 'OpenSightFormatting')];
  if (formatting !== undefined && !formattingValid(formatting)) fail(p, 'invalid visual formatting');
  const id = text(body[key('visualId', 'VisualId')], p);
  const cpath = `${p}.${key('chartConfiguration', 'ChartConfiguration')}`;
  const config = object(body[key('chartConfiguration', 'ChartConfiguration')], cpath);
  if (kind === 'bar' && config[key('barsArrangement', 'BarsArrangement')] === 'STACKED_PERCENT') kind = 'bar100';
  if (kind === 'line' && config[key('type', 'Type')] === 'AREA') kind = 'area';
  const extra = extraKind(kind) ? EXTRA_VISUALS[kind] : undefined;
  const common = [key('fieldWells', 'FieldWells')];
  if (kind !== 'kpi' && kind !== 'table' && kind !== 'pivot') common.push(key('sortConfiguration', 'SortConfiguration'), key('dataLabels', 'DataLabels'), key('tooltip', 'Tooltip'), key('legend', 'Legend'));
  if (kind === 'pie') common.push(key('donutOptions', 'DonutOptions'));
  if (kind === 'bar' || kind === 'bar100') common.push(key('orientation', 'Orientation'), key('barsArrangement', 'BarsArrangement'));
  if (kind === 'table' || kind === 'pivot') common.push(key('totalOptions', 'TotalOptions'));
  if (kind === 'table') common.push(key('opensightSubtotalOptions', 'OpenSightSubtotalOptions'));
  if (kind === 'area') common.push(key('type', 'Type'));
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
  const unused = [key('colors', 'Colors'), key('smallMultiples', 'SmallMultiples'), key('targetValues', 'TargetValues'), key('trendGroups', 'TrendGroups')];
  const wellKey = (name: string) => key(name, name.startsWith('opensight') ? `OpenSight${name.slice(9)}` : name[0]!.toUpperCase() + name.slice(1));
  keys(wells, [...(extra ? [...extra.dimensions, ...extra.measures].map(wellKey) : [categoryKey, valueKey]), ...(kind === 'pivot' ? [key('columns', 'Columns')] : []), ...unused], wpath);
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
      if (agg[sumKey] !== 'SUM') fail(`${fp}.${aggKey}`, 'only explicit SUM result bindings are supported');
    }
    if (name === key('dateDimensionField', 'DateDimensionField')) enumValue(f[key('dateGranularity', 'DateGranularity')], ['DAY', 'MONTH', 'QUARTER', 'YEAR'], 'DAY', `${fp}.${key('dateGranularity', 'DateGranularity')}`);
    const column = object(f[key('column', 'Column')], `${fp}.${key('column', 'Column')}`);
    keys(column, [key('columnName', 'ColumnName'), key('dataSetIdentifier', 'DataSetIdentifier')], fp);
    return {
      id: text(f[key('fieldId', 'FieldId')], fp),
      column: text(column[key('columnName', 'ColumnName')], fp),
      dataSet: text(column[key('dataSetIdentifier', 'DataSetIdentifier')], fp),
    };
  };
  const dimensionNames = extra ? extra.dimensions.map(wellKey) : [categoryKey];
  const measureNames = extra ? extra.measures.map(wellKey) : [valueKey];
  const rowDimensions = dimensionNames.flatMap(name => list(wells[name], `${wpath}.${name}`).map((v, i) => field(v, false, `${wpath}.${name}[${i}]`)));
  const columnDimensions = kind === 'pivot' ? list(wells[key('columns', 'Columns')], wpath).map((v, i) => field(v, false, `${wpath}.columns[${i}]`)) : [];
  const dimensions = [...rowDimensions, ...columnDimensions];
  const measures = measureNames.flatMap(name => list(wells[name], `${wpath}.${name}`).map((v, i) => field(v, true, `${wpath}.${name}[${i}]`)));
  if (extra) {
    const d = dimensions.length, m = measures.length;
    const validDimensions = kind === 'gauge' ? d === 0 : kind === 'scatter' || kind === 'histogram' ? d <= 1 : kind === 'heatmap' || kind === 'pointMap' ? d === 2 && dimensionNames.every(n => list(wells[n], wpath).length === 1) : kind === 'treemap' || kind === 'box' ? d >= 1 : d === 1;
    const validMeasures = kind === 'scatter' ? m >= 2 && m <= 3 && measureNames.slice(0, 2).every(n => list(wells[n], wpath).length === 1) && list(wells[measureNames[2]!], wpath).length <= 1 : kind === 'combo' ? m >= 2 && list(wells[measureNames[0]!], wpath).length === 1 && measureNames.every(n => list(wells[n], wpath).length >= 1) : kind === 'bar100' || kind === 'area' ? m >= 1 : m === 1;
    if (!validDimensions || !validMeasures) fail(wpath, extra.note);
  } else {
    if (kind === 'kpi' ? dimensions.length !== 0 : kind === 'pivot' || kind === 'table' ? dimensions.length < 1 : dimensions.length !== 1) fail(wpath, kind === 'kpi' ? 'KPI must have no category' : 'exactly one category/group field is supported');
    if (!measures.length || ((kind === 'pie' || kind === 'kpi') && measures.length !== 1)) fail(wpath, 'expected supported number of measures (pie/KPI: one)');
  }
  const fields = [...dimensions, ...measures];
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
  keys(tooltip, [key('tooltipVisibility', 'TooltipVisibility'), key('selectedTooltipType', 'SelectedTooltipType'), key('fieldBasedTooltip', 'FieldBasedTooltip')], cpath);
  if (tooltip[key('fieldBasedTooltip', 'FieldBasedTooltip')] !== undefined || tooltip[key('selectedTooltipType', 'SelectedTooltipType')] !== undefined) warnings.push(`${cpath}.${key('tooltip', 'Tooltip')}: detailed tooltip formatting is approximated with category and value.`);
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
    if (thickness !== 'WHOLE') warnings.push(`${cpath}: donut radii are OpenSight approximations, not measured QuickSight geometry.`);
  }
  const sort = object(config[key('sortConfiguration', 'SortConfiguration')] ?? {}, cpath);
  const sortsKey = key('categorySort', 'CategorySort');
  keys(sort, [sortsKey, key('categoryItemsLimit', 'CategoryItemsLimit'), key('smallMultiplesLimitConfiguration', 'SmallMultiplesLimitConfiguration')], cpath);
  for (const limitKey of [key('categoryItemsLimit', 'CategoryItemsLimit'), key('smallMultiplesLimitConfiguration', 'SmallMultiplesLimitConfiguration')]) {
    if (sort[limitKey] !== undefined) {
      const limit = object(sort[limitKey], `${cpath}.${limitKey}`);
      keys(limit, [key('otherCategories', 'OtherCategories')], `${cpath}.${limitKey}`);
      enumValue(limit[key('otherCategories', 'OtherCategories')], ['INCLUDE'], 'INCLUDE', cpath);
      warnings.push(`${cpath}.${limitKey}: no top-N/Other bucket is computed; all supplied result rows are shown.`);
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
    id, kind, ...(formattingValid(formatting) ? { formatting } : {}), ...(palette ? { palette: palette as string[] } : {}), gaugeMin, gaugeMax, bins, title: plain as string | undefined ?? `${measures.map(f => fieldName(f, formattingValid(formatting) ? formatting : undefined)).join(', ')}${dimensions[0] ? ` by ${fieldName(dimensions[0], formattingValid(formatting) ? formatting : undefined)}` : ''}`,
    titleVisible: visibility(title, key('visibility', 'Visibility')),
    subtitle: subtitleText, subtitleVisible: visibility(subtitle, key('visibility', 'Visibility')),
    legendPosition: enumValue(legend[key('position', 'Position')] ?? (formattingValid(formatting) ? formatting.legendPosition : undefined), [...LEGEND_POSITIONS], 'BOTTOM', `${cpath}.legend.position`) as LegendPosition,
    dimensions, rowDimensions, columnDimensions, measures, totals, subtotals, columnTotals, columnSubtotals, innerRadius, sort: fieldSort, warnings,
    horizontal: (kind === 'bar' || kind === 'bar100') && enumValue(config[key('orientation', 'Orientation')], ['VERTICAL', 'HORIZONTAL'], 'VERTICAL', `${cpath}.${key('orientation', 'Orientation')}`) === 'HORIZONTAL',
    stacked: kind === 'bar' && enumValue(config[key('barsArrangement', 'BarsArrangement')], ['CLUSTERED', 'STACKED'], 'CLUSTERED', `${cpath}.${key('barsArrangement', 'BarsArrangement')}`) === 'STACKED',
    labels: visibility(labels, key('visibility', 'Visibility'), kind === 'pie' ? 'VISIBLE' : 'HIDDEN'),
    tooltip: visibility(tooltip, key('tooltipVisibility', 'TooltipVisibility')),
    legend: visibility(legend, key('visibility', 'Visibility')),
  };
}

/** Pure renderer: rows must already be authorized, filtered and aggregated. No query execution. */
export function compileVisual(input: Input): CompiledVisual {
  if (input.theme !== undefined && !themeValid(input.theme)) fail(input.path, 'invalid analysis theme');
  const theme = input.theme ?? LIGHT_THEME;
  const model = normalizeVisual(input.source, input.definition, input.path);
  const fields = [...model.dimensions, ...model.measures];
  for (const fieldId of Object.keys(input.bindings)) if (!fields.some(f => f.id === fieldId)) fail(input.path, `binding references unknown field ${fieldId}`);
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
  if (model.dimensions[0] && !['box', 'histogram', 'scatter', 'pointMap'].includes(model.kind)) {
    const categories = rows.map(row => JSON.stringify(model.dimensions.map(f => cell(row, f))));
    if (new Set(categories).size !== categories.length) fail(input.path, 'duplicate categories: expected aggregated result rows');
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
  if (extraKind(model.kind)) {
    compileExtra(model, rows, cell, number, option, message => fail(input.path, message));
  } else if (model.kind === 'pie') {
    const measure = model.measures[0]!;
    option.legend = { show: model.legend, bottom: 4, type: 'scroll' };
    option.series = [{
      type: 'pie', name: fieldName(measure, model.formatting), radius: [model.innerRadius, '70%'], center: ['50%', '45%'],
      showEmptyCircle: false, stillShowZeroSum: false, avoidLabelOverlap: true,
      label: { show: model.labels, formatter: '{b}: {d}%' }, labelLine: { show: model.labels },
      data: rows.map(row => {
        const value = number(row, measure);
        if (value === null || value < 0) fail(input.path, 'pie values must be nonnegative numbers; null slices are unsupported');
        return { name: displayCell(cell(row, model.dimensions[0]!)), value };
      }),
    }];
  } else if (model.kind === 'bar' || model.kind === 'line') {
    const category = { type: 'category' as const, data: rows.map(row => displayCell(cell(row, model.dimensions[0]!))), axisLabel: { hideOverlap: true }, ...(model.horizontal ? { inverse: true } : {}) };
    const value = { type: 'value' as const, splitLine: { lineStyle: { color: '#e7edef' } } };
    option.grid = { left: 20, right: 24, top: 36, bottom: 40, outerBoundsMode: 'same', outerBoundsContain: 'axisLabel' };
    option.xAxis = model.horizontal ? value : category;
    option.yAxis = model.horizontal ? category : value;
    option.legend = { show: model.legend, bottom: 0 };
    option.series = model.measures.map((field): BarSeriesOption | LineSeriesOption => model.kind === 'bar' ? {
      type: 'bar', name: fieldName(field, model.formatting), data: rows.map(row => number(row, field)),
      barMaxWidth: 72, ...(model.stacked ? { stack: 'values' } : {}),
      label: { show: model.labels },
    } : {
      type: 'line', name: fieldName(field, model.formatting), data: rows.map(row => number(row, field)),
      connectNulls: false, symbolSize: 8, label: { show: model.labels },
    });
  } else if (model.kind === 'kpi') {
    if (rows.length > 1) fail(input.path, 'KPI expects exactly one aggregate row, not a client-side sum');
    const row = rows[0];
    const value = row ? number(row, model.measures[0]!) : null;
    const label = state === 'unavailable' ? 'Data unavailable' : state === 'empty' ? 'No results' : value === null ? 'No value' : displayCell(value);
    option.tooltip = { show: false };
    option.graphic = [{ type: 'text', left: 'center', top: 'middle', style: { text: label, fill: (model.palette ?? theme.palette)[0], fontSize: value === null ? 22 : 56, fontWeight: 600, fontFamily: theme.fontFamily } }];
  }
  applyDisplayOptions(model, option);
  if (input.theme || model.palette) {
    for (const axis of [option.xAxis, option.yAxis].flat()) if (axis) { axis.axisLabel = { ...axis.axisLabel, color: theme.textColor }; axis.nameTextStyle = { color: theme.textColor }; }
    if (option.legend && !Array.isArray(option.legend)) option.legend.textStyle = { color: theme.textColor, fontFamily: theme.fontFamily };
    if (option.visualMap && !Array.isArray(option.visualMap)) { option.visualMap.textStyle = { color: theme.textColor }; option.visualMap.inRange = { color: [theme.surface, ...(model.palette ?? theme.palette)] }; }
    if (Array.isArray(option.series)) for (const series of option.series) {
      if ('label' in series) series.label = { ...series.label, color: theme.textColor };
      if (series.type === 'gauge') { series.itemStyle = { color: (model.palette ?? theme.palette)[0] }; series.axisLabel = { color: theme.textColor }; series.detail = { ...series.detail, color: theme.textColor }; series.title = { color: theme.textColor }; }
    }
  }
  // Rules evaluate supplied measures, before chart-specific transforms such as percentages.
  if (model.formatting?.rules?.length && ['bar', 'line', 'pie', 'scatter', 'funnel', 'area', 'combo', 'bar100'].includes(model.kind) && Array.isArray(option.series)) {
    option.series.forEach((series, index) => {
      if (!('data' in series) || !Array.isArray(series.data)) return;
      const measures = model.kind === 'scatter' ? model.measures : [model.measures[index] ?? model.measures[0]!];
      series.data = series.data.map((datum: unknown, rowIndex: number) => {
        const row = rows[rowIndex];
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
  return { model, option, state, table: { columns: fields.map(f => fieldName(f, model.formatting)), rows: rows.map(row => fields.map(field => cell(row, field))),
    ...(model.formatting ? { visibleColumns: fields.map(f => (model.measures.includes(f) ? model.formatting?.valueNamesVisible : model.formatting?.rowNamesVisible) === false ? '' : fieldName(f, model.formatting)) } : {}),
  } };
}

export function displayCell(value: Cell): string {
  return value === null ? '(null)' : typeof value === 'number' ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 12 }).format(value) : String(value);
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
  if (metricsOnRows) {
    table = {
      columns: [...columns.slice(0, rowFields.length), 'Value', ...colAxis.map(entry => label(entry, columnFields) || 'Value')],
      visibleColumns: [...rowFields.map(f => model.formatting?.rowNamesVisible === false ? '' : fieldName(f, model.formatting)), model.formatting?.valueNamesVisible === false ? '' : 'Value', ...colAxis.map(entry => label(entry, columnFields, true) || (model.formatting?.valueNamesVisible === false ? '' : 'Value'))],
      rows: output.flatMap(row => model.measures.map((measure, m) => [...row.slice(0, rowFields.length), fieldName(measure, model.formatting), ...colAxis.map((_, c) => row[rowFields.length + c * model.measures.length + m]!)])),
      rowKinds: table.rowKinds!.flatMap(kind => model.measures.map(() => kind)),
    };
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
  };
}
