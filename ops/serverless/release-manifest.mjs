import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function compatibility(files) {
  return digest(JSON.stringify(files.sort(([a], [b]) => a.localeCompare(b))));
}
export function validateManifest(m) {
  if (m?.version !== 1 || m.platform !== 'linux/arm64' || !/^[a-f0-9]{40}$/.test(m.source ?? '')
    || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(m.repository ?? '') || !/^[1-9][0-9]*$/.test(m.runId ?? '')
    || m.workflow !== '.github/workflows/ci.yml' || m.ref !== 'refs/heads/master'
    || !/^[a-f0-9]{64}$/.test(m.compatibility ?? '') || !/^sha256:[a-f0-9]{64}$/.test(m.imageDigest ?? '')
    || Object.keys(m.artifacts ?? {}).sort().join() !== 'frontend.tar.gz,runtime-sbom.json,runtime.oci.tar'
    || Object.values(m.artifacts).some(h => !/^[a-f0-9]{64}$/.test(h))) throw Error('RELEASE_MANIFEST_INVALID');
  return m;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.argv[2]; if (!root) throw Error('RELEASE_DIRECTORY_REQUIRED');
  const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  // Conservatively changing any schema/coordination/auth contract requires a new
  // reviewed compatibility baseline, never an automatic production migration.
  const contracts = files.filter(p => /^packages\/api\/src\//.test(p)
    && /(?:schema|migration|coordination|dispatch|authority|metadata|auth|session|object-|artifact-|manifest|durable-)/.test(p));
  const index = JSON.parse(execFileSync('tar', ['-xOf', join(root, 'runtime.oci.tar'), 'index.json'], { encoding: 'utf8' }));
  if (index.manifests?.length !== 1) throw Error('SINGLE_IMAGE_REQUIRED');
  const artifacts = Object.fromEntries(['runtime.oci.tar', 'frontend.tar.gz', 'runtime-sbom.json'].map(p => [p, digest(readFileSync(join(root, p)))]));
  const value = validateManifest({ version: 1, repository: process.env.GITHUB_REPOSITORY, source: process.env.GITHUB_SHA,
    runId: process.env.GITHUB_RUN_ID, workflow: '.github/workflows/ci.yml', ref: process.env.GITHUB_REF,
    platform: 'linux/arm64', imageDigest: index.manifests[0].digest, artifacts,
    compatibility: compatibility(contracts.map(p => [p, digest(readFileSync(p))])),
    lockfiles: Object.fromEntries(['package-lock.json', 'ops/serverless/browser/package-lock.json'].map(p => [p, digest(readFileSync(p))])),
    dockerfile: digest(readFileSync('ops/serverless/Dockerfile')), actions: JSON.parse(readFileSync('ops/serverless/action-pins.json', 'utf8')) });
  writeFileSync(join(root, 'release.json'), JSON.stringify(value, null, 2) + '\n');
  console.log('Immutable release manifest created.');
}
