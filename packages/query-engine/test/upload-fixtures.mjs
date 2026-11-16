import assert from 'node:assert/strict';
import { crc32, deflateRawSync } from 'node:zlib';
import * as XLSX from 'xlsx';
// Small ZIP fixtures keep forged declarations independent of actual payloads.
export function xlsxZip(members) {
  const locals = [], centrals = []; let offset = 0;
  for (const { name = 'payload', data, method = 8, declaredSize = data.length, descriptor = false, placeholders = true, localExtra = Buffer.alloc(0), centralExtra = Buffer.alloc(0) } of members) {
    const filename = Buffer.from(name), compressed = method === 0 ? data : deflateRawSync(data);
    const local = Buffer.alloc(30), central = Buffer.alloc(46), crc = crc32(data);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4);
    local.writeUInt16LE(descriptor ? 8 : 0, 6); local.writeUInt16LE(method, 8);
    if (!descriptor || !placeholders) {
      local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(declaredSize, 22);
    }
    local.writeUInt16LE(filename.length, 26); local.writeUInt16LE(localExtra.length, 28);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(descriptor ? 8 : 0, 8); central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(declaredSize, 24);
    central.writeUInt16LE(filename.length, 28); central.writeUInt16LE(centralExtra.length, 30); central.writeUInt32LE(offset, 42);
    const trailer = Buffer.alloc(descriptor ? descriptor === 'signed' ? 16 : 12 : 0);
    if (descriptor) {
      const start = descriptor === 'signed' ? 4 : 0;
      if (start) trailer.writeUInt32LE(0x08074b50);
      trailer.writeUInt32LE(crc, start); trailer.writeUInt32LE(compressed.length, start + 4); trailer.writeUInt32LE(declaredSize, start + 8);
    }
    locals.push(local, filename, localExtra, compressed, trailer);
    centrals.push(central, filename, centralExtra);
    offset += local.length + filename.length + localExtra.length + compressed.length + trailer.length;
  }
  const directory = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(members.length, 8); end.writeUInt16LE(members.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
export function workbookMembers() {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['name', 'amount'], ['East', 2]]), 'Data');
  const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }), members = [];
  for (let offset = 0; bytes.readUInt32LE(offset) === 0x04034b50;) {
    const size = bytes.readUInt32LE(offset + 18), nameEnd = offset + 30 + bytes.readUInt16LE(offset + 26);
    const start = nameEnd + bytes.readUInt16LE(offset + 28);
    assert.equal(bytes.readUInt16LE(offset + 8), 0);
    members.push({ name: bytes.subarray(offset + 30, nameEnd).toString(), data: bytes.subarray(start, start + size) });
    offset = start + size;
  }
  return members;
}
