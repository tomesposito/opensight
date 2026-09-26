import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { EChartsOption } from 'echarts';
import { compileVisual, displayCell } from './compiler.js';
import type { CompiledVisual } from './compiler.js';
import type { Fixture, FixtureVisual } from './model.js';
import { init } from './echarts.js';
import generated from './fixtures.generated.json';

// Generated exclusively from the pinned repository fixtures; never external JSON.
const fixtures = generated as Fixture[];

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

function VisualCard({ visual }: { visual: FixtureVisual }) {
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
          <p>{compiled.state === 'unavailable' ? 'The chart definition is loaded. This archive contains no data rows.' : 'The supplied result set is empty.'}</p>
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

function Dashboard({ fixture }: { fixture: Fixture }) {
  const [sheetId, setSheetId] = useState(fixture.sheets[0]?.id);
  const sheet = fixture.sheets.find(s => s.id === sheetId);
  return <>
    <div className="dashboard-heading"><div><p className="eyebrow">{fixture.description}</p><h1>{fixture.name}</h1></div><span className="phase-badge">Phase 0 preview</span></div>
    <p className="fixture-notice">{fixture.notice}</p>
    <nav className="sheet-tabs" aria-label="Sheets">{fixture.sheets.map(s => <button key={s.id} aria-current={s.id === sheetId ? 'page' : undefined} onClick={() => setSheetId(s.id)}>{s.name}<span>{s.visuals.length} {s.visuals.length === 1 ? 'visual' : 'visuals'}</span></button>)}</nav>
    {sheet ? <div className="dashboard-grid" aria-label={sheet.name}>{sheet.visuals.map(v => <VisualCard key={v.path} visual={v} />)}</div> : <p>No sheets in this fixture.</p>}
    <p className="provenance">Source: <code>{fixture.provenance}</code></p>
  </>;
}

export default function App() {
  const [fixtureId, setFixtureId] = useState(fixtures[0]?.id);
  const fixture = fixtures.find(f => f.id === fixtureId);
  return <div className="app-shell">
    <header className="app-header"><a className="brand" href="./"><span className="brand-mark" aria-hidden="true">◈</span>OpenSight</a><span className="header-caption">Fixture explorer</span><label className="fixture-picker">Dashboard<select value={fixtureId} onChange={event => setFixtureId(event.target.value)}>{fixtures.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label></header>
    <main>{fixture ? <Dashboard key={fixture.id} fixture={fixture} /> : <p>No fixtures available.</p>}</main>
    <footer className="app-footer">OpenSight · Local rendering preview · QuickSight fidelity has not been measured</footer>
  </div>;
}
