import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePrepPipeline, PrepError, parseBundleResource, parseQsBundle } from '../dist/index.js';
import { assembleQsBundle } from '../dist/browser.js';
const pipeline = { version: 1, input: 'source', steps: [{ id: 'rename', kind: 'rename', config: { column: 'old', name: 'new' } }] };
test('prep model validates typed steps and rejects unsupported configurations by name', () => {
  assert.deepEqual(validatePrepPipeline(pipeline), pipeline);
  for (const value of [{ ...pipeline, version: 2 }, { ...pipeline, extra: true }, { ...pipeline, steps: [...pipeline.steps, ...pipeline.steps] }, { ...pipeline, steps: [{ id: 's', kind: 'sql', config: {} }] }, { ...pipeline, steps: [{ id: 's', kind: 'rename', config: { column: 'x', name: 'y', ignored: true } }] }]) assert.throws(() => validatePrepPipeline(value), PrepError);
});
test('optional step names accept valid boundaries and leave absent names absent', () => {
  for (const name of ['A', 'Product Join', '2023 & 2024 Union', 'Calc – Clean Zip', 'x'.repeat(128)]) {
    const named = { ...pipeline, steps: [{ ...pipeline.steps[0], name }] };
    assert.deepEqual(validatePrepPipeline(named), named);
  }
  const parsed = validatePrepPipeline(pipeline);
  assert.equal(Object.hasOwn(parsed.steps[0], 'name'), false);
  assert.equal(Object.hasOwn(pipeline.steps[0], 'name'), false);
});
test('step names reject empty, padded, oversized, control-containing and non-string values at the name path', () => {
  for (const name of ['', ' ', ' Product Join', 'Product Join ', 'x'.repeat(129), 'Bad\0name', 'Bad\nname', 'Bad\tname', 'Bad\x1fname', null, 42, false, {}, undefined]) {
    assert.throws(() => validatePrepPipeline({ ...pipeline, steps: [{ ...pipeline.steps[0], name }] }),
      e => e instanceof PrepError && e.code === 'INVALID_PREP_PIPELINE' && e.path === '$.opensightPrep.steps[0].name');
  }
});
test('bundle import/export preserves step names and omitted names together', async () => {
  const p = { ...pipeline, steps: [
    { ...pipeline.steps[0], name: 'Clean region' },
    { id: 'select', kind: 'select', config: { columns: ['new'] } },
  ] };
  const resource = { resourceType: 'dataset', dataSetId: 'prepared', name: 'Prepared', physicalTableMap: {}, importMode: 'DIRECT_QUERY', opensightPrep: p };
  assert.deepEqual(parseBundleResource(resource), resource);
  const bundle = { members: [{ path: 'dataset/prepared.json', resource }] };
  const result = await parseQsBundle(await assembleQsBundle(bundle));
  assert.deepEqual(result, bundle);
  const steps = result.members[0].resource.opensightPrep.steps;
  assert.equal(steps[0].name, 'Clean region');
  assert.equal(Object.hasOwn(steps[1], 'name'), false);
});
test('dataset prep survives resource and ZIP import/export without losing ordered configuration', async () => {
  const resource = { resourceType: 'dataset', dataSetId: 'prepared', name: 'Prepared', physicalTableMap: {}, importMode: 'DIRECT_QUERY', opensightPrep: pipeline };
  assert.deepEqual(parseBundleResource(resource), resource);
  const bundle = { members: [{ path: 'dataset/prepared.json', resource }] };
  assert.deepEqual(await parseQsBundle(await assembleQsBundle(bundle)), bundle);
  assert.throws(() => parseBundleResource({ ...resource, opensightPrep: { ...pipeline, steps: [{ id: 's', kind: 'sql', config: {} }] } }), /UNSUPPORTED|unsupported/);
});

test('multi-input joins round-trip typed references and output modes through .qs archives', async () => {
  const p = { version: 1, input: { dataset: 'base' }, steps: [
    { id: 'joined', kind: 'join', config: { source: 'uploaded', joinType: 'full', keys: [{ left: 'id', right: 'id' }], prefix: 'uploaded_' } },
    { id: 'reuse', kind: 'join', config: { source: { step: 'joined' }, joinType: 'inner', keys: [{ left: 'id', right: 'id' }], columns: [{ column: 'uploaded_value', name: 'copy' }] } },
    { id: 'lookup', kind: 'join', config: { source: { dataset: 'lookup' }, joinType: 'right', keys: [{ left: 'id', right: 'id' }], prefix: 'lookup_' } },
  ] };
  const bundle = { members: [{ path: 'dataset/joined.json', resource: { resourceType: 'dataset', dataSetId: 'joined', name: 'Joined', physicalTableMap: {}, importMode: 'DIRECT_QUERY', opensightPrep: p } }] };
  assert.deepEqual(await parseQsBundle(await assembleQsBundle(bundle)), bundle);
  assert.deepEqual(validatePrepPipeline(p), p);
});
test('join reference and output validation rejects ambiguous, forward, repeated and malformed configs', () => {
  const join = { id: 'j', kind: 'join', config: { source: 'right', joinType: 'left', keys: [{ left: 'id', right: 'id' }], prefix: 'r_' } };
  const p = config => ({ version: 1, input: 'left', steps: [{ ...join, config: { ...join.config, ...config } }] });
  for (const config of [
    { source: { step: 'j' } }, { source: { step: 'later' } }, { source: {} }, { source: { dataset: 'd', step: 'j' } },
    { source: { dataset: 'd', security: 'unrestricted' } }, { source: { dataset: '' } }, { source: { cached: 'd' } },
    { prefix: '' }, { prefix: 'r_', columns: [{ column: 'id', name: 'id' }] }, { keys: [] },
    { keys: [{ left: 'id', right: 'id' }, { left: 'id', right: 'id' }] },
  ]) assert.throws(() => validatePrepPipeline(p(config)), e => e.code === 'INVALID_PREP_PIPELINE');
  assert.throws(() => validatePrepPipeline({ ...p({}), input: { step: 'j' } }), e => e.code === 'INVALID_PREP_PIPELINE');
  const noOutputs = p({}); delete noOutputs.steps[0].config.prefix;
  assert.throws(() => validatePrepPipeline(noOutputs), e => e.code === 'INVALID_PREP_PIPELINE');
});
test('import step budget caps source reads at 32 per workflow with a named limit error', () => {
  const appends = n => Array.from({ length: n }, (_, i) => ({ id: `a${i}`, kind: 'append', config: { source: `table${i}` } }));
  const p = n => ({ version: 1, input: 'left', steps: appends(n) });
  validatePrepPipeline(p(31)); // 1 input + 31 appends = 32 import steps: allowed
  assert.throws(() => validatePrepPipeline(p(32)), e => e.code === 'PREP_LIMIT_EXCEEDED' && /At most 32 import steps/.test(e.message));
});
test('step references do not consume the import step budget', () => {
  const join = i => ({ id: `j${i}`, kind: 'join', config: { source: 'right', joinType: 'left', keys: [{ left: 'id', right: 'id' }], prefix: `r${i}_` } });
  const stepRef = i => ({ id: `s${i}`, kind: 'join', config: { source: { step: `j${i}` }, joinType: 'left', keys: [{ left: 'id', right: 'id' }], prefix: `s${i}_` } });
  const steps = [];
  for (let i = 0; i < 16; i++) { steps.push(join(i), stepRef(i)); } // 16 imports + 16 step refs
  const p = { version: 1, input: 'left', steps };
  validatePrepPipeline(p); // 17 import steps total: allowed
  assert.throws(() => validatePrepPipeline({ version: 1, input: 'left', steps: Array.from({ length: 32 }, (_, i) => join(i)) }), e => e.code === 'PREP_LIMIT_EXCEEDED');
});
