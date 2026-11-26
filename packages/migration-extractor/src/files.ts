import { constants } from 'node:fs';
import { lstat, mkdir, open, rm } from 'node:fs/promises';
import { dirname, parse, resolve } from 'node:path';
import { parseExtractionManifest, parseBundleJson, ZIP_LIMITS } from '@opensight/bundle-parser';
import { assertNoCredentials } from './resources.js';
import type { ExtractionResult } from './index.js';
function localPath(path: string): string {
  if (!path || /^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith('//') || path.includes('\\') || /[\x00-\x1f]/.test(path)) throw new Error('LOCAL_PATH_REQUIRED');
  return resolve(path);
}
async function noSymlinks(path: string): Promise<void> {
  let current = path;
  while (current !== parse(current).root) {
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) throw new Error('LOCAL_SYMLINK_REFUSED');
    current = dirname(current);
  }
}
export async function validateOutput(path: string): Promise<void> {
  const target = localPath(path);
  await noSymlinks(dirname(target));
  try { await lstat(target); }
  catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return; throw error; }
  throw new Error('LOCAL_OUTPUT_EXISTS');
}
export async function readPrevious(path: string): Promise<unknown> {
  const target = localPath(path);
  await noSymlinks(target);
  const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > ZIP_LIMITS.memberBytes) throw new Error('MIGRATION_MANIFEST_INVALID');
    const bytes = await file.readFile();
    if (bytes.length > ZIP_LIMITS.memberBytes) throw new Error('MIGRATION_MANIFEST_INVALID');
    return parseExtractionManifest(JSON.parse(bytes.toString('utf8')));
  } finally { await file.close(); }
}
/** A fresh private directory makes reruns reviewable and prevents overwrites.
 * Nothing here stores SDK config, credentials, request IDs or exception text. */
export async function writeExtraction(path: string, result: ExtractionResult): Promise<void> {
  const target = localPath(path);
  await validateOutput(path);
  assertNoCredentials(result);
  const manifest = parseExtractionManifest(result.manifest);
  const bundle = JSON.stringify(result.bundle, null, 2) + '\n';
  if (result.bundle.members.length) parseBundleJson(Buffer.from(bundle));
  else if (Object.keys(result.bundle).length !== 1) throw new Error('DEFINITION_INVALID');
  await noSymlinks(dirname(target));
  await mkdir(target, { mode: 0o700 }); // EEXIST is intentional, including symlinks.
  try {
    for (const [name, body] of [['bundle.json', bundle], ['manifest.json', JSON.stringify(manifest, null, 2) + '\n']]) {
      const file = await open(resolve(target, name!), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await file.writeFile(body!); await file.sync(); } finally { await file.close(); }
    }
  } catch (error) { await rm(target, { recursive: true, force: true }); throw error; }
}
