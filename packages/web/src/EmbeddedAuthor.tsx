import { useState } from 'react';
import { VisualCard } from './VisualCard.js';
import type { FixtureVisual } from './model.js';
import type { EmbedTransport } from './embed-transport.js';
interface Column { name: string; type: string }
interface Analysis { AnalysisId: string; Name: string; Definition: { DataSetIdentifierDeclarations: { Identifier: string; DataSetArn: string }[]; Sheets: { SheetId: string; Name?: string; Visuals: Record<string, unknown>[] }[]; [key: string]: unknown } }
export interface ConsoleContent { kind: 'console'; title: string; analyses: { id: string; name: string }[]; datasets: { id: string; columns: Column[] }[]; analysis?: Analysis; version?: number; datasetId?: string; visuals?: (FixtureVisual & { id: string })[] }
export function EmbeddedAuthor({ initial, transport }: { initial: ConsoleContent; transport: EmbedTransport }) {
  const [content, setContent] = useState(initial), [analysis, setAnalysis] = useState<Analysis | undefined>(initial.analysis), [datasetId, setDatasetId] = useState(initial.datasetId ?? initial.datasets[0]?.id ?? '');
  const [name, setName] = useState(initial.analysis?.Name ?? 'Untitled analysis'), [kind, setKind] = useState('BarChartVisual'), [measure, setMeasure] = useState(''), [dimension, setDimension] = useState(''), [aggregation, setAggregation] = useState('SUM'), [busy, setBusy] = useState(false), [note, setNote] = useState('');
  const dataset = content.datasets.find(d => d.id === datasetId);
  const open = (id: string) => { setBusy(true); void transport.request<ConsoleContent>('analysis', { analysisId: id }).then(next => { setContent(next); setAnalysis(next.analysis); setName(next.analysis?.Name ?? 'Untitled analysis'); setDatasetId(next.datasetId ?? ''); setNote(''); }).catch(() => {}).finally(() => setBusy(false)); };
  const add = () => {
    if (!dataset || !measure) return;
    const identifier = analysis?.Definition.DataSetIdentifierDeclarations[0]?.Identifier ?? 'data', column = (name: string) => ({ DataSetIdentifier: identifier, ColumnName: name });
    const values = [{ NumericalMeasureField: { FieldId: `value_${crypto.randomUUID().replaceAll('-', '')}`, Column: column(measure), AggregationFunction: { SimpleNumericalAggregation: aggregation } } }];
    const groups = dimension ? [{ CategoricalDimensionField: { FieldId: `group_${crypto.randomUUID().replaceAll('-', '')}`, Column: column(dimension) } }] : [];
    const wells = kind === 'KPIVisual' ? { Values: values } : kind === 'TableVisual' ? { TableAggregatedFieldWells: { GroupBy: groups, Values: values } } : { BarChartAggregatedFieldWells: { Category: groups, Values: values } };
    const visual = { [kind]: { VisualId: `visual_${crypto.randomUUID().replaceAll('-', '')}`, ChartConfiguration: { FieldWells: wells } } };
    const next = structuredClone(analysis ?? { AnalysisId: `analysis_${crypto.randomUUID().replaceAll('-', '')}`, Name: name, Definition: { DataSetIdentifierDeclarations: [{ Identifier: identifier, DataSetArn: `urn:opensight:dataset/${datasetId}` }], Sheets: [{ SheetId: 'sheet', Name: 'Sheet 1', Visuals: [] }] } });
    if (!next.Definition.Sheets.length) next.Definition.Sheets.push({ SheetId: 'sheet', Name: 'Sheet 1', Visuals: [] });
    next.Definition.Sheets[0]!.Visuals.push(visual); setAnalysis(next); setNote('Visual added. Save to render with your current data permissions.');
  };
  const save = () => {
    if (!analysis) return; setBusy(true);
    void transport.request('save', { analysisId: analysis.AnalysisId, definition: { ...analysis, Name: name }, datasetId, expectedVersion: content.analysis?.AnalysisId === analysis.AnalysisId ? content.version : 0 }).then(() => transport.saved()).catch(() => {}).finally(() => setBusy(false));
  };
  return <section className="embed-author">
    <aside><h2>Analyses</h2>{content.analyses.map(a => <button key={a.id} disabled={busy} onClick={() => open(a.id)}>{a.name}</button>)}
      <label>Analysis name<input value={name} onChange={e => setName(e.target.value)} maxLength={512} /></label>
      <label>Dataset<select value={datasetId} disabled={!!analysis || busy} onChange={e => setDatasetId(e.target.value)}>{content.datasets.map(d => <option key={d.id} value={d.id}>{d.id}</option>)}</select></label>
      <h2>Visuals</h2><label>Visual type<select value={kind} onChange={e => setKind(e.target.value)}><option value="BarChartVisual">Bar chart</option><option value="KPIVisual">KPI</option><option value="TableVisual">Table</option></select></label>
      <label>Group by<select value={dimension} onChange={e => setDimension(e.target.value)}><option value="">None</option>{dataset?.columns.filter(c => c.type === 'STRING').map(c => <option key={c.name}>{c.name}</option>)}</select></label>
      <label>Value<select value={measure} onChange={e => setMeasure(e.target.value)}><option value="">Choose a field</option>{dataset?.columns.filter(c => ['INTEGER', 'DECIMAL'].includes(c.type)).map(c => <option key={c.name}>{c.name}</option>)}</select></label>
      <label>Aggregation<select value={aggregation} onChange={e => setAggregation(e.target.value)}>{['SUM', 'AVG', 'COUNT', 'MIN', 'MAX'].map(a => <option key={a}>{a}</option>)}</select></label>
      <button disabled={busy || !measure || kind === 'BarChartVisual' && !dimension} onClick={add}>Add visual</button><button disabled={busy || !analysis || !name.trim()} onClick={save}>Save analysis</button>
      <p role="status">{note}</p>
    </aside><div><h2>{name}</h2><p>{analysis?.Definition.Sheets.reduce((n, s) => n + s.Visuals.length, 0) ?? 0} visuals</p><div className="dashboard-grid">{content.visuals?.map(v => <VisualCard key={v.id} visual={v} />)}</div></div>
  </section>;
}
