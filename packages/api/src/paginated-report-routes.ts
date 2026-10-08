import type { IncomingMessage, ServerResponse } from 'node:http';
import { isRecord, layoutReport, renderPdf, ReportError, validateDefinition, validateRows } from '@opensight/reports';
import { method, send } from './automation-routes.js';
import { readBody, RequestError } from './query.js';

/** Stateless renderer of supplied rows. IDs label documents; no saved resource/query lookup. */
export async function paginatedReportRoute(request: IncomingMessage, response: ServerResponse, path: string, query: string, authorize: () => void | Promise<void> = () => {}): Promise<boolean> {
  const match = /^\/(?:api\/)?reports\/([^/]+)\/pdf$/.exec(path);
  if (!match) return false;
  await authorize();
  try {
    method(request, response, ['POST']);
    if (query) throw new RequestError(400, 'Query parameters are not supported');
    const id = match[1]!;
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new ReportError('REPORT_INVALID_DEFINITION', '$.id', 'Invalid report ID');
    const body = await readBody(request);
    await authorize();
    if (!isRecord(body) || Object.keys(body).some(k => !['definition', 'rowsByBand'].includes(k))) throw new ReportError('REPORT_INVALID_DEFINITION', '$', 'Expected definition and rowsByBand');
    validateDefinition(body.definition);
    if (body.definition.id !== id) throw new ReportError('REPORT_INVALID_DEFINITION', '$.id', 'Path ID must match definition ID');
    validateRows(body.definition, body.rowsByBand);
    const bytes = renderPdf(body.definition, layoutReport(body.definition, body.rowsByBand));
    response.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${id}.pdf"`, 'Content-Length': bytes.byteLength, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(bytes);
  } catch (error) {
    request.resume();
    if (error instanceof ReportError) send(response, 422, { errorCode: error.code, message: error.message, path: error.path });
    else throw error;
  }
  return true;
}
