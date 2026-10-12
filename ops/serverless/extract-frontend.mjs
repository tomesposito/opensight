import { gunzipSync } from 'node:zlib';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const fail = () => { throw Error('FRONTEND_ARCHIVE_INVALID'); };
const field = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, bytes.indexOf(0) < 0 ? bytes.length : bytes.indexOf(0)));
const octal = bytes => { const s = field(bytes).trim(); if (!/^[0-7]+$/.test(s)) fail(); const n = parseInt(s, 8); if (!Number.isSafeInteger(n)) fail(); return n; };
export function unpack(bytes) {
  const tar = gunzipSync(bytes, { maxOutputLength: 70 * 1024 * 1024 }), files = new Map();
  let offset = 0, total = 0, entries = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512); offset += 512;
    if (header.every(v => v === 0)) { if (tar.subarray(offset).some(v => v !== 0)) fail(); return files; }
    if (++entries > 2048) fail();
    const checksum = octal(header.subarray(148,156));
    if (header.reduce((sum, v, i) => sum + (i >= 148 && i < 156 ? 32 : v), 0) !== checksum) fail();
    const size = octal(header.subarray(124,136)), type = header[156];
    const prefix = field(header.subarray(345,500));
    let name = (prefix ? prefix + '/' : '') + field(header.subarray(0,100));
    if (name.startsWith('./')) name = name.slice(2);
    if (type === 53 && name.endsWith('/')) name = name.slice(0,-1);
    if (type === 53 && !name && size === 0) continue;
    if (!/^[A-Za-z0-9_./-]+$/.test(name) || name.split('/').some(p => !p || p === '.' || p === '..') || ![0,48,53].includes(type)) fail();
    if (type === 53) { if (size !== 0) fail(); continue; }
    total += size;
    if (total > 64 * 1024 * 1024 || offset + size > tar.length || files.has(name)) fail();
    files.set(name, tar.subarray(offset, offset + size)); offset += Math.ceil(size/512)*512;
  }
  fail();
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = unpack(readFileSync(process.argv[2]));
  mkdirSync(process.argv[3], { mode: 0o700 });
  for (const [name, bytes] of files) { const path = join(process.argv[3],name); mkdirSync(dirname(path),{recursive:true,mode:0o700});writeFileSync(path,bytes,{flag:'wx',mode:0o600}); }
}
