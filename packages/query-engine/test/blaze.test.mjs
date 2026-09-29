import test from 'node:test';
import assert from 'node:assert/strict';
import { UploadStaging, queryPrepared, withPrepMemory, streamPrepDuckDb, compilePrep } from '../dist/index.js';
const limits = { maxRows: 1000, cellChars: 100 };
function sink() { return { columns: [], rows: [], start(columns) { this.columns = columns; }, row(values) { this.rows.push(values); }, oversized() { throw new Error('OVERSIZE'); } }; }
test('full materialization exceeds preview size, feeds cached joins and shares query calculation semantics', async () => {
  const staging = await UploadStaging.create();
  try {
    const upload = await staging.ingest({ config: { format: 'csv' }, data: Buffer.from('id,amount\n' + Array.from({ length: 600 }, (_, i) => `${i},2`).join('\n')) });
    const pipeline = { version: 1, input: upload.id, steps: [] }, result = sink();
    await staging.streamPrep(pipeline, {}, limits, result);
    assert.equal(result.rows.length, 600);
    const cached = { id: 'cache', connectorId: 'file', table: '__cache', security: 'unrestricted', columns: result.columns };
    const broken = { id: 'saved', pipeline: { version: 1, input: 'expired-source', steps: [] }, materialized: cached };
    const joined = { version: 1, input: { dataset: 'saved' }, steps: [{ id: 'join', kind: 'join', config: { source: { dataset: 'saved' }, joinType: 'inner', keys: [{ left: 'id', right: 'id' }], prefix: 'r_' } }] };
    const output = sink();
    await withPrepMemory([{ source: cached, rowCount: 600, value: (r,c) => result.rows[r][c] }], c => streamPrepDuckDb(c, joined, [cached], { datasets: [broken] }, limits, output));
    assert.equal(output.rows.length, 600); assert.deepEqual(output.rows[0].slice(1,2), [2]);
    const query = { dimensions: [], measures: [{ fieldId: 'sum', columnName: 'doubled', aggregation: 'SUM' }], filters: [], calculatedFields: [{ name: 'doubled', expression: '{amount} * 2' }] };
    assert.deepEqual(queryPrepared(result.columns, result.rows.length, (r,c) => result.rows[r][c], query).rows, [{ sum: 2400 }]);
    assert.doesNotMatch(compilePrep(joined, [], { datasets: [broken] }).sql, /expired-source/);
  } finally { staging.close(); }
});
test('source guards reject large text before passing rows to the materializer', async () => {
  const staging = await UploadStaging.create();
  try {
    const upload = await staging.ingest({ config: { format: 'csv' }, data: Buffer.from('name\n' + 'x'.repeat(101) + '\n') });
    const result = sink();
    await assert.rejects(staging.streamPrep({ version: 1, input: upload.id, steps: [] }, {}, limits, result), /OVERSIZE/);
    assert.equal(result.rows.length, 0);
    const again = sink(); await staging.streamPrep({ version: 1, input: upload.id, steps: [] }, {}, { ...limits, cellChars: 200 }, again); assert.equal(again.rows.length, 1);
  } finally { staging.close(); }
});
