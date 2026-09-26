import { useEffect, useId, useMemo, useRef } from 'react';
import type { EChartsOption } from 'echarts';
import { compileVisual, displayCell } from './compiler.js';
import type { CompiledVisual } from './compiler.js';
import type { FixtureVisual } from './model.js';
import { init } from './echarts.js';

function Chart({ option, title }: { option: EChartsOption; title: string }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!container.current) return;
    const chart = init(container.current, undefined, { renderer: 'svg' });
    chart.setOption(option, { notMerge: true });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(container.current);
    return () => { observer.disconnect(); chart.dispose(); };
  }, [option]);
  return <div ref={container} className="chart" role="img" aria-label={title} />;
}

function DataTable({ compiled }: { compiled: CompiledVisual }) {
  return <div className="table-scroll"><table>
    <caption className="sr-only">{compiled.model.title} — result data</caption>
    <thead><tr>{compiled.table.columns.map((column, i) => <th key={i} scope="col">{column}</th>)}</tr></thead>
    <tbody>{compiled.table.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{displayCell(cell)}</td>)}</tr>)}</tbody>
  </table></div>;
}

export function VisualCard({ visual }: { visual: FixtureVisual }) {
  const headingId = useId();
  const result = useMemo(() => {
    try { return { compiled: compileVisual(visual) }; }
    catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
  }, [visual]);
  const { compiled, error } = result;
  const { column, columns, row, rows } = visual.placement;
  return <section className="visual-card" aria-labelledby={headingId} style={{ gridColumn: `${column + 1} / span ${columns}`, gridRow: `${row + 1} / span ${rows}` }}>
    <header className="card-heading">
      <h3 id={headingId} className={compiled && !compiled.model.titleVisible ? 'sr-only' : ''}>{compiled?.model.title ?? 'Unsupported visual'}</h3>
      {compiled && <span className="chart-kind">{compiled.model.kind}</span>}
    </header>
    {error && <div className="visual-error" role="alert"><strong>Unable to render</strong><p>{error}</p></div>}
    {compiled && <>
      <div className="visual-content">
        {compiled.model.kind === 'table' ? <DataTable compiled={compiled} /> : <Chart option={compiled.option} title={compiled.model.title} />}
        {compiled.state !== 'ready' && <div className="empty-state" role="status">
          <span className="empty-symbol" aria-hidden="true">◌</span>
          <strong>{compiled.state === 'unavailable' ? 'Data unavailable' : 'No results'}</strong>
          <p>{compiled.state === 'unavailable' ? 'The chart definition is loaded. No matching precomputed fixture rows are available.' : 'The supplied result set is empty.'}</p>
          <small>{compiled.model.measures.map(f => `SUM(${f.column})`).join(', ')}{compiled.model.dimensions[0] && ` by ${compiled.model.dimensions[0].column}`}</small>
        </div>}
      </div>
      <footer className="card-footer">
        {compiled.state === 'ready' && compiled.model.kind !== 'table' && <details><summary>View data · {compiled.table.rows.length} {compiled.table.rows.length === 1 ? 'row' : 'rows'}</summary><DataTable compiled={compiled} /></details>}
        {!!compiled.model.warnings.length && <details className="render-notes"><summary>Rendering notes · {compiled.model.warnings.length}</summary><ul>{compiled.model.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></details>}
      </footer>
    </>}
  </section>;
}
