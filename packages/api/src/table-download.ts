import type { ServerResponse } from 'node:http';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { rowsToCsv } from '@opensight/web/exports';
import { utils, write } from 'xlsx';
import type { BlazeTable } from './blaze.js';
import { MetadataError } from './metadata-db.js';
import type { HostedUsage } from './hosted-usage.js';
import type { Scope } from './metadata-resources.js';

/** App workspace setting. Embedded sessions retain embedding.features.download
 * (currently unsupported/false) and never enter these authenticated prep routes. */
export function workspaceDownloads(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.OPENSIGHT_DOWNLOADS_ENABLED;
  if (value !== undefined && value !== 'true' && value !== 'false') throw new MetadataError('DOWNLOAD_CONFIG_INVALID', 503);
  return value !== 'false';
}
export interface TableDownload { bytes: Buffer; contentType: string; filename: string }
export function tableDownloadFormat(value: unknown): 'csv' | 'xlsx' {
  if (value !== 'csv' && value !== 'xlsx') throw new MetadataError('STORED_DOWNLOAD_FORMAT_INVALID', 400);
  return value;
}
export function tableDownload(id: string, table: BlazeTable, format: 'csv' | 'xlsx'): TableDownload {
  const headers = table.columns.map(c => c.name);
  if (format === 'csv') {
    const text = table.rowCount ? rowsToCsv(table.rows()) : rowsToCsv([Object.fromEntries(headers.map(h => [h, null]))]).slice(0, -(headers.length + 1));
    return { bytes: Buffer.from(text), contentType: 'text/csv; charset=utf-8', filename: `${id}.csv` };
  }
  const workbook = utils.book_new();
  // SheetJS string cells remain text, including strings beginning with '='.
  utils.book_append_sheet(workbook, utils.aoa_to_sheet([headers, ...Array.from({ length: table.rowCount }, (_, r) => headers.map((_, c) => table.value(r, c)))]), 'Table');
  return { bytes: Buffer.from(write(workbook, { type: 'buffer', bookType: 'xlsx', compression: true }) as Uint8Array),
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', filename: `${id}.xlsx` };
}
const admissions = new WeakMap<ServerResponse, (bytes: number) => Promise<void>>();
/** Use the enclosing hosted request's reservation; never meter a response twice. */
export function downloadAdmission(response: ServerResponse, admit: (bytes: number) => Promise<void>): void { admissions.set(response, admit); }
export async function sendTableDownload(response: ServerResponse, result: TableDownload, local?: { usage: HostedUsage; scope: Scope }): Promise<void> {
  const reservation = local ? await local.usage.reserveEgress(local.scope) : undefined;
  let served = 0, admitted = false;
  try {
    if (reservation) await local!.usage.assertEgressSize(reservation, result.bytes.length);
    await admissions.get(response)?.(result.bytes.length);
    admitted = true;
    response.writeHead(200, { 'Content-Type': result.contentType, 'Content-Length': result.bytes.length,
      'Content-Disposition': `attachment; filename="${result.filename}"`, 'Cache-Control': 'no-store' });
    const chunks = function* () { for (let offset = 0; offset < result.bytes.length; offset += 65536) yield result.bytes.subarray(offset, offset + 65536); };
    await pipeline(Readable.from(chunks()), new Transform({ transform(chunk: Buffer, _encoding, done) { served += chunk.length; done(null, chunk); } }), response);
  } catch (error) { if (!response.destroyed) throw error; }
  finally { if (reservation) { if (admitted) await local!.usage.settleEgress(reservation, served); else await local!.usage.releaseEgress(reservation); } }
}
