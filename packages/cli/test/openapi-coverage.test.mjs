import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { inventory, source, specUrl } from '../scripts/generate.mjs';
import { operations } from '../dist/generated.js';

const spec = load(readFileSync(specUrl, 'utf8'));
const entries = Object.entries(spec.paths).flatMap(([path, item]) => Object.entries(item)
  .filter(([method]) => ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'].includes(method))
  .map(([method, op]) => ({ path, item, method, op })));

test('exactly one CLI command for each of the 53 spec operations, with no extra routes', () => {
  assert.equal(entries.length, 53);
  assert.deepEqual(operations.map(o => o.operationId).sort(), entries.map(e => e.op.operationId).sort());
  assert.equal(new Set(operations.map(o => `${o.noun} ${o.command}`)).size, entries.length);
  for (const e of entries) {
    const op = operations.find(o => o.operationId === e.op.operationId);
    assert.equal(op.path, e.path);
    assert.equal(op.method, e.method.toUpperCase());
    const resolve = p => p.$ref ? p.$ref.slice(2).split('/').reduce((v, k) => v[k], spec) : p;
    for (const raw of [...(e.item.parameters ?? []), ...(e.op.parameters ?? [])]) {
      const p = resolve(raw), arg = op.arguments.find(a => a.location === p.in && a.wireName === p.name);
      assert.ok(arg, `${op.operationId} missing ${p.name}`);
      assert.equal(arg.required, !!p.required);
      assert.deepEqual(arg.schema, p.schema);
    }
  }
});

test('committed operation table regenerates deterministically', () => {
  assert.equal(readFileSync(new URL('../src/generated.ts', import.meta.url), 'utf8'), source(spec));
  assert.deepEqual(operations, inventory(spec));
});

test('generator fails on missing/duplicate IDs, unsupported parameters and unsafe references', () => {
  for (const alter of [
    s => { delete s.paths['/datasets'].get.operationId; },
    s => { s.paths['/datasets'].get.operationId = 'list_sources'; },
    s => { s.paths['/datasets'].get.parameters = [{ $ref: 'https://external.example/schema' }]; },
    s => { s.paths['/datasets'].get.parameters = [{ name: 'Authorization', in: 'header', schema: { type: 'string' } }]; },
    s => { s.paths['/datasets'].get.parameters = [{ name: 'format', in: 'path', schema: { type: 'string' } }]; },
  ]) { const changed = structuredClone(spec); alter(changed); assert.throws(() => inventory(changed)); }
});
