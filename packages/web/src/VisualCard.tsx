import { LIGHT_THEME } from './themes.js';
import { fieldRule } from './formatting.js';
import { rowSelection, brushSelection, type VisualInteraction } from './visual-selection.js';
import { useEffect, useId, useMemo, useRef, type CSSProperties } from 'react';
import type { EChartsOption } from 'echarts';
import { compileVisual, displayCell } from './compiler.js';
import type { CompiledVisual } from './compiler.js';
import type { FixtureVisual } from './model.js';
import { init } from './echarts.js';

function Chart({ option, title, compiled, interaction }: { option: EChartsOption; title: string; compiled: CompiledVisual; interaction?: VisualInteraction }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!container.current) return;
    const chart = init(container.current, undefined, { renderer: 'svg' });
    chart.setOption(interaction?.brush ? { ...option, brush: { toolbox: ['lineX', 'clear'], xAxisIndex: 0, brushMode: 'single', throttleType: 'debounce', throttleDelay: 100 } } : option, { notMerge: true });
    if (interaction) {
      chart.on('click', event => { if (!['wordCloud', 'histogram', 'box', 'treemap', 'filledMap'].includes(compiled.model.kind) && (event.componentType === 'series' && typeof event.dataIndex === 'number')) { const selection = rowSelection(compiled, event.dataIndex); if (selection) interaction.onSelect(selection); } });
      if (interaction.brush) chart.on('brushEnd', (event: unknown) => {
        const areas = (event as { areas?: { coordRange?: unknown }[] }).areas;
        if (!areas?.length) interaction.onClear?.();
        else { const selection = brushSelection(compiled, areas[0]?.coordRange); if (selection) interaction.onSelect(selection); }
      });
    }
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(container.current);
    return () => { observer.disconnect(); chart.dispose(); };
  }, [option, compiled, interaction]);
  return <div ref={container} className="chart" role="img" aria-label={title} />;
}

function DataTable({ compiled, interaction }: { compiled: CompiledVisual; interaction?: VisualInteraction }) {
  const { model, table } = compiled, f = model.formatting;
  const dimensionCount = table.dimensionCount ?? (model.kind === 'pivot' ? model.rowDimensions.length : model.dimensions.length);
  const pivot = model.kind === 'pivot' ? f?.pivot : undefined;
  const width = pivot?.columnWidth ?? (pivot?.wordWrap ? 140 : undefined);
  const cellStyle: CSSProperties = { ...(pivot?.wordWrap !== undefined ? { whiteSpace: pivot.wordWrap ? 'normal' : 'nowrap', overflowWrap: pivot.wordWrap ? 'anywhere' : undefined } : {}), ...(width ? { width, minWidth: width, maxWidth: width } : {}) };
  const formatted = (value: import('./model.js').Cell, index: number) => typeof value === 'number' && index >= dimensionCount && f?.decimalPlaces !== undefined ? value.toLocaleString('en-US', { minimumFractionDigits: f.decimalPlaces, maximumFractionDigits: f.decimalPlaces }) : displayCell(value);
  return <div className="table-scroll"><table style={{ fontSize: f?.fontSize, color: f?.cellColor, background: f?.cellBackground, ...(width ? { tableLayout: 'fixed', width: width * table.columns.length } : {}) }}>
    <caption className="sr-only">{compiled.model.title} — result data</caption>
    <thead className={f?.headersVisible === false ? 'sr-only' : undefined}><tr>{table.columns.map((column, i) => <th key={i} scope="col" style={{ ...cellStyle, color: f?.headerColor, background: f?.headerBackground }}>{table.visibleColumns?.[i] === '' ? <span className="sr-only">{column}</span> : table.visibleColumns?.[i] ?? column}</th>)}</tr></thead>
    <tbody>{table.rows.map((row, i) => <tr key={i} className={table.rowKinds?.[i]} onClick={interaction && rowSelection(compiled, i) ? () => interaction.onSelect(rowSelection(compiled, i)!) : undefined}>{row.map((cell, j) => {
      const measure = j >= dimensionCount ? model.measures[table.measureIndices?.[i]?.[j] ?? (j - dimensionCount) % model.measures.length] : undefined;
      const rule = measure && fieldRule(f, measure, cell);
      return <td key={j} style={{ ...cellStyle, ...(rule ? { color: rule.color, background: rule.background } : {}) }}>{pivot?.metricPlacement === 'rows' && j === dimensionCount - 1 && f?.valueNamesVisible === false ? <span className="sr-only">{formatted(cell, j)}</span> : j === 0 && interaction && rowSelection(compiled, i) ? <button type="button" onClick={event => { event.stopPropagation(); interaction.onSelect(rowSelection(compiled, i)!); }}>{formatted(cell, j)}</button> : formatted(cell, j)}</td>;
    })}</tr>)}</tbody>
  </table></div>;
}

export function VisualCard({ visual, dataMessage, loading = false, interaction }: { visual: FixtureVisual; dataMessage?: string; loading?: boolean; interaction?: VisualInteraction }) {
  const headingId = useId();
  const theme = visual.theme ?? LIGHT_THEME;
  const result = useMemo(() => {
    try { return { compiled: compileVisual(visual) }; }
    catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
  }, [visual]);
  const { compiled, error } = result;
  const { column, columns, row, rows } = visual.placement;
  return <section className="visual-card" aria-busy={loading} aria-labelledby={headingId} style={{ '--visual-header': theme.background, background: theme.surface, color: theme.textColor, fontFamily: theme.fontFamily, gridColumn: `${column + 1} / span ${columns}`, gridRow: `${row + 1} / span ${rows}` } as CSSProperties}>
    <header className="card-heading">
      <div className="card-titles">
        <h3 id={headingId} style={{ fontSize: compiled?.model.formatting?.titleFontSize }} className={compiled && !compiled.model.titleVisible ? 'sr-only' : ''}>{compiled?.model.title ?? 'Unsupported visual'}</h3>
        {compiled?.model.subtitle && compiled.model.subtitleVisible && <p className="card-subtitle">{compiled.model.subtitle}</p>}
      </div>
      {compiled && <span className="chart-kind">{compiled.model.kind}</span>}
    </header>
    {error && <div className="visual-error" role="alert"><strong>Unable to render</strong><p>{error}</p></div>}
    {compiled && <>
      <div className="visual-content">
        {!loading && ((compiled.model.kind === 'table' || compiled.model.kind === 'pivot') ? <DataTable compiled={compiled} interaction={interaction} /> : <Chart option={compiled.option} title={compiled.model.title} compiled={compiled} interaction={interaction} />)}
        {compiled.state !== 'ready' && <div className="empty-state" role="status">
          <span className="empty-symbol" aria-hidden="true">◌</span>
          <strong>{loading ? 'Loading data…' : compiled.state === 'unavailable' ? 'Data unavailable' : 'No results'}</strong>
          <p>{loading ? 'Computing the assigned fields from local sales data.' : dataMessage ?? (compiled.state === 'unavailable' ? 'The chart definition is loaded. No matching precomputed fixture rows are available.' : 'The supplied result set is empty.')}</p>
          <small>{compiled.model.measures.map(f => `SUM(${f.column})`).join(', ')}{compiled.model.dimensions[0] && ` by ${compiled.model.dimensions[0].column}`}</small>
        </div>}
      </div>
      <footer className="card-footer">
        {compiled.state === 'ready' && compiled.model.kind !== 'table' && compiled.model.kind !== 'pivot' && <details><summary>View data · {compiled.table.rows.length} {compiled.table.rows.length === 1 ? 'row' : 'rows'}</summary><DataTable compiled={compiled} interaction={interaction} /></details>}
        {!!compiled.model.warnings.length && <details className="render-notes"><summary>Rendering notes · {compiled.model.warnings.length}</summary><ul>{compiled.model.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></details>}
      </footer>
    </>}
  </section>;
}
