import { deflateSync, inflateSync } from 'node:zlib';
import { MetadataError } from './metadata-db.js';

function invalid(): never { throw new MetadataError('EMBED_ASSET_INVALID', 422); }
function crc(bytes: Buffer): number {
  let n = 0xffffffff;
  for (const b of bytes) { n ^= b; for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0); }
  return (n ^ 0xffffffff) >>> 0;
}
function chunk(type: string, bytes: Buffer): Buffer {
  const result = Buffer.alloc(bytes.length + 12);
  result.writeUInt32BE(bytes.length); result.write(type, 4, 'ascii'); bytes.copy(result, 8);
  result.writeUInt32BE(crc(result.subarray(4, -4)), result.length - 4); return result;
}
/** A deliberately small raster format: 8-bit RGB/RGBA, noninterlaced PNG only.
 * Decode with a byte ceiling, check every chunk/scanline and re-encode without metadata.
 * SVG, animation, URLs, polyglot trailing bytes and ancillary chunks are refused. */
export function validatedPng(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > 90000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) invalid();
  const bytes = Buffer.from(raw, 'base64'), signature = Buffer.from('89504e470d0a1a0a', 'hex');
  if (bytes.toString('base64') !== raw || bytes.length > 65536 || !bytes.subarray(0, 8).equals(signature)) invalid();
  let position = 8, header: Buffer | undefined, ended = false;
  const parts: Buffer[] = [];
  while (position < bytes.length) {
    if (ended || bytes.length - position < 12) invalid();
    const length = bytes.readUInt32BE(position), end = position + length + 12;
    if (end > bytes.length) invalid();
    const type = bytes.toString('ascii', position + 4, position + 8), data = bytes.subarray(position + 8, end - 4);
    if (crc(bytes.subarray(position + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) invalid();
    if (!header) {
      if (type !== 'IHDR' || length !== 13) invalid();
      header = data;
    } else if (type === 'IDAT') parts.push(data);
    else if (type === 'IEND' && !length && parts.length) ended = true;
    else invalid();
    position = end;
  }
  if (!ended || !header) invalid();
  const width = header.readUInt32BE(0), height = header.readUInt32BE(4), channels = header[9] === 2 ? 3 : header[9] === 6 ? 4 : 0;
  if (!width || !height || width > 512 || height > 512 || !channels || header[8] !== 8 || header[10] || header[11] || header[12]) invalid();
  const stride = width * channels + 1, size = stride * height;
  let pixels: Buffer;
  try { pixels = inflateSync(Buffer.concat(parts), { maxOutputLength: size }); } catch { return invalid(); }
  if (pixels.length !== size) invalid();
  for (let i = 0; i < size; i += stride) if (pixels[i]! > 4) invalid();
  return `data:image/png;base64,${Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]).toString('base64')}`;
}
