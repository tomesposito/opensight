import { open } from 'node:fs/promises';
import type { QsBundle } from './bundle-types.js';
import { fail } from './validation.js';
import { readZipArchive, ZIP_LIMITS } from './zip.js';
import { parseArchive } from './archive-core.js';
export { summarizeQsBundle } from './archive-core.js';
export type { QsBundleSummary, BundleDefinitionSummary } from './archive-core.js';

export const parseQsBundle = (bytes: Uint8Array): Promise<QsBundle> => parseArchive(bytes, readZipArchive);

/** Bounded local file read; no network access or AWS calls. */
export async function loadQsBundle(path: string | URL): Promise<QsBundle> {
  const file = await open(path, 'r');
  try {
    if ((await file.stat()).size > ZIP_LIMITS.archiveBytes) fail('$', 'ZIP exceeds archive byte limit');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of file.createReadStream({ autoClose: false })) {
      const data = chunk as Buffer;
      size += data.length;
      if (size > ZIP_LIMITS.archiveBytes) fail('$', 'ZIP exceeds archive byte limit');
      chunks.push(data);
    }
    return await parseQsBundle(Buffer.concat(chunks, size));
  } finally {
    await file.close();
  }
}
