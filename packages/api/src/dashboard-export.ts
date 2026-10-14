import { renderDashboardPdf } from './dashboard-pdf.js';
import { compileVisual } from '@opensight/web/compiler';
import { rowsToCsv } from '@opensight/web/exports';
import { assembleReport } from './reports.js';
import { embedVisuals } from './embed-content.js';
import { dashboardVersion, type DashboardBackend, type DashboardRecord } from './dashboard-model.js';
import { dashboardControls } from './dashboard-controls.js';
import { MetadataError } from './metadata-db.js';

/** No artifact store or report run is created. The browser profile is removed after rendering. */
export async function dashboardExport(backend: DashboardBackend, record: DashboardRecord, version: number, format: string, env: NodeJS.ProcessEnv, authorizeOnly = false) {
  if (format !== 'csv' && format !== 'pdf') throw new MetadataError('DASHBOARD_EXPORT_FORMAT_INVALID', 422);
  const v = dashboardVersion(record, version), definition = dashboardControls(v, {}), compiled = [], csv: Record<string, string | number | null>[] = [];
  let resultBytes = 0;
  for (const visual of embedVisuals(definition)) {
    const result = await backend.query(v, definition, visual.id);
    resultBytes += Buffer.byteLength(JSON.stringify(result));
    if (resultBytes > 16 * 1024 * 1024) throw new MetadataError('DASHBOARD_EXPORT_TOO_LARGE', 413);
    const output = compileVisual({ source: 'api', definition: visual.definition, path: visual.path, rows: result.rows, bindings: result.bindings });
    compiled.push(output);
    // One rectangular CSV covers heterogeneous visual tables without inventing column unions.
    for (const [row, cells] of output.table.rows.entries()) for (const [column, value] of cells.entries()) csv.push({ sheetId: visual.sheetId, visualId: visual.id, row: row + 1, column: output.table.columns[column] ?? String(column + 1), value: value == null ? null : typeof value === 'number' ? value : String(value) });
  }
  const filename = `${record.id}-v${version}.${format}`;
  if (authorizeOnly) return { bytes: Buffer.alloc(0), contentType: '', filename };
  if (format === 'csv') {
    const bytes = Buffer.from(rowsToCsv(csv));
    if (bytes.length > 16 * 1024 * 1024) throw new MetadataError('DASHBOARD_EXPORT_TOO_LARGE', 413);
    return { bytes, contentType: 'text/csv; charset=utf-8', filename };
  }
  const executable = env.OPENSIGHT_PDF_CHROMIUM;
  if (!executable) throw new MetadataError('DASHBOARD_PDF_RENDERER_REQUIRED', 503);
  const html = assembleReport({ dashboardId: record.id, title: v.name, capturedAt: new Date().toISOString(), visuals: compiled }).replace('Dashboard snapshot ·', `Dashboard export · version ${version} ·`);
  return { bytes: await renderDashboardPdf(executable, html), contentType: 'application/pdf', filename };
}
