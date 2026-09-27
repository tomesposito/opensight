import { crc32 } from 'node:zlib';
import { fromBufferPromise } from 'yauzl';
import { ValidationError, fail } from './validation.js';

import { ZIP_LIMITS, memberJsonPath } from './zip-common.js';
import type { ZipMemberInfo } from './zip-common.js';
export { ZIP_LIMITS, memberJsonPath } from './zip-common.js';
export type { ZipMemberInfo } from './zip-common.js';

/** Central-directory order; list-only calls do not decompress member contents. */
export async function listZipMembers(bytes: Uint8Array): Promise<ZipMemberInfo[]> {
  return readZipArchive(bytes);
}

export async function readZipArchive(
  bytes: Uint8Array,
  visit?: (member: ZipMemberInfo, data: Uint8Array) => void,
): Promise<ZipMemberInfo[]> {
  if (bytes.byteLength > ZIP_LIMITS.archiveBytes) fail('$', 'ZIP exceeds archive byte limit');
  let path = '$';
  try {
    const zip = await fromBufferPromise(Buffer.from(bytes), {
      lazyEntries: true, strictFileNames: true, validateEntrySizes: true,
    });
    try {
      if (zip.entryCount > ZIP_LIMITS.members) fail('$', 'ZIP exceeds member count limit');
      const members: ZipMemberInfo[] = [];
      const seen = new Set<string>();
      let total = 0;
      for await (const entry of zip.eachEntry()) {
        path = memberJsonPath(entry.fileName);
        const directory = entry.fileName.endsWith('/');
        const parts = (directory ? entry.fileName.slice(0, -1) : entry.fileName).split('/');
        if (/[\u0000-\u001f\u007f\\]/u.test(entry.fileName) ||
            parts.some(part => part === '' || part === '.' || part === '..')) {
          fail(path, 'unsafe or noncanonical ZIP member path');
        }
        if (seen.has(entry.fileName)) fail(path, 'duplicate ZIP member path');
        seen.add(entry.fileName);
        if (entry.isEncrypted()) fail(path, 'encrypted ZIP members are unsupported');
        if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
          fail(path, 'unsupported ZIP compression method');
        }
        if (entry.uncompressedSize > ZIP_LIMITS.memberBytes) fail(path, 'ZIP exceeds member byte limit');
        total += entry.uncompressedSize;
        if (total > ZIP_LIMITS.totalBytes) fail(path, 'ZIP exceeds total uncompressed byte limit');
        if (directory && entry.uncompressedSize !== 0) fail(path, 'directory entry contains data');
        const member = { path: entry.fileName, compressedSize: entry.compressedSize,
          uncompressedSize: entry.uncompressedSize, directory };
        members.push(member);
        if (!visit || directory) {
          path = '$';
          continue;
        }
        const stream = await zip.openReadStreamPromise(entry);
        const chunks: Buffer[] = [];
        let size = 0;
        let checksum = 0;
        // yauzl also verifies the actual inflated size against the central directory.
        for await (const chunk of stream) {
          const data = chunk as Buffer;
          size += data.length;
          if (size > ZIP_LIMITS.memberBytes) fail(path, 'ZIP exceeds member byte limit');
          checksum = crc32(data, checksum);
          chunks.push(data);
        }
        if (size !== entry.uncompressedSize) fail(path, 'ZIP member size mismatch');
        if (checksum !== entry.crc32) fail(path, 'ZIP member CRC32 mismatch');
        visit(member, Buffer.concat(chunks, size));
        path = '$';
      }
      return members;
    } finally {
      zip.close();
    }
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError(path, `invalid ZIP: ${error instanceof Error ? error.message : String(error)}`);
  }
}
