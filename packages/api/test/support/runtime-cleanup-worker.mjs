import assert from 'node:assert/strict';
import { InvocationScope } from '../../dist/runtime-scope.js';
let forced = 0;
const scope = new InvocationScope(Date.now() + 1000, 30);
await assert.rejects(scope.run(async s => {
  s.own({ close: async () => { if (process.argv[2] === 'end') throw Error('private end diagnostic'); await new Promise(() => {}); }, force: () => { forced++; } });
}), { code: 'INVOCATION_CLEANUP_FAILED' });
assert.ok(forced > 0);
assert.throws(() => new InvocationScope(Date.now() + 10000), { code: 'RUNTIME_QUARANTINED' });
console.log('cleanup quarantined');
