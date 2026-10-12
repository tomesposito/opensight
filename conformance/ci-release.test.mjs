import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSource } from '../ops/serverless/ci-check.mjs';
import { compatibility, validateManifest } from '../ops/serverless/release-manifest.mjs';

test('SR4c source checks reject credential-shaped material, private config and unsafe paths', () => {
  checkSource([{ path: 'docs/example.md', text: 'Synthetic configuration only.' }]);
  for (const path of ['.env', 'ops/prod.tfvars.json', 'state.tfplan', 'CON.md', 'bad:name', 'bad.']) assert.throws(() => checkSource([{ path, text: '' }]));
  assert.throws(() => checkSource([{ path: 'A.md', text: '' }, { path: 'a.md', text: '' }]));
  assert.throws(() => checkSource([{ path: 'docs/example.md', text: 'AK' + 'IA' + '0'.repeat(16) }]));
});
test('SR4c release manifests bind source, workflow, architecture and every artifact', () => {
  const m = { version: 1, platform: 'linux/arm64', repository: 'example/opensight', source: 'a'.repeat(40), runId: '123',
    workflow: '.github/workflows/ci.yml', ref: 'refs/heads/master', compatibility: 'b'.repeat(64), imageDigest: 'sha256:' + 'c'.repeat(64),
    licenses: 'e'.repeat(64),
    artifacts: Object.fromEntries(['runtime.oci.tar', 'frontend.tar.gz', 'runtime-sbom.json'].map(k => [k, 'd'.repeat(64)])) };
  assert.equal(validateManifest(m), m);
  for (const patch of [{ source: 'master' }, { ref: 'refs/pull/1/merge' }, { platform: 'linux/amd64' }, { artifacts: {} }, { imageDigest: 'latest' }, { licenses: 'zz' }]) assert.throws(() => validateManifest({ ...m, ...patch }));
  assert.equal(compatibility([['b', '2'], ['a', '1']]), compatibility([['a', '1'], ['b', '2']]));
  assert.notEqual(compatibility([['a', '1']]), compatibility([['a', '2']]));
});
