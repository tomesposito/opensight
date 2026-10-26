import assert from 'node:assert/strict';
import { createRuntime } from '../../dist/runtime.js';
import { MetadataError } from '../../dist/metadata-db.js';
import { runtimeEnv, startupEvent, context, payload } from '../runtime-helpers.mjs';

// Quarantine is process-wide, so exercise the real cleanup failure in a child.
let opened = 0, closed = 0, forced = 0;
const runtime = createRuntime(runtimeEnv, { databases(scope) {
  opened++;
  scope.own({ close: async () => { closed++; throw Error('private cleanup diagnostic with secrets'); }, force() { forced++; } });
  return { prepare: async () => { throw new MetadataError('INVOCATION_DEADLINE_EXCEEDED', 503); } };
}, application: () => assert.fail('startup built API application') });
for (const code of ['INVOCATION_CLEANUP_FAILED', 'RUNTIME_QUARANTINED']) {
  const result = await runtime.lambda(startupEvent(), context);
  assert.equal(result.statusCode, 503); assert.deepEqual(payload(result), { errorCode: code });
  assert.equal(result.headers['retry-after'], undefined); assert.doesNotMatch(result.body, /private|secrets/);
  assert.equal(opened, 1); assert.equal(closed, 1);
}
assert.ok(forced > 0);
console.log('startup cleanup quarantined');
