import { formatMetric } from './governed-metrics.js';
import type { EChartsOption } from 'echarts';
import type { VisualModel } from './model.js';
import { LIGHT_THEME, type AnalysisTheme } from './themes.js';
import { hasDataLabels, hasReferenceLines, type LegendTextStyle } from './formatting.js';

/** Legend value-entry text style. The analysis theme owns the font family; the
 *  panel overrides size, color, and emphasis. Underline has no ECharts text
 *  primitive, so the flag stays in the model and exports but never renders. */
export function legendTextStyle(theme: AnalysisTheme, style: LegendTextStyle | undefined, base?: Record<string, unknown>): Record<string, unknown> {
  return { ...base,
    color: style?.color ?? (typeof base?.color === 'string' ? base.color : theme.textColor),
    fontFamily: theme.fontFamily,
    ...(style?.fontSize !== undefined ? { fontSize: style.fontSize } : {}),
    ...(style?.bold ? { fontWeight: 700 } : {}),
    ...(style?.italic ? { fontStyle: 'italic' } : {}),
  };
}

/** Layout and label presentation only; result values and field identities stay unchanged. */
export function applyDisplayOptions(model: VisualModel, option: EChartsOption, theme: AnalysisTheme = LIGHT_THEME): void {
  if (option.legend && !Array.isArray(option.legend)) {
    const side = model.legendPosition === 'LEFT' || model.legendPosition === 'RIGHT';
    const position = model.legendPosition;
    option.legend = { ...option.legend, type: 'scroll', orient: side ? 'vertical' : 'horizontal',
      left: position === 'LEFT' ? 0 : side ? undefined : 'center', right: position === 'RIGHT' ? 0 : undefined,
      top: side ? 'middle' : position === 'TOP' ? 0 : undefined, bottom: !side && position !== 'TOP' ? 0 : undefined,
      ...(side ? { width: 100 } : {}),
    };
    const valueStyle = model.formatting?.legendValueStyle;
    if (valueStyle) option.legend.textStyle = legendTextStyle(theme, valueStyle,
      typeof option.legend.textStyle === 'object' && option.legend.textStyle ? option.legend.textStyle as Record<string, unknown> : undefined);
    if (model.legend) {
      if (option.grid && !Array.isArray(option.grid)) option.grid = { ...option.grid,
        ...(position === 'LEFT' ? { left: 130 } : position === 'RIGHT' ? { right: 130 } : position === 'TOP' ? { top: 48 } : { bottom: 48 }),
      };
      // Faceted (small-multiples) pies lay out their own grid with reserved
      // title/legend padding; the single-pie legend strip must not move them.
      if (model.kind === 'pie' && !model.facet && Array.isArray(option.series)) for (const series of option.series) if (series.type === 'pie') {
        // Reserve a separate legend strip so it never sits on top of pie marks.
        series.left = position === 'LEFT' ? 120 : 0;
        series.right = position === 'RIGHT' ? 120 : 0;
        series.top = position === 'TOP' ? 36 : 0;
        series.bottom = !side && position !== 'TOP' ? 36 : 0;
        series.center = ['50%', '50%'];
        series.label = { ...series.label, overflow: 'break' };
      }
      if (model.kind === 'sankey' && Array.isArray(option.series)) for (const series of option.series) if (series.type === 'sankey') {
        series.left = position === 'LEFT' ? 130 : 24;
        series.right = position === 'RIGHT' ? 150 : 100;
        series.top = position === 'TOP' ? 48 : 24;
        series.bottom = !side && position !== 'TOP' ? 48 : 24;
      }
    }
  }
  if (!Array.isArray(option.series)) return;
  // Governed formats follow the result's field identity, including multi-measure
  // series. Normalized 100% charts retain their derived percentage scale.
  const governedFormats = model.measures.map(m => model.formatting?.metricFormats?.[m.column]);
  if (governedFormats.some(Boolean) && model.kind !== 'bar100') {
    for (const [index, series] of option.series.entries()) {
      const format = governedFormats[index % governedFormats.length];
      if (format) series.tooltip = { ...(typeof series.tooltip === 'object' ? series.tooltip : {}), valueFormatter: (value: unknown) => formatMetric(value, format) ?? String(value ?? '') };
      if (format && 'label' in series && !['pie', 'scatter', 'sankey', 'waterfall'].includes(model.kind)) series.label = { ...series.label, formatter: (params: { value?: unknown }) => formatMetric(model.kind === 'heatmap' && Array.isArray(params.value) ? params.value[2] : params.value, format) ?? '' };
    }
    if (governedFormats.length === 1 && governedFormats[0]) for (const axes of [option.xAxis, option.yAxis]) {
      for (const axis of Array.isArray(axes) ? axes : axes ? [axes] : []) if (axis.type === 'value') axis.axisLabel = { ...axis.axisLabel, formatter: (value: number) => formatMetric(value, governedFormats[0]) ?? String(value) };
    }
  }
  const decimals = model.formatting?.decimalPlaces;
  const dataLabels = model.formatting?.dataLabels;
  const formatNumber = (value: unknown): string => typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : '';
  type LabelParams = { value?: unknown; percent?: number; name?: string; data?: unknown };
  const categoryText = (params: LabelParams): string => {
    if (model.kind === 'sankey') return params.data && typeof params.data === 'object' && 'name' in params.data ? String(params.data.name) : '';
    return params.name ?? '';
  };
  const metricText = (params: LabelParams): string => {
    if (model.kind === 'pie') return decimals !== undefined ? `${formatNumber(params.percent)}%` : `${params.percent ?? ''}%`;
    if (model.kind === 'scatter') {
      const values = Array.isArray(params.value) ? params.value : [params.value];
      return decimals !== undefined ? values.map(formatNumber).join(', ') : values.map(value => value === null || value === undefined ? '' : String(value)).join(', ');
    }
    if (model.kind === 'sankey') return decimals !== undefined ? formatNumber(params.value) : String(params.value ?? '');
    if (model.kind === 'waterfall') {
      const delta = params.data && typeof params.data === 'object' && 'delta' in params.data ? (params.data as { delta?: unknown }).delta : undefined;
      return decimals !== undefined ? formatNumber(delta) : String(delta ?? '');
    }
    const value = model.kind === 'heatmap' && Array.isArray(params.value) ? params.value[2] : params.value;
    const governed = model.measures.length === 1 ? model.formatting?.metricFormats?.[model.measures[0]!.column] : undefined;
    const formatted = formatMetric(value, governed) ?? (decimals !== undefined ? formatNumber(value) : (value === null || value === undefined ? '' : String(value)));
    if (!formatted) return '';
    return `${formatted}${model.kind === 'bar100' ? '%' : ''}`;
  };
  for (const series of option.series) {
    if (series.type === 'bar' && ['bar', 'bar100', 'combo'].includes(model.kind) && model.formatting?.barCategoryGap !== undefined) {
      series.barCategoryGap = `${model.formatting.barCategoryGap}%`;
      // A width cap would mask the gap setting when only a few categories are shown.
      series.barMaxWidth = undefined;
    }
    if (!hasDataLabels(model.kind) || !('label' in series)) continue;
    const label = series.label as unknown as Record<string, unknown>;
    // Position: pie renders inside/outside; cartesian charts use top for outside.
    if (dataLabels?.position === 'inside') label.position = 'inside';
    else if (dataLabels?.position === 'outside') label.position = model.kind === 'pie' ? 'outside' : 'top';
    // Text styling: the theme owns the font family; an explicit color rides at the
    // label top level so the theme pass in compileVisual cannot clobber it.
    if (dataLabels?.style) {
      const base = typeof label.textStyle === 'object' && label.textStyle ? label.textStyle as Record<string, unknown> : {};
      label.textStyle = { ...base, fontFamily: theme.fontFamily,
        ...(dataLabels.style.fontSize !== undefined ? { fontSize: dataLabels.style.fontSize } : {}),
        ...(dataLabels.style.bold ? { fontWeight: 700 } : {}),
        ...(dataLabels.style.italic ? { fontStyle: 'italic' } : {}),
      };
      if (dataLabels.style.color !== undefined) label.color = dataLabels.style.color;
    }
    // Overlap: pie already avoids label overlap; an explicit choice flips the default.
    if (dataLabels?.allowOverlap !== undefined) {
      if (model.kind === 'pie' && series.type === 'pie') (series as unknown as Record<string, unknown>).avoidLabelOverlap = !dataLabels.allowOverlap;
      else (series as unknown as Record<string, unknown>).labelLayout = { hideOverlap: !dataLabels.allowOverlap };
    }
    const content = dataLabels?.content;
    if (content !== undefined) {
      // Explicit label content: the category/metric toggles choose the parts. Both
      // off shows nothing; unset keeps today's default formatter below.
      const showCategory = content.category ?? true;
      const showMetric = content.metric ?? true;
      if (!showCategory && !showMetric) label.show = false;
      else label.formatter = (params: LabelParams): string => {
        const parts: string[] = [];
        if (showCategory) { const text = categoryText(params); if (text) parts.push(text); }
        if (showMetric) { const text = metricText(params); if (text) parts.push(text); }
        return parts.join(': ');
      };
    } else if (decimals !== undefined && !governedFormats.some(Boolean)) {
      series.label = { ...series.label, formatter: (params: { value?: unknown; percent?: number; name?: string; data?: unknown }): string => {
        if (model.kind === 'pie') return `${params.name ?? ''}: ${formatNumber(params.percent)}%`;
        if (model.kind === 'scatter') return `${params.name ?? ''}: ${Array.isArray(params.value) ? params.value.map(formatNumber).join(', ') : formatNumber(params.value)}`;
        if (model.kind === 'sankey') {
          const name = params.data && typeof params.data === 'object' && 'name' in params.data ? String(params.data.name) : '';
          return `${name}: ${formatNumber(params.value)}`;
        }
        if (model.kind === 'waterfall') return formatNumber(params.data && typeof params.data === 'object' && 'delta' in params.data ? params.data.delta : undefined);
        const value = model.kind === 'heatmap' && Array.isArray(params.value) ? params.value[2] : params.value;
        const formatted = formatNumber(value);
        if (!formatted) return '';
        return ['funnel', 'treemap', 'filledMap'].includes(model.kind) ? `${params.name ?? ''}: ${formatted}` : `${formatted}${model.kind === 'bar100' ? '%' : ''}`;
      } };
    }
  }
  // Reference lines as ECharts markLines on cartesian charts; horizontal bars use the x axis for values.
  if (model.referenceLines?.length && hasReferenceLines(model.kind) && Array.isArray(option.series)) {
    const axis = model.horizontal ? 'xAxis' : 'yAxis';
    const markLine = {
      silent: true,
      symbol: 'none',
      label: { formatter: '{b}', color: '#202938', fontSize: 11 },
      lineStyle: { type: 'dashed' as const },
      data: model.referenceLines.map(line => ({
        name: line.label || String(line.value),
        [axis]: line.value,
        label: { color: line.color },
        lineStyle: { color: line.color },
      })),
    };
    for (const series of option.series) {
      if (series.type === 'bar' || series.type === 'line' || series.type === 'scatter') {
        (series as Record<string, unknown>).markLine = markLine;
      }
    }
  }
}
