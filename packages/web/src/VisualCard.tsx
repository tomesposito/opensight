import { insightGraphic } from './insight-graphic.js';
import { LIGHT_THEME } from './themes.js';
import { fieldRule } from './formatting.js';
import { rowSelection, brushSelection, type VisualInteraction } from './visual-selection.js';
import { Fragment, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { VisualSkeleton } from './VisualSkeleton.js';
import type { EChartsOption } from 'echarts';
import { compileVisual, DATA_REQUIRED_LABEL, displayCell, rowGroupKey, rowGroupVisibility, pivotRowGroupHeaders } from './compiler.js';
import type { CompiledVisual } from './compiler.js';
import type { Cell, FixtureVisual } from './model.js';
import { init } from './echarts.js';

function Chart({ option, title, compiled, interaction }: { option: EChartsOption; title: string; compiled: CompiledVisual; interaction?: VisualInteraction }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!container.current) return;
    const chart = init(container.current, undefined, { renderer: 'svg' });
    chart.setOption(interaction?.brush ? { ...option, brush: { toolbox: ['lineX', 'clear'], xAxisIndex: 0, brushMode: 'single', throttleType: 'debounce', throttleDelay: 100 } } : option, { notMerge: true });
    if (interaction) {
      chart.on('click', event => { if (!['wordCloud', 'histogram', 'box', 'treemap', 'filledMap', 'sankey'].includes(compiled.model.kind) && (event.componentType === 'series' && typeof event.dataIndex === 'number')) { const selection = rowSelection(compiled, event.dataIndex); if (selection) interaction.onSelect(selection); } });
      if (interaction.brush) chart.on('brushEnd', (event: unknown) => {
        const areas = (event as { areas?: { coordRange?: unknown }[] }).areas;
        if (!areas?.length) interaction.onClear?.();
        else { const selection = brushSelection(compiled, areas[0]?.coordRange); if (selection) interaction.onSelect(selection); }
      });
    }
    const resize = () => {
      if (compiled.narrative && container.current) {
        const style = option.textStyle as { fontFamily?: string; color?: string };
        const layout = insightGraphic(compiled.narrative, { ...LIGHT_THEME, fontFamily: style.fontFamily ?? LIGHT_THEME.fontFamily, textColor: style.color ?? LIGHT_THEME.textColor }, compiled.model.formatting?.fontSize, container.current.clientWidth);
        chart.resize({ width: container.current.clientWidth, height: Math.max(container.current.clientHeight, layout.height) });
        chart.setOption({ graphic: layout.graphic }, { replaceMerge: ['graphic'] });
      } else chart.resize();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container.current);
    return () => { observer.disconnect(); chart.dispose(); };
  }, [option, compiled, interaction]);
  return <div ref={container} className={`chart${compiled.narrative ? ' insight-chart' : ''}`} role="img" aria-label={compiled.narrative ? `${title}. ${compiled.narrative.text}` : title} />;
}

export type RowGroupToggle = (path: Cell[], collapsed: boolean) => void;

function DataTable({ compiled, interaction, onRowGroupToggle }: { compiled: CompiledVisual; interaction?: VisualInteraction; onRowGroupToggle?: RowGroupToggle }) {
  const { model, table } = compiled, f = model.formatting;
  const dimensionCount = table.dimensionCount ?? (model.kind === 'pivot' ? model.rowDimensions.length : model.dimensions.length);
  const pivot = model.kind === 'pivot' ? f?.pivot : undefined;
  const width = pivot?.columnWidth ?? (pivot?.wordWrap ? 140 : undefined);
  const cellStyle: CSSProperties = { ...(pivot?.wordWrap !== undefined ? { whiteSpace: pivot.wordWrap ? 'normal' : 'nowrap', overflowWrap: pivot.wordWrap ? 'anywhere' : undefined } : {}), ...(width ? { width, minWidth: width, maxWidth: width } : {}) };
  const formatted = (value: import('./model.js').Cell, index: number) => typeof value === 'number' && index >= dimensionCount && f?.decimalPlaces !== undefined ? value.toLocaleString('en-US', { minimumFractionDigits: f.decimalPlaces, maximumFractionDigits: f.decimalPlaces }) : displayCell(value);
  const expandable = model.kind === 'pivot' && model.rowDimensions.length >= 2 && Array.isArray(table.rowGroupPaths);
  const signature = JSON.stringify([model.id, model.rowDimensions, pivot?.collapsedRowGroups ?? []]);
  const saved = useMemo(() => new Set((pivot?.collapsedRowGroups ?? []).map(rowGroupKey)), [signature]);
  // Authors write the definition; read-only viewers keep an independent local override.
  // Recompiles for formatting, results or theme changes do not reset that override.
  const [local, setLocal] = useState<{ signature: string; groups: Set<string> }>();
  const collapsed = !onRowGroupToggle && local?.signature === signature ? local.groups : saved;
  const visible = useMemo(() => expandable ? rowGroupVisibility(table.rowGroupPaths!, collapsed) : table.rows.map(() => true), [table, collapsed, expandable]);
  const headers = useMemo(() => {
    const groups = new Map<number, Cell[][]>();
    if (expandable && !model.subtotals) {
      const anchors = pivotRowGroupHeaders(table), shown = rowGroupVisibility(anchors.map(a => a.path), collapsed);
      anchors.forEach((anchor, i) => { if (shown[i]) groups.set(anchor.beforeRow, [...(groups.get(anchor.beforeRow) ?? []), anchor.path]); });
    }
    return groups;
  }, [table, collapsed, expandable, model.subtotals]);
  const subtotalAnchors = new Set<string>();
  const toggle = (path: Cell[]) => {
    const key = rowGroupKey(path);
    const isCollapsed = collapsed.has(key);
    return <button type="button" className="expand-toggle" aria-expanded={!isCollapsed}
      aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} row group ${path.map(displayCell).join(' / ')}`}
      onClick={event => {
        event.stopPropagation();
        if (onRowGroupToggle) onRowGroupToggle(path, !isCollapsed);
        else { const groups = new Set(collapsed); if (isCollapsed) groups.delete(key); else groups.add(key); setLocal({ signature, groups }); }
      }}>{isCollapsed ? '+' : '−'}</button>;
  };
  return <div className="table-scroll"><table style={{ fontSize: f?.fontSize, color: f?.cellColor, background: f?.cellBackground, ...(width ? { tableLayout: 'fixed', width: width * table.columns.length } : {}) }}>
    <caption className="sr-only">{compiled.model.title} — result data</caption>
    <thead className={f?.headersVisible === false ? 'sr-only' : undefined}><tr>{table.columns.map((column, i) => <th key={i} scope="col" style={{ ...cellStyle, color: f?.headerColor, background: f?.headerBackground }}>{table.visibleColumns?.[i] === '' ? <span className="sr-only">{column}</span> : table.visibleColumns?.[i] ?? column}</th>)}</tr></thead>
    <tbody>{table.rows.map((row, i) => {
      const path = table.rowGroupPaths?.[i], key = path && rowGroupKey(path);
      const isAnchor = expandable && table.rowKinds?.[i] === 'subtotal' && !!path?.length && !subtotalAnchors.has(key!);
      if (isAnchor) subtotalAnchors.add(key!);
      const toggleCell = isAnchor ? path!.length - 1 : -1;
      return <Fragment key={i}>{headers.get(i)?.map(path => <tr key={rowGroupKey(path)} className="row-group">{table.columns.map((_, j) => <td key={j} style={cellStyle}>{j === path.length - 1 ? <>{toggle(path)} {displayCell(path[j]!)}</> : j < path.length ? displayCell(path[j]!) : ''}</td>)}</tr>)}
      {visible[i] && <tr className={table.rowKinds?.[i]} onClick={interaction && rowSelection(compiled, i) ? () => interaction.onSelect(rowSelection(compiled, i)!) : undefined}>{row.map((cell, j) => {
      const measure = j >= dimensionCount ? model.measures[table.measureIndices?.[i]?.[j] ?? (j - dimensionCount) % model.measures.length] : undefined;
      const rule = measure && fieldRule(f, measure, cell);
      const toggleButton = j === toggleCell ? toggle(path!) : null;
      return <td key={j} style={{ ...cellStyle, ...(rule ? { color: rule.color, background: rule.background } : {}) }}>{toggleButton}{toggleButton ? ' ' : null}{pivot?.metricPlacement === 'rows' && j === dimensionCount - 1 && f?.valueNamesVisible === false ? <span className="sr-only">{formatted(cell, j)}</span> : j === 0 && interaction && rowSelection(compiled, i) ? <button type="button" onClick={event => { event.stopPropagation(); interaction.onSelect(rowSelection(compiled, i)!); }}>{formatted(cell, j)}</button> : formatted(cell, j)}</td>;
    })}</tr>}</Fragment>; })}</tbody>
  </table></div>;
}

export function VisualCard({ visual, dataMessage, loading = false, definitionPreview = false, interaction, onRowGroupToggle }: { visual: FixtureVisual; dataMessage?: string; loading?: boolean; definitionPreview?: boolean; interaction?: VisualInteraction; onRowGroupToggle?: RowGroupToggle }) {
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
        {!loading && compiled.state === 'ready' && ((compiled.model.kind === 'table' || compiled.model.kind === 'pivot') ? <DataTable compiled={compiled} interaction={interaction} onRowGroupToggle={onRowGroupToggle} /> : <Chart option={compiled.option} title={compiled.model.title} compiled={compiled} interaction={interaction} />)}
        {loading && compiled.state !== 'ready' && <VisualSkeleton kind={compiled.model.kind} />}
        {!loading && compiled.state !== 'ready' && <div className="empty-state" role="status">
          <strong>{compiled.state === 'unavailable' ? definitionPreview ? 'Definition only' : dataMessage ? 'Unable to load data' : DATA_REQUIRED_LABEL : 'No results'}</strong>
          <p>{compiled.state === 'empty' ? 'The result set contains no rows. Review the filters and source data for matching records.' : definitionPreview ? 'This preview has no sample results. Live data requires a hosted API with a configured source and access permissions. No query runs in this preview.' : dataMessage ? 'Review the details below, check the selected fields and data access, then retry.' : 'No data is attached to this visual. Choose a supported sample, or query a configured dataset through a hosted API.'}</p>
          {dataMessage && <p>{dataMessage}</p>}
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
