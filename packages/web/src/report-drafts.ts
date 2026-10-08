import { isRecord, validateDefinition, type ReportDefinition, type RowsByBand } from '@opensight/reports';
import { draftStorageKey, type DraftStorage } from './local-drafts.js';
import type { Access } from './access.js';

export function reportStorageKey(access: Access): string { return draftStorageKey(access).replace('opensight.author.drafts', 'opensight.report.drafts'); }
const LIMIT = 1024 * 1024;
export function createReportStore(storage: DraftStorage, access: Access) {
  const key = reportStorageKey(access);
  const list = (): ReportDefinition[] => {
    const raw = storage().getItem(key);
    if (raw === null) return [];
    try {
      if (raw.length > LIMIT) throw new Error();
      const value: unknown = JSON.parse(raw);
      if (!isRecord(value) || Object.keys(value).some(k => !['version', 'reports'].includes(k)) || value.version !== 1 || !Array.isArray(value.reports) || value.reports.length > 20) throw new Error();
      const ids = new Set<string>();
      for (const d of value.reports) { validateDefinition(d); if (ids.has(d.id)) throw new Error(); ids.add(d.id); }
      return value.reports;
    } catch { throw new Error('Saved reports could not be read. Existing storage has not been changed. Export your open definition and restore a valid saved copy.'); }
  };
  const write = (reports: ReportDefinition[]) => {
    const raw = JSON.stringify({ version: 1, reports });
    if (reports.length > 20 || raw.length > LIMIT) throw new Error('Report draft limit reached (20 reports / 2 MiB). Export or delete a saved report.');
    storage().setItem(key, raw);
  };
  return { list,
    save(definition: ReportDefinition) {
      validateDefinition(definition); const reports = list();
      write([...reports.filter(d => d.id !== definition.id), definition]);
    },
    open(id: string) {
      const d = list().find(d => d.id === id);
      if (!d) throw new Error('This report draft no longer exists. Refresh the saved reports.');
      return d;
    },
    delete(id: string) { const reports = list(); if (!reports.some(d => d.id === id)) throw new Error('Report draft not found. Refresh the saved reports.'); write(reports.filter(d => d.id !== id)); },
  };
}

const sampleRows = Array.from({ length: 72 }, (_, i) => ({ order: i + 1, region: ['North', 'South', 'East', 'West'][i % 4]!, product: ['Notebook', 'Pen set', 'Desk lamp'][i % 3]!, amount: (i % 8 + 1) * 25 }));
export function sampleReport(): ReportDefinition {
  return {
    version: 1, id: 'sample-report', title: 'Sales activity - sample report', date: '2026-10-08',
    pageSetup: { size: 'A4', orientation: 'portrait', margins: { top: 15, right: 15, bottom: 15, left: 15 } },
    header: { runs: [{ text: 'OPENSIGHT / ', style: { bold: true, color: '#2563a6' } }, { field: 'reportTitle' }] },
    footer: { runs: [{ text: 'Sample data | ' }, { field: 'date' }, { text: ' | Page ' }, { field: 'pageNumber' }, { text: ' of ' }, { field: 'totalPages' }] },
    body: [
      { kind: 'text', id: 'intro', headingLevel: 1, runs: [{ text: 'Sales activity' }] },
      { kind: 'text', id: 'context', runs: [{ text: '72 synthetic orders. These bundled sample rows demonstrate page flow, repeated column headers and a supplied summary. No live dataset query runs.' }] },
      { kind: 'table', id: 'orders', datasetId: 'sample-report-sales', columns: [
        { field: { dataSetIdentifier: 'sample-report-sales', columnName: 'order' }, type: 'INTEGER', label: 'Order' },
        { field: { dataSetIdentifier: 'sample-report-sales', columnName: 'region' }, type: 'STRING', label: 'Region' },
        { field: { dataSetIdentifier: 'sample-report-sales', columnName: 'product' }, type: 'STRING', label: 'Product' },
        { field: { dataSetIdentifier: 'sample-report-sales', columnName: 'amount' }, type: 'DECIMAL', label: 'Amount (USD)' },
      ], summary: [null, 'Total', '72 orders', sampleRows.reduce((n, r) => n + r.amount, 0)] },
    ],
  };
}
/** Explicit sample binding only; never treat arbitrary datasets as sample data. */
export function previewRows(d: ReportDefinition): RowsByBand {
  return Object.fromEntries(d.body.filter(b => b.kind === 'table').map(b => {
    if (b.datasetId !== 'sample-report-sales') throw new Error(`REPORT_ROWS_UNAVAILABLE: ${b.id}: supply rows through the report API or library. Live dataset execution is not connected in this slice.`);
    return [b.id, sampleRows];
  }));
}
