import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { parseUpload, UploadStaging } from '@opensight/query-engine';
const input = (data, config = { format: 'csv' }, columns) => ({ config, data: Buffer.from(data), ...(columns ? { columns } : {}) });
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
