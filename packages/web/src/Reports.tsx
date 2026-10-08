import { useMemo, useState } from 'react';
import { layoutReport, renderPdf, validateDefinition, PT_MM, type Page, type ReportDefinition } from '@opensight/reports';
import { useAccess } from './access.js';
import { browserDraftStorage } from './local-drafts.js';
import { createReportStore, previewRows, sampleReport } from './report-drafts.js';

function download(bytes: BlobPart, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function ReportPage({ page }: { page: Page }) {
  return <svg className="report-paper" viewBox={`0 0 ${page.width} ${page.height}`} role="img" aria-label={`Report page ${page.number} of ${page.totalPages}`}>
    <rect width={page.width} height={page.height} fill="white" />
    {page.items.map((item, i) => item.kind === 'rect'
      ? <rect key={i} x={item.x} y={item.y} width={item.width} height={item.height} fill={item.fill} stroke="#cbd5e1" strokeWidth={0.15} />
      : <text key={i} x={item.x} y={item.y} fill={item.style.color} fontFamily={'"Courier New", Courier, monospace'} fontSize={item.style.fontSize * PT_MM} fontWeight={item.style.bold ? 'bold' : 'normal'} fontStyle={item.style.italic ? 'italic' : 'normal'} xmlSpace="preserve">{item.text}</text>)}
  </svg>;
}
export function Reports() {
  const access = useAccess(), store = useMemo(() => createReportStore(browserDraftStorage, access), [access]);
  const [saved, setSaved] = useState(() => { try { return { reports: store.list(), error: '' }; } catch (e) { return { reports: [], error: (e as Error).message }; } });
  const [definition, setDefinition] = useState<ReportDefinition>(() => sampleReport());
  const [pageNumber, setPageNumber] = useState(0), [notice, setNotice] = useState(''), [error, setError] = useState('');
  const [dirty, setDirty] = useState(true);
  const result = useMemo(() => {
    try { return { pages: layoutReport(definition, previewRows(definition)), error: '' }; }
    catch (e) { return { pages: [], error: (e as Error).message }; }
  }, [definition]);
  const current = result.pages[Math.min(pageNumber, result.pages.length - 1)];
  const sample = definition.body.some(b => b.kind === 'table' && b.datasetId === 'sample-report-sales');
  const hasTable = definition.body.some(b => b.kind === 'table');
  const refresh = () => { try { setSaved({ reports: store.list(), error: '' }); } catch (e) { setSaved({ reports: [], error: (e as Error).message }); } };
  const attempt = (fn: () => void) => { setError(''); setNotice(''); try { fn(); } catch (e) { setError((e as Error).message); } };
  const change = (d: ReportDefinition) => { setDefinition(d); setPageNumber(0); setDirty(true); setNotice(''); };
  const open = (d: ReportDefinition, isSaved: boolean) => { change(d); setDirty(!isSaved); setError(''); };
  return <section className="reports-section">
    <div className="reports-heading"><div><h1>Reports</h1><p>Paginated documents saved on this device. PDF export runs locally.</p></div>
      <button type="button" onClick={() => open({ ...sampleReport(), id: crypto.randomUUID() }, false)}>New sample report</button>
    </div>
    <div className="reports-workspace">
      <aside className="reports-dock" aria-label="Report drafts and page setup">
        <h2>Saved reports</h2><p>Definitions only · this browser</p>
        <button type="button" onClick={refresh}>Refresh saved reports</button>
        {saved.error && <p role="alert">{saved.error}</p>}
        {!saved.reports.length && !saved.error && <p>No saved reports yet. Save the sample or import a definition.</p>}
        <ul className="report-list">{saved.reports.map(d => <li key={d.id}>
          <button type="button" aria-current={d.id === definition.id ? 'true' : undefined} onClick={() => attempt(() => open(store.open(d.id), true))}>{d.title}</button>
          <button type="button" aria-label={`Delete ${d.title}`} onClick={() => attempt(() => { store.delete(d.id); refresh(); if (d.id === definition.id) setDirty(true); setNotice('Deleted from this device. The open definition is still available.'); })}>Delete</button>
        </li>)}</ul>
        <label className="report-import">Import definition JSON<input type="file" accept=".json,application/json" onChange={event => {
          const file = event.target.files?.[0]; event.target.value = '';
          if (!file) return;
          setError(''); setNotice('');
          if (file.size > 1024 * 1024) { setError('Report definition exceeds 1 MiB.'); return; }
          void file.text().then(text => { const d: unknown = JSON.parse(text); validateDefinition(d); open(d, false); }).catch(e => setError((e as Error).message));
        }} /></label>
        <h2>Document</h2>
        <label>Report title<input value={definition.title} onChange={event => change({ ...definition, title: event.target.value })} /></label>
        <label>Report date<input type="date" value={definition.date} onChange={event => change({ ...definition, date: event.target.value })} /></label>
        <h2>Page setup</h2>
        <label>Paper size<select value={definition.pageSetup.size} onChange={event => change({ ...definition, pageSetup: { ...definition.pageSetup, size: event.target.value as ReportDefinition['pageSetup']['size'] } })}>{['A4', 'Letter', 'Legal'].map(s => <option key={s}>{s}</option>)}</select></label>
        <label>Orientation<select value={definition.pageSetup.orientation} onChange={event => change({ ...definition, pageSetup: { ...definition.pageSetup, orientation: event.target.value as ReportDefinition['pageSetup']['orientation'] } })}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></label>
        <div className="report-margins">{(['top', 'right', 'bottom', 'left'] as const).map(side => <label key={side}>{side[0]!.toUpperCase() + side.slice(1)} (mm)<input type="number" min="0" max="150" step="1" value={definition.pageSetup.margins[side]} onChange={event => change({ ...definition, pageSetup: { ...definition.pageSetup, margins: { ...definition.pageSetup.margins, [side]: event.target.valueAsNumber } } })} /></label>)}</div>
        <button type="button" onClick={() => attempt(() => { store.save(definition); refresh(); setDirty(false); setNotice('Report definition saved on this device.'); })}>Save draft</button>
        <button type="button" onClick={() => attempt(() => { validateDefinition(definition); download(JSON.stringify(definition, null, 2), 'application/json', `${definition.id}.json`); })}>Export definition JSON</button>
      </aside>
      <div className="report-preview">
        <div className="report-preview-toolbar"><div><strong>{definition.title || 'Untitled report'}</strong><span>{dirty ? 'Unsaved changes' : 'Saved on this device'}{sample ? ' · Sample data' : hasTable ? ' · Rows required' : ' · Text document'}</span></div>
          {current && <button type="button" className="report-export" onClick={() => attempt(() => { const pdf = renderPdf(definition, result.pages); download(new Uint8Array(pdf).buffer, 'application/pdf', `${definition.id}.pdf`); setNotice('PDF exported.'); })}>Export PDF</button>}
        </div>
        <p className="report-disclosure">{sample ? 'Sample data: 72 bundled synthetic orders. ' : ''}Approximate text layout. Live dataset queries, visual snapshots and scheduled distribution are not connected.</p>
        {notice && <p role="status" className="report-message">{notice}</p>}
        {(error || result.error) && <p role="alert" className="report-message">{error || result.error}</p>}
        {current && <>
          <nav className="report-pagination" aria-label="Report pages">
            <button type="button" disabled={current.number === 1} onClick={() => setPageNumber(current.number - 2)}>Previous page</button>
            <span aria-live="polite">{current.number} of {current.totalPages}</span>
            <button type="button" disabled={current.number === current.totalPages} onClick={() => setPageNumber(current.number)}>Next page</button>
          </nav>
          <div className="report-page-stage"><ReportPage page={current} /></div>
        </>}
      </div>
    </div>
  </section>;
}
