import type { ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { csvCell } from '@opensight/web/exports';
import { utils, write } from 'xlsx';
import type { BlazeTable } from './blaze.js';
import { MetadataError } from './metadata-db.js';
import type { HostedUsage } from './hosted-usage.js';
import type { Scope } from './metadata-resources.js';
import type { WorkScope } from './budgets.js';

/** App workspace setting. Embedded sessions retain embedding.features.download
 * (currently unsupported/false) and never enter these authenticated prep routes. */
export function workspaceDownloads(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.OPENSIGHT_DOWNLOADS_ENABLED;
  if (value !== undefined && value !== 'true' && value !== 'false') throw new MetadataError('DOWNLOAD_CONFIG_INVALID', 503);
  return value !== 'false';
}
export interface TableDownload { body: AsyncIterable<Buffer>; byteLength: number; contentType: string; filename: string; signal: AbortSignal }
export function tableDownloadFormat(value: unknown): 'csv' | 'xlsx' {
  if (value !== 'csv' && value !== 'xlsx') throw new MetadataError('STORED_DOWNLOAD_FORMAT_INVALID', 400);
  return value;
}
export async function tableDownload(scope: WorkScope, id: string, table: BlazeTable, format: 'csv' | 'xlsx'): Promise<TableDownload> {
  // Admit the retained input, encoder scratch and output copies before touching
  // cells or constructing any worksheet, row objects, strings or buffers.
  const cells = (table.rowCount + 1) * table.columns.length;
  const maxChars = table.columns.reduce((n, c) => Math.max(n, c.name.length), scope.limits.cellChars);
  scope.memory(format === 'csv' ? table.bytes + 16 * maxChars + 256 * table.columns.length + 4 * CHUNK_BYTES
    : table.bytes * 48 + cells * 1024 + 1048576);
  const headers = table.columns.map(c => c.name);
  if (format === 'csv') {
    // Match rowsToCsv's Object.keys ordering (including numeric column names),
    // without constructing even one row object. An empty table still has a header.
    const indexes = Object.fromEntries(headers.map((name, i) => [name, i]));
    const columns = Object.keys(indexes).map(name => indexes[name]!);
    let byteLength = 0, count = 0;
    for (const part of csvParts(table, columns)) {
      byteLength += Buffer.byteLength(part);
      if (++count % 256 === 0) { await yieldTurn(); scope.check(); }
    }
    scope.check();
    return { body: csvChunks(scope, table, columns), byteLength, contentType: 'text/csv; charset=utf-8', filename: `${id}.csv`, signal: scope.signal };
  }
  const workbook = utils.book_new();
  // SheetJS string cells remain text, including strings beginning with '='.
  utils.book_append_sheet(workbook, utils.aoa_to_sheet([headers, ...Array.from({ length: table.rowCount }, (_, r) => headers.map((_, c) => table.value(r, c)))]), 'Table');
  const bytes = Buffer.from(write(workbook, { type: 'buffer', bookType: 'xlsx', compression: true }) as Uint8Array);
  return { body: bufferChunks(scope, bytes), byteLength: bytes.length,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', filename: `${id}.xlsx`, signal: scope.signal };
}
const CHUNK_BYTES = 65536;
function* csvParts(table: BlazeTable, columns: number[]): Generator<string> {
  for (let r = -1; r < table.rowCount; r++) {
    for (let c = 0; c < columns.length; c++) {
      if (c) yield ',';
      const column = columns[c]!;
      yield csvCell(r < 0 ? table.columns[column]!.name : table.value(r, column));
    }
    yield '\r\n';
  }
}
async function* csvChunks(scope: WorkScope, table: BlazeTable, columns: number[]): AsyncGenerator<Buffer> {
  scope.check();
  let buffer = Buffer.allocUnsafe(CHUNK_BYTES), used = 0, count = 0;
  for (const part of csvParts(table, columns)) {
    if (++count % 256 === 0) { await yieldTurn(); scope.check(); }
    const bytes = Buffer.from(part);
    for (let offset = 0; offset < bytes.length;) {
      const size = Math.min(bytes.length - offset, buffer.length - used);
      bytes.copy(buffer, used, offset, offset + size); offset += size; used += size;
      if (used === buffer.length) { scope.check(); yield buffer; scope.check(); buffer = Buffer.allocUnsafe(CHUNK_BYTES); used = 0; }
    }
  }
  scope.check(); if (used) yield buffer.subarray(0, used);
}
async function* bufferChunks(scope: WorkScope, bytes: Buffer): AsyncGenerator<Buffer> {
  for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) { scope.check(); yield bytes.subarray(offset, offset + CHUNK_BYTES); }
}
const admissions = new WeakMap<ServerResponse, (bytes: number) => Promise<void>>();
/** Use the enclosing hosted request's reservation; never meter a response twice. */
export function downloadAdmission(response: ServerResponse, admit: (bytes: number) => Promise<void>): void { admissions.set(response, admit); }
export async function sendTableDownload(response: ServerResponse, result: TableDownload, local?: { usage: HostedUsage; scope: Scope }): Promise<void> {
  const reservation = local ? await local.usage.reserveEgress(local.scope) : undefined;
  let served = 0, admitted = false;
  const originalWrite = response.write;
  try {
    result.signal.throwIfAborted();
    if (reservation) await local!.usage.assertEgressSize(reservation, result.byteLength);
    await admissions.get(response)?.(result.byteLength);
    result.signal.throwIfAborted();
    admitted = true;
    response.writeHead(200, { 'Content-Type': result.contentType, 'Content-Length': result.byteLength,
      'Content-Disposition': `attachment; filename="${result.filename}"`, 'Cache-Control': 'no-store' });
    // Count only bytes handed to the HTTP response, never generator read-ahead.
    response.write = ((chunk: Buffer, ...args: unknown[]) => {
      served += chunk.length;
      return (originalWrite as (chunk: Buffer, ...rest: unknown[]) => boolean).call(response, chunk, ...args);
    }) as typeof response.write;
    await pipeline(Readable.from(result.body, { objectMode: false, highWaterMark: CHUNK_BYTES }), response, { signal: result.signal });
  } catch (error) { if (!response.destroyed) throw error; }
  finally {
    response.write = originalWrite;
    if (reservation) { if (admitted) await local!.usage.settleEgress(reservation, served); else await local!.usage.releaseEgress(reservation); }
  }
}
