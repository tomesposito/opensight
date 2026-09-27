/** Browser entry point: no Node built-ins, filesystem, network or result data. */
import { zipSync } from 'fflate/browser';
import { parseArchive, parseMember, resourceId, summarizeQsBundle } from './archive-core.js';
import { parseBundleResource } from './bundle-validate.js';
import { readZipArchive } from './zip-browser.js';
import { ZIP_LIMITS } from './zip-common.js';
import { fail } from './validation.js';
import type { QsBundle } from './bundle-types.js';
export { parseBundleResource, summarizeQsBundle, ZIP_LIMITS };
export { ValidationError } from './validation.js';
export type * from './bundle-types.js';
export type { QsBundleSummary } from './archive-core.js';
export const parseQsBundle = (bytes: Uint8Array): Promise<QsBundle> => parseArchive(bytes, readZipArchive);
export const listZipMembers = (bytes: Uint8Array) => readZipArchive(bytes);

/** Single-member JSON uses the same envelope and path/ID validation as archives. */
export function parseBundleJson(bytes: Uint8Array): QsBundle {
  if (bytes.length > ZIP_LIMITS.memberBytes) fail('$', 'JSON exceeds member byte limit');
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail('$', 'expected valid UTF-8 JSON'); }
  const resource = parseBundleResource(raw);
  return { members: [parseMember(`${resource.resourceType}/${resourceId(resource)}.json`, resource)] };
}

/** Validate every member before ZIP assembly, then verify the generated archive. */
export async function assembleQsBundle(bundle: QsBundle): Promise<Uint8Array> {
  summarizeQsBundle(bundle);
  if (!bundle.members.length) fail('$', 'bundle contains no resource members');
  if (bundle.members.length > ZIP_LIMITS.members) fail('$', 'ZIP exceeds member count limit');
  const files: Record<string, Uint8Array> = Object.create(null) as Record<string, Uint8Array>;
  let total = 0;
  for (const member of bundle.members) {
    const data = new TextEncoder().encode(JSON.stringify(member.resource, null, 2) + '\n');
    if (data.length > ZIP_LIMITS.memberBytes) fail(member.path, 'ZIP exceeds member byte limit');
    total += data.length;
    if (total > ZIP_LIMITS.totalBytes) fail('$', 'ZIP exceeds total uncompressed byte limit');
    files[member.path] = data;
  }
  const bytes = zipSync(files, { level: 6 });
  await parseQsBundle(bytes);
  return bytes;
}
