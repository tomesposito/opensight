import test from 'node:test';
import assert from 'node:assert/strict';
import { materializationReason } from '../dist/blaze-policy.js';
const keep = { id: 'keep', kind: 'select', config: { columns: ['id'] } };
const sum = { id: 'sum', kind: 'aggregate', config: { groupBy: [], measures: [{ column: 'id', name: 'total', aggregation: 'SUM' }] } };
const join = source => ({ id: 'joined', from: 'keep', kind: 'join', config: { source, joinType: 'left', keys: [{ left: 'id', right: 'id' }], prefix: 'r_' } });
test('Blaze requirements follow output ancestry including right-step inputs and nested dataset outputs', () => {
  const pipeline = { version: 1, input: 'table', steps: [keep, sum, { ...keep, id: 'detail', from: 'keep' }], output: 'detail' };
  const reason = p => materializationReason('test', [{ id: 'test', pipeline: p, mode: 'DIRECT_QUERY' }]);
  assert.equal(reason(pipeline), null);
  assert.match(reason({ ...pipeline, output: 'sum' }), /aggregate/);
  assert.match(reason({ ...pipeline, steps: [...pipeline.steps, join({ step: 'sum' })], output: 'joined' }), /aggregate/);
  assert.equal(reason({ ...pipeline, steps: [...pipeline.steps, join('other')] }), null);
  assert.match(reason({ ...pipeline, steps: [...pipeline.steps, join('other')], output: 'joined' }), /Cross-source/);
  const datasets = [{ id: 'test', pipeline, mode: 'DIRECT_QUERY' }, { id: 'child', pipeline: { version: 1, input: { dataset: 'test' }, steps: [] }, mode: 'DIRECT_QUERY' }];
  assert.equal(materializationReason('child', datasets), null);
  datasets[0].pipeline = { ...pipeline, output: 'sum' };
  assert.match(materializationReason('child', datasets), /aggregate/);
});

test('single-input window and keep-first filter steps stay on the direct path', () => {
  const window = { id: 'window', kind: 'window', config: { name: 'position', function: 'rowNumber', partitionBy: [], orderBy: [{ column: 'id', direction: 'asc' }] } };
  const filter = { id: 'filter', kind: 'filter', config: { filters: [{ columnName: 'position', operator: 'EQUALS', value: 1 }] } };
  for (const steps of [[window], [window, filter]]) {
    const pipeline = { version: 1, input: 'table', steps };
    assert.equal(materializationReason('test', [{ id: 'test', pipeline, mode: 'DIRECT_QUERY' }]), null);
  }
});
