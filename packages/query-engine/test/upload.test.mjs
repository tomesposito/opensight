import test from 'node:test';
import assert from 'node:assert/strict';
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';
import * as XLSX from 'xlsx';
import { parseUpload, UploadStaging } from '@opensight/query-engine';
const input = (data, config = { format: 'csv' }, columns) => ({ config, data: Buffer.from(data), ...(columns ? { columns } : {}) });
// Small ZIP fixtures keep forged declarations independent of actual payloads.
function xlsxZip(members) {
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
function workbookMembers() {
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
const parseXlsx = data => parseUpload({ config: { format: 'xlsx' }, data });
for (const delimiter of [',', '\t', ';', '|']) test(`upload sniffs ${JSON.stringify(delimiter)} and stages actual rows`, async () => {
  const stage = await UploadStaging.create();
  try {
    const result = await stage.ingest(input(`name${delimiter}amount${delimiter}day\nEast${delimiter}2${delimiter}2024-02-29\nWest${delimiter}3.5${delimiter}2024-03-01\n`));
    assert.equal(result.rowCount, 2); assert.equal(result.delimiter, delimiter);
    assert.deepEqual(result.columns.map(c => c.type), ['STRING', 'DECIMAL', 'DATETIME']);
    assert.deepEqual((await stage.preview(result.id)).rows, [{ name: 'East', amount: 2, day: '2024-02-29T00:00:00.000Z' }, { name: 'West', amount: 3.5, day: '2024-03-01T00:00:00.000Z' }]);
  } finally { stage.close(); }
});
test('CSV handles quoted delimiters, quotes, BOM, CRLF, multiline and null cells', () => {
  const p = parseUpload(input('\uFEFFname,value\r\n"East, \"\"region\"\"",2\r\n"West\nregion",\r\n'));
  assert.deepEqual(p.rows, [['East, "region"', 2], ['West\nregion', null]]);
  assert.equal(parseUpload(input('name\nEast')).rows.length, 1);
  assert.equal(parseUpload(input('name,amount\n')).rows.length, 0);
});
test('upload rejects malformed rows, quotes, headers, types and encoding without partial data', () => {
  for (const data of ['', 'a,A\n1,2', 'a,\n1,2', ' a,b\n1,2', 'a,b\n1,2,3', 'a;b\n1;2;3', 'a,b\n"x,y', 'a,b\n"x"oops,2', 'a,b\nx"y,2', 'a,b\nx,2\ny,no', 'a,b\nx,1e999']) assert.throws(() => parseUpload(input(data)), { name: 'UploadError' }, data);
  assert.throws(() => parseUpload(input(Buffer.from([0xff]))), { code: 'INVALID_UPLOAD' });
  assert.throws(() => parseUpload(input('a,b;c\n1,2;3')), { code: 'INVALID_UPLOAD' });
  assert.throws(() => parseUpload(input('a\n2024-02-30', { format: 'csv' }, [{ name: 'a', type: 'DATETIME' }])), { code: 'UPLOAD_SCHEMA_MISMATCH' });
  assert.throws(() => parseUpload(input('a\n1', { format: 'csv' }, [{ name: 'wrong', type: 'INTEGER' }])), { code: 'UPLOAD_SCHEMA_MISMATCH' });
  assert.throws(() => parseUpload(input('a\n1', { format: 'csv' }, [{ name: 'a', type: 'BLOB' }])), { code: 'UPLOAD_SCHEMA_MISMATCH' });
  assert.throws(() => parseUpload(input('x'.repeat(8 * 1024 * 1024 + 1))), { code: 'UPLOAD_LIMIT_EXCEEDED' });
});
test('JSON validates every key and scalar, preserving nulls and booleans', () => {
  const parsed = parseUpload(input('[{"a":1,"b":true},{"b":false,"a":null}]', { format: 'json' }));
  assert.deepEqual(parsed.rows, [[1, true], [null, false]]);
  for (const json of ['[]', '{}', '[1]', '[{"a":1},{"b":2}]', '[{"a":1},{"a":2,"b":3}]', '[{"a":{}}]', '[{"a":1},{"a":"2"}]', '[{"a":1,"a":2}]', '[{"a":1,"\\u0061":2}]', '[{"a":1e999}]', '[{"a":9007199254740993}]']) assert.throws(() => parseUpload(input(json, { format: 'json' })), { name: 'UploadError' }, json);
});
test('explicit strings preserve IDs and large integers; TSV requires tabs', () => {
  assert.deepEqual(parseUpload(input('id\n001\n999999999999999999999', { format: 'csv' }, [{ name: 'id', type: 'STRING' }])).rows, [['001'], ['999999999999999999999']]);
  assert.equal(parseUpload(input('a\tb\n1\ttrue', { format: 'tsv' })).delimiter, '\t');
});
for (const format of ['xls', 'xlsx']) test(`${format} reads values and dates; explicit worksheet selection`, async () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['name', 'amount', 'day'], ['East', 2, new Date('2024-02-29T00:00:00Z')]]), 'Data');
  const bytes = XLSX.write(workbook, { type: 'buffer', bookType: format });
  const stage = await UploadStaging.create();
  try {
    const result = await stage.ingest({ config: { format }, data: bytes });
    assert.equal(result.rowCount, 1); assert.equal(result.sheet, 'Data');
    assert.equal((await stage.preview(result.id)).rows[0].day, '2024-02-29T00:00:00.000Z');
    assert.throws(() => parseUpload({ config: { format, sheet: 'Missing' }, data: bytes }), { code: 'INVALID_UPLOAD' });
  } finally { stage.close(); }
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['a'], [2]]), 'Other');
  assert.throws(() => parseUpload({ config: { format }, data: XLSX.write(workbook, { type: 'buffer', bookType: format }) }), { code: 'INVALID_UPLOAD' });
});
test('Excel rejects formulas, merges and text fallback', () => {
  for (const kind of ['formula', 'merge']) {
    const workbook = XLSX.utils.book_new(), ws = XLSX.utils.aoa_to_sheet([['a', 'b'], [1, 2]]);
    if (kind === 'formula') ws.A2 = { t: 'n', f: '1+1', v: 2 }; else ws['!merges'] = [{ s: { r: 1, c: 0 }, e: { r: 1, c: 1 } }];
    XLSX.utils.book_append_sheet(workbook, ws, 'Data');
    assert.throws(() => parseUpload({ config: { format: 'xlsx' }, data: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) }), { code: 'INVALID_UPLOAD' });
  }
  assert.throws(() => parseUpload(input('a,b\n1,2', { format: 'xlsx' })), { code: 'INVALID_UPLOAD' });
});
test('xlsx rejects a high-ratio workbook whose declared uncompressed size exceeds the ceilings before parsing (#182)', () => {
  // 600 distinct near-32k strings inflate to ~18 MiB of shared strings while
  // deflating to a few KiB: compressed size passes the 8 MiB cap, so only the
  // pre-parse declared-size check can reject it before SheetJS inflates it.
  const rows = [['name'], ...Array.from({ length: 600 }, (_, i) => [`${i}:${'x'.repeat(30_000)}`])];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Data');
  const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', bookSST: true, compression: true });
  assert.ok(bytes.length < 8 * 1024 * 1024, `fixture should stay under the compressed cap, got ${bytes.length}`);
  assert.throws(() => parseUpload({ config: { format: 'xlsx' }, data: bytes }), { code: 'UPLOAD_LIMIT_EXCEEDED' });
});
test('xlsx rejects a central directory declaring an oversize member, even when the stored bytes are small (#182)', () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['a'], [1]]), 'Data');
  const bytes = Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (view.getUint32(end, true) !== 0x06054b50) end--;
  const centralStart = view.getUint32(end + 16, true);
  assert.equal(view.getUint32(centralStart, true), 0x02014b50);
  // Declare the first member's uncompressed size just over the 16 MiB ceiling.
  view.setUint32(centralStart + 24, 16 * 1024 * 1024 + 1, true);
  assert.throws(() => parseUpload({ config: { format: 'xlsx' }, data: bytes }), { code: 'UPLOAD_LIMIT_EXCEEDED' });
});
test('xlsx rejects actual output contradicting matching small local/central declarations before parsing (#221)', () => {
  for (const declaredSize of [1, 8193]) {
    const bytes = xlsxZip([{ data: Buffer.alloc(8192, 120), declaredSize }]);
    assert.throws(() => parseXlsx(bytes), { code: 'INVALID_UPLOAD', message: /actual uncompressed size mismatch/ });
  }
});
test('xlsx hard-caps high expansion even when both headers lie about output size (#221)', () => {
  const bytes = xlsxZip([{ data: Buffer.alloc(16 * 1024 * 1024 + 1, 120), declaredSize: 1 }]);
  assert.ok(bytes.length < 20_000, 'compressed fixture must pass the input limit');
  assert.throws(() => parseXlsx(bytes), { code: 'UPLOAD_LIMIT_EXCEEDED', message: /16 MiB/ });
});
test('xlsx bounds actual aggregate output by the remaining budget during inflation (#221)', () => {
  const block = Buffer.alloc(16 * 1024 * 1024, 120);
  const bytes = xlsxZip([
    ...Array.from({ length: 3 }, (_, i) => ({ name: `part${i}`, data: block })),
    { name: 'part3', data: block.subarray(0, 15 * 1024 * 1024) },
    { name: 'part4', data: block.subarray(0, 2 * 1024 * 1024), declaredSize: 1024 * 1024 },
  ]);
  assert.throws(() => parseXlsx(bytes), { code: 'UPLOAD_LIMIT_EXCEEDED', message: /64 MiB/ });
});
test('xlsx rejects local/central name, method, flags and size contradictions (#221)', () => {
  for (const [field, mutate] of [
    ['name', b => { b[30] ^= 1; }],
    ['method', b => b.writeUInt16LE(0, 8)],
    ['flags', b => b.writeUInt16LE(8, 6)],
    ['compressed size', b => b.writeUInt32LE(1, 18)],
    ['uncompressed size', b => b.writeUInt32LE(2, 22)],
  ]) {
    const bytes = xlsxZip([{ data: Buffer.from('content') }]); mutate(bytes);
    assert.throws(() => parseXlsx(bytes), { code: 'INVALID_UPLOAD', message: /local\/central/ }, field);
  }
});
test('xlsx still parses every member of valid STORED and DEFLATE workbooks (#221)', () => {
  const members = workbookMembers(); assert.ok(members.length > 1);
  for (const method of [0, 8]) {
    const result = parseXlsx(xlsxZip(members.map(member => ({ ...member, method }))));
    assert.equal(result.sheet, 'Data'); assert.deepEqual(result.rows, [['East', 2]]);
    assert.deepEqual(result.columns, [{ name: 'name', type: 'STRING' }, { name: 'amount', type: 'INTEGER' }]);
  }
});
test('staging isolates sessions, escapes SQL identifiers/values, and recovers after rejection', async () => {
  const a = await UploadStaging.create(), b = await UploadStaging.create();
  try {
    await assert.rejects(a.ingest(input('a,b\n1')), { code: 'INVALID_UPLOAD' });
    const upload = await a.ingest(input(JSON.stringify([{ 'x"; DROP TABLE y;--': "' OR TRUE --" }]), { format: 'json' }));
    assert.deepEqual((await a.preview(upload.id)).rows, [{ 'x"; DROP TABLE y;--': "' OR TRUE --" }]);
    await assert.rejects(b.preview(upload.id), { code: 'UPLOAD_NOT_FOUND' });
    await assert.rejects(a.preview('upload_unknown'), { code: 'UPLOAD_NOT_FOUND' });
  } finally { a.close(); b.close(); }
});

test('explicit upload lifetime hides expired sources and reclaims the session capacity', async () => {
  let now = Date.parse('2026-01-01T00:00:00Z');
  const stage = await UploadStaging.create({ ttlMs: 1000, now: () => now });
  try {
    const first = await stage.ingest(input('name,value\nNorth,2'));
    assert.equal(first.expiresAt, '2026-01-01T00:00:01.000Z');
    for (let i = 1; i < 20; i++) await stage.ingest(input('name,value\nNorth,2'));
    await assert.rejects(stage.ingest(input('name,value\nNorth,2')), { code: 'UPLOAD_LIMIT_EXCEEDED' });
    now += 999;
    assert.equal(stage.prepSources().length, 20);
    now++;
    assert.deepEqual(stage.prepSources(), []);
    await assert.rejects(stage.previewPrep({ version: 1, input: first.id, steps: [] }), { code: 'PREP_SOURCE_NOT_FOUND' });
    await assert.rejects(stage.preview(first.id), { code: 'UPLOAD_NOT_FOUND' });
    const replacement = await stage.ingest(input('name,value\nSouth,3'));
    assert.equal(replacement.expiresAt, '2026-01-01T00:00:02.000Z');
    assert.equal(stage.prepSources().length, 1);
  } finally { stage.close(); }
});

test('durable staging restores rows, schema, expiry and the upload cap, then reclaims expired tables', async t => {
  const { mkdtemp, rm, stat } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'opensight-uploads-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'uploads.duckdb');
  let now = Date.parse('2026-01-01T00:00:00Z');
  const lifetime = { ttlMs: 1000, now: () => now };
  let stage = await UploadStaging.create(lifetime, path);
  t.after(() => stage.close());
  const first = await stage.ingest(input('name,amount,day,active\nNorth,2.5,2026-01-01,true\nSouth,,2026-01-02,false'));
  const before = await stage.preview(first.id);
  for (let i = 1; i < 20; i++) await stage.ingest(input('name,value\nNorth,2'));
  stage.close(); now += 999;
  stage = await UploadStaging.create(lifetime, path);
  assert.deepEqual(await stage.preview(first.id), before);
  assert.equal(stage.prepSources().length, 20);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  await assert.rejects(stage.ingest(input('name,value\nNorth,2')), { code: 'UPLOAD_LIMIT_EXCEEDED' });
  stage.close(); now++;
  stage = await UploadStaging.create(lifetime, path);
  assert.deepEqual(stage.prepSources(), []);
  await assert.rejects(stage.preview(first.id), { code: 'UPLOAD_NOT_FOUND' });
  await assert.rejects(stage.previewPrep({ version: 1, input: first.id, steps: [] }), { code: 'PREP_SOURCE_NOT_FOUND' });
  assert.equal((await stage.ingest(input('name,value\nNew,3'))).rowCount, 1);
  const { DuckDBInstance } = await import('@duckdb/node-api');
  stage.close();
  const db = await DuckDBInstance.create(path), c = await db.connect();
  try { assert.equal((await c.runAndReadAll('SELECT table_name FROM information_schema.tables')).getRows().some(row => row[0] === first.id), false); }
  finally { c.closeSync(); db.closeSync(); }
  stage = await UploadStaging.create(lifetime, path);
});

test('a committed local upload survives abrupt process death through DuckDB WAL recovery', async t => {
  const { mkdtemp, rm, readFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { spawn } = await import('node:child_process');
  const dir = await mkdtemp(join(tmpdir(), 'opensight-crash-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'uploads.duckdb');
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { UploadStaging } from '@opensight/query-engine';
    import { writeFile } from 'node:fs/promises';
    const stage = await UploadStaging.create({ ttlMs: 86400000 }, process.argv[1]);
    const upload = await stage.ingest({ config: { format: 'csv' }, data: Buffer.from('team,amount\\nNorth,7') });
    await writeFile(process.argv[1] + '.summary', JSON.stringify(upload));
    process.kill(process.pid, 'SIGKILL');
  `, path], { stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = '';
  child.stderr.on('data', chunk => { errors += chunk; });
  const ended = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
  assert.equal(ended.signal, 'SIGKILL', errors);
  const uploaded = JSON.parse(await readFile(path + '.summary', 'utf8')), stage = await UploadStaging.create({ ttlMs: 86400000 }, path);
  try {
    const result = await stage.preview(uploaded.id);
    assert.deepEqual(result.upload, uploaded);
    assert.deepEqual(result.rows, [{ team: 'North', amount: 7 }]);
  } finally { stage.close(); }
});
