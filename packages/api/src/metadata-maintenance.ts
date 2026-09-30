import { randomUUID } from 'node:crypto';
import { open, readFile, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { MetadataError, SqliteMetadataDatabase } from './metadata-db.js';

const absent = (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ENOENT';
export async function assertLegacyWritable(path: string): Promise<void> {
  try { await readFile(`${path}.h1-frozen`); }
  catch (error) { if (absent(error)) return; throw error; }
  throw new MetadataError('LEGACY_STORE_FROZEN', 503);
}
/** Single-node OS-backed locking. SQLite releases the lock on process death; no PID-file race. */
export async function maintenanceLock<T>(path: string, work: () => Promise<T>): Promise<T> {
  const lock = new SqliteMetadataDatabase(`${path}.h1-write-lock`);
  try { return await lock.transaction(work); }
  finally { await lock.close(); }
}
async function syncDirectory(path: string): Promise<void> {
  const directory = await open(dirname(path), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}
export async function legacyWrite<T>(path: string, work: () => Promise<T>): Promise<T> {
  return maintenanceLock(path, async () => { await assertLegacyWritable(path); return work(); });
}
export async function freezeLegacy(path: string, migrationId: string): Promise<void> {
  await maintenanceLock(path, async () => {
    const marker = `${path}.h1-frozen`;
    try {
      const existing = await readFile(marker, 'utf8');
      if (existing !== migrationId) throw new MetadataError('LEGACY_STORE_FROZEN', 503);
      return;
    } catch (error) { if (!absent(error)) throw error; }
    const temporary = `${marker}.${randomUUID()}.tmp`;
    try {
      const file = await open(temporary, 'wx', 0o600);
      try { await file.writeFile(migrationId); await file.sync(); } finally { await file.close(); }
      await rename(temporary, marker); await syncDirectory(marker);
    } finally { await rm(temporary, { force: true }); }
  });
}
export async function unfreezeLegacy(path: string, migrationId: string): Promise<void> {
  await maintenanceLock(path, async () => {
    const marker = `${path}.h1-frozen`;
    try { if (await readFile(marker, 'utf8') !== migrationId) throw new MetadataError('MIGRATION_FREEZE_MISMATCH'); }
    catch (error) { if (absent(error)) return; throw error; }
    await rm(marker); await syncDirectory(marker);
  });
}
