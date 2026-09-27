import type { EChartsOption, SeriesOption, TreemapSeriesOption } from 'echarts';
import type { Cell, Field, Row, VisualModel } from './model.js';
import { countryNames, WORLD_MAP } from './geo/world.js';

type CellReader = (row: Row, field: Field) => Cell;
type NumberReader = (row: Row, field: Field) => number | null;
const label = (v: Cell) => v === null ? '(null)' : String(v);
const quartile = (values: number[], p: number): number => {
  const position = (values.length - 1) * p, lo = Math.floor(position), hi = Math.ceil(position);
  return values[lo]! * (1 - position + lo) + values[hi]! * (position - lo);
};
/** Distributions describe supplied result values; they never pretend to recover raw observations. */
export function compileExtra(model: VisualModel, rows: Row[], cell: CellReader, number: NumberReader, option: EChartsOption, fail: (message: string) => never): void {
  const names = rows.map(r => model.dimensions[0] ? label(cell(r, model.dimensions[0])) : '');
  const values = (i = 0) => rows.map(r => number(r, model.measures[i]!));
  const nonnegative = (r: Row, i = 0): number => {
    const n = number(r, model.measures[i]!);
    if (n === null || n < 0) fail(`${model.kind} requires nonnegative, non-null values`);
    return n;
  };
  const scale = (data: number[]) => ({ min: Math.min(0, ...data), max: Math.max(1, ...data), calculable: false, orient: 'horizontal' as const, bottom: 0, left: 'center' });
  option.tooltip = { show: model.tooltip, trigger: 'item', renderMode: 'richText', confine: true };
  const axes = () => {
    option.grid = { left: 50, right: 24, top: 35, bottom: 55, containLabel: true };
    option.xAxis = { type: 'category', data: names };
    option.yAxis = { type: 'value' };
  };
  if (['area', 'combo', 'bar100'].includes(model.kind)) {
    axes();
    const percent = model.kind === 'bar100';
    const totals = percent ? rows.map(r => model.measures.reduce((sum, _, i) => sum + nonnegative(r, i), 0)) : [];
    if (totals.some(n => !Number.isFinite(n))) fail('percentage total must be finite');
    const valueAxis = { type: 'value' as const, ...(percent ? { min: 0, max: 100, axisLabel: { formatter: '{value}%' } } : {}) };
    if (model.horizontal) { option.yAxis = { type: 'category', data: names, inverse: true }; option.xAxis = valueAxis; }
    else option.yAxis = valueAxis;
    option.legend = { show: model.legend, bottom: 0 };
    option.series = model.measures.map((f, i): SeriesOption => {
      const data = values(i).map((n, j) => percent ? totals[j] ? (n! / totals[j]!) * 100 : 0 : n);
      return percent || model.kind === 'combo' && i === 0 ? { type: 'bar', name: f.column, data, ...(percent ? { stack: 'percent' } : {}), label: { show: model.labels }, barMaxWidth: 72 }
        : { type: 'line', name: f.column, data, connectNulls: false, ...(model.kind === 'area' ? { areaStyle: { opacity: 0.3 } } : {}), label: { show: model.labels } };
    });
  } else if (model.kind === 'scatter') {
    axes(); option.xAxis = { type: 'value', name: model.measures[0]!.column }; option.yAxis = { type: 'value', name: model.measures[1]!.column };
    option.series = [{ type: 'scatter', data: rows.map((r, i) => ({ name: names[i], value: model.measures.map(f => number(r, f)), symbolSize: model.measures[2] ? Math.min(60, 8 + Math.sqrt(nonnegative(r, 2))) : 12 })), label: { show: model.labels, formatter: '{b}' } }];
  } else if (model.kind === 'funnel') {
    option.series = [{ type: 'funnel', sort: 'none', left: '15%', width: '70%', top: 20, bottom: 20, label: { show: model.labels }, data: rows.map((r, i) => ({ name: names[i]!, value: nonnegative(r) })) }];
  } else if (model.kind === 'gauge') {
    if (rows.length > 1) fail('Gauge expects one aggregate row and a single measure');
    option.series = [{ type: 'gauge', min: model.gaugeMin, max: model.gaugeMax, progress: { show: true }, detail: { formatter: '{value}', fontSize: 22 }, data: rows.length && values()[0] !== null ? [{ name: model.measures[0]!.column, value: values()[0]! }] : [] }];
    if (rows.length && values()[0] === null) model.warnings.push('Gauge measure is null; no needle value is shown.');
  } else if (model.kind === 'treemap') {
    type Node = { name: string; value?: number; children?: Node[] };
    const root: Node[] = [];
    rows.forEach(r => {
      let level = root;
      model.dimensions.forEach((f, i) => {
        const name = label(cell(r, f));
        let node = level.find(n => n.name === name);
        if (!node) { node = { name }; level.push(node); }
        if (i === model.dimensions.length - 1) node.value = nonnegative(r);
        else { node.children ??= []; level = node.children; }
      });
    });
    option.series = [{ type: 'treemap', roam: false, nodeClick: false, breadcrumb: { show: false }, label: { show: model.labels }, data: root } satisfies TreemapSeriesOption];
  } else if (model.kind === 'heatmap') {
    const xs = [...new Set(names)], ys = [...new Set(rows.map(r => label(cell(r, model.dimensions[1]!))))];
    axes(); option.xAxis = { type: 'category', data: xs }; option.yAxis = { type: 'category', data: ys };
    option.visualMap = scale(values().filter((n): n is number => n !== null));
    option.series = [{ type: 'heatmap', label: { show: model.labels }, data: rows.map((r, i) => [xs.indexOf(names[i]!), ys.indexOf(label(cell(r, model.dimensions[1]!))), number(r, model.measures[0]!)]) }];
  } else if (model.kind === 'box') {
    const groups = [...new Set(names)];
    const data = groups.map(name => values().filter((n, i): n is number => n !== null && names[i] === name).sort((a, b) => a - b)).map(v => v.length ? [v[0]!, quartile(v, .25), quartile(v, .5), quartile(v, .75), v[v.length - 1]!] : Array<never | '-'>(5).fill('-'));
    axes(); option.xAxis = { type: 'category', data: groups }; option.series = [{ type: 'boxplot', data }];
  } else if (model.kind === 'histogram') {
    const samples = values().filter((n): n is number => n !== null), min = Math.min(...samples), max = Math.max(...samples);
    const count = min === max ? 1 : model.bins, width = min === max ? 1 : (max - min) / count;
    if (samples.length && !Number.isFinite(width)) fail('histogram range must be finite');
    const bins = samples.length ? Array<number>(count).fill(0) : [];
    samples.forEach(n => { const index = Math.min(count - 1, Math.floor((n - min) / width)); bins[index] = bins[index]! + 1; });
    axes(); option.xAxis = { type: 'category', name: model.measures[0]!.column, data: bins.map((_, i) => `${+(min + i * width).toPrecision(6)}–${+(min + (i + 1) * width).toPrecision(6)}`) };
    option.yAxis = { type: 'value', name: 'Frequency', minInterval: 1 }; option.series = [{ type: 'bar', barCategoryGap: '0%', data: bins, label: { show: model.labels } }];
  } else if (model.kind === 'wordCloud') {
    const words = rows.map((r, i) => ({ name: names[i]!, value: nonnegative(r), i })).sort((a, b) => b.value - a.value || a.i - b.i).slice(0, 80);
    const max = Math.max(1, ...words.map(w => w.value));
    // A fixed virtual grid makes the layout deterministic in SSR and responsive in browsers.
    option.xAxis = { show: false, min: 0, max: 100 }; option.yAxis = { show: false, min: 0, max: 100 }; option.grid = { left: 5, right: 5, top: 5, bottom: 5 };
    const columns = Math.min(4, Math.ceil(Math.sqrt(words.length || 1))), lines = Math.ceil(words.length / columns);
    option.series = [{ type: 'scatter', symbolSize: 0, data: words.map((w, i) => ({ name: w.name, value: [(i % columns + .5) * 100 / columns, 100 - (Math.floor(i / columns) + .5) * 100 / lines, w.value], label: { show: true, position: 'inside', formatter: w.name.length > 22 ? w.name.slice(0, 21) + '…' : w.name, fontSize: Math.min(30, 11 + 19 * Math.sqrt(w.value / max), 160 / Math.max(1, w.name.length)), color: Array.isArray(option.color) ? option.color[i % option.color.length] as string : '#157f88' } })) }];
    if (rows.length > 80) model.warnings.push(`Word cloud displays 80 of ${rows.length} words; View data retains all supplied rows.`);
  } else if (model.kind === 'filledMap') {
    const unknown = names.filter(n => !countryNames.has(n));
    if (unknown.length) fail(`Map needs matching country fields. Unknown countries: ${unknown.slice(0, 8).join(', ')}. No geocoding is available.`);
    option.visualMap = scale(values().filter((n): n is number => n !== null));
    option.series = [{ type: 'map', map: WORLD_MAP, roam: true, label: { show: model.labels }, data: rows.map((r, i) => ({ name: names[i]!, ...(number(r, model.measures[0]!) === null ? {} : { value: number(r, model.measures[0]!)! }) })) }];
  } else if (model.kind === 'pointMap') {
    option.geo = { map: WORLD_MAP, roam: true, itemStyle: { areaColor: '#e3ebef', borderColor: '#81939d' } };
    option.series = [{ type: 'scatter', coordinateSystem: 'geo', data: rows.map(r => {
      const lat = cell(r, model.dimensions[0]!), lon = cell(r, model.dimensions[1]!);
      if (typeof lat !== 'number' || typeof lon !== 'number' || Math.abs(lat) > 90 || Math.abs(lon) > 180) fail('Point map needs numeric latitude [-90,90] and longitude [-180,180] geo fields');
      const value = nonnegative(r); return { value: [lon, lat, value], symbolSize: Math.min(50, 6 + Math.sqrt(value)) };
    }) }];
  }
}
