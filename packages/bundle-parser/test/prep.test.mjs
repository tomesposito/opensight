import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePrepPipeline, PrepError, parseBundleResource, parseQsBundle } from '../dist/index.js';
import { assembleQsBundle } from '../dist/browser.js';
const pipeline = { version: 1, input: 'source', steps: [{ id: 'rename', kind: 'rename', config: { column: 'old', name: 'new' } }] };
test('prep model validates typed steps and rejects unsupported configurations by name', () => {
  assert.deepEqual(validatePrepPipeline(pipeline), pipeline);
  for (const value of [{ ...pipeline, version: 2 }, { ...pipeline, extra: true }, { ...pipeline, steps: [...pipeline.steps, ...pipeline.steps] }, { ...pipeline, steps: [{ id: 's', kind: 'sql', config: {} }] }, { ...pipeline, steps: [{ id: 's', kind: 'rename', config: { column: 'x', name: 'y', ignored: true } }] }]) assert.throws(() => validatePrepPipeline(value), PrepError);
});
test('dataset prep survives resource and ZIP import/export without losing ordered configuration', async () => {
  const resource = { resourceType: 'dataset', dataSetId: 'prepared', name: 'Prepared', physicalTableMap: {}, importMode: 'DIRECT_QUERY', opensightPrep: pipeline };
  assert.deepEqual(parseBundleResource(resource), resource);
  const bundle = { members: [{ path: 'dataset/prepared.json', resource }] };
  assert.deepEqual(await parseQsBundle(await assembleQsBundle(bundle)), bundle);
  assert.throws(() => parseBundleResource({ ...resource, opensightPrep: { ...pipeline, steps: [{ id: 's', kind: 'sql', config: {} }] } }), /UNSUPPORTED|unsupported/);
});
