/*! @license fflate 0.8.3 — MIT
MIT License

Copyright (c) 2026 Arjun Barrett

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
import { Inflate } from 'fflate/browser';
import { fail, ValidationError } from './validation.js';
import { ZIP_LIMITS, memberJsonPath, type ZipMemberInfo } from './zip-common.js';

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});

/** Browser-only bounded ZIP reader. Central metadata is checked before inflation.
 * ZIP64, multi-disk and encrypted archives fail explicitly; nothing is extracted. */
export async function readZipArchive(bytes: Uint8Array, visit?: (entry: ZipMemberInfo, data: Uint8Array) => void): Promise<ZipMemberInfo[]> {
  if (bytes.length > ZIP_LIMITS.archiveBytes) fail('$', 'ZIP exceeds archive byte limit');
  let path = '$';
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u16 = (offset: number) => view.getUint16(offset, true);
    const u32 = (offset: number) => view.getUint32(offset, true);
    let end = bytes.length - 22;
    while (end >= Math.max(0, bytes.length - 65557) && (u32(end) !== 0x06054b50 || end + 22 + u16(end + 20) !== bytes.length)) end--;
    if (end < 0 || end < bytes.length - 65557) fail('$', 'invalid ZIP: missing end of central directory');
    const count = u16(end + 10), centralSize = u32(end + 12), centralStart = u32(end + 16);
    if (count === 65535 || centralSize === 0xffffffff || centralStart === 0xffffffff) fail('$', 'invalid ZIP: ZIP64 is unsupported in the browser');
    if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== count) fail('$', 'invalid ZIP: multi-disk archives are unsupported');
    if (count > ZIP_LIMITS.members) fail('$', 'ZIP exceeds member count limit');
    if (centralStart + centralSize !== end) fail('$', 'invalid ZIP: central directory size mismatch');
    const entries: (ZipMemberInfo & { start: number; method: number; crc: number })[] = [];
    const seen = new Set<string>();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let offset = centralStart, total = 0;
    for (let index = 0; index < count; index++) {
      if (offset + 46 > end || u32(offset) !== 0x02014b50) fail('$', 'invalid ZIP: central directory entry');
      const flags = u16(offset + 8), method = u16(offset + 10), crc = u32(offset + 16);
      const compressedSize = u32(offset + 20), uncompressedSize = u32(offset + 24);
      const nameLength = u16(offset + 28), extraLength = u16(offset + 30), commentLength = u16(offset + 32);
      const local = u32(offset + 42), next = offset + 46 + nameLength + extraLength + commentLength;
      if (next > end) fail('$', 'invalid ZIP: truncated central directory');
      const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
      path = memberJsonPath(name);
      const directory = name.endsWith('/');
      const parts = (directory ? name.slice(0, -1) : name).split('/');
      if (/[\u0000-\u001f\u007f\\]/u.test(name) || parts.some(p => !p || p === '.' || p === '..')) fail(path, 'unsafe or noncanonical ZIP member path');
      if (seen.has(name)) fail(path, 'duplicate ZIP member path');
      seen.add(name);
      if (flags & 1) fail(path, 'encrypted ZIP members are unsupported');
      if (method !== 0 && method !== 8) fail(path, 'unsupported ZIP compression method');
      if (uncompressedSize > ZIP_LIMITS.memberBytes) fail(path, 'ZIP exceeds member byte limit');
      total += uncompressedSize;
      if (total > ZIP_LIMITS.totalBytes) fail(path, 'ZIP exceeds total uncompressed byte limit');
      if (directory && uncompressedSize) fail(path, 'directory entry contains data');
      if (u16(offset + 34)) fail(path, 'invalid ZIP: multi-disk entry');
      if (local + 30 > centralStart || u32(local) !== 0x04034b50) fail(path, 'invalid ZIP: local header');
      const localNameLength = u16(local + 26), start = local + 30 + localNameLength + u16(local + 28);
      if (start + compressedSize > centralStart || u16(local + 6) !== flags || u16(local + 8) !== method ||
          decoder.decode(bytes.subarray(local + 30, local + 30 + localNameLength)) !== name) fail(path, 'invalid ZIP: local/central header mismatch');
      if (!(flags & 8) && (u32(local + 18) !== compressedSize || u32(local + 22) !== uncompressedSize)) fail(path, 'invalid ZIP: member size mismatch');
      if (!(flags & 8) && u32(local + 14) !== crc) fail(path, 'invalid ZIP: local/central CRC32 mismatch');
      if (method === 0 && compressedSize !== uncompressedSize) fail(path, 'invalid ZIP: stored member size mismatch');
      entries.push({ path: name, compressedSize, uncompressedSize, directory, start, method, crc });
      offset = next;
    }
    if (offset !== end) fail('$', 'invalid ZIP: central directory count mismatch');
    for (const entry of entries) {
      if (!visit || entry.directory) continue;
      path = memberJsonPath(entry.path);
      const data = new Uint8Array(entry.uncompressedSize);
      let size = 0, checksum = 0xffffffff;
      const accept = (chunk: Uint8Array) => {
        size += chunk.length;
        if (size > ZIP_LIMITS.memberBytes) fail(path, 'ZIP exceeds member byte limit');
        if (size > data.length) fail(path, 'invalid ZIP: inflated member size mismatch');
        for (const byte of chunk) checksum = crcTable[(checksum ^ byte) & 255]! ^ (checksum >>> 8);
        data.set(chunk, size - chunk.length);
      };
      const compressed = bytes.subarray(entry.start, entry.start + entry.compressedSize);
      if (entry.method === 0) accept(compressed);
      else {
        // Small input chunks bound transient inflate allocation even when sizes lie.
        const inflate = new Inflate(accept);
        if (!compressed.length) fail(path, 'invalid ZIP: empty deflate stream');
        for (let i = 0; i < compressed.length; i += 1024) inflate.push(compressed.subarray(i, i + 1024), i + 1024 >= compressed.length);
      }
      if (size !== data.length) fail(path, 'invalid ZIP: inflated member size mismatch');
      if (((checksum ^ 0xffffffff) >>> 0) !== entry.crc) fail(path, 'ZIP member CRC32 mismatch');
      visit(entry, data);
    }
    return entries.map(({ path, compressedSize, uncompressedSize, directory }) => ({ path, compressedSize, uncompressedSize, directory }));
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError(path, `invalid ZIP: ${error instanceof Error ? error.message : String(error)}`);
  }
}
