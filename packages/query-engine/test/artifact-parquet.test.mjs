import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { withArtifactFile, writeArtifactParquet, readArtifactParquet } from '../dist/artifact-parquet.js';

test('SR2b DuckDB permits only its exact artifact file and locks external-access configuration', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sr2b-allowlist-')), path = join(directory, 'allowed.parquet');
  try {
    await withArtifactFile(path, 64, async c => {
      await c.run('COPY (SELECT 1) TO $1 (FORMAT PARQUET)', [path]);
      await assert.rejects(c.run('COPY (SELECT 2) TO $1 (FORMAT PARQUET)', [join(directory, 'denied.parquet')]));
      await assert.rejects(c.run('SET enable_external_access = true'));
      await assert.rejects(c.run('SET allowed_paths = [$1]', [join(directory, 'denied.parquet')]));
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('SR2b native decoder refuses wrong physical schema, extra/missing rows and duplicate ordinals', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sr2b-corrupt-')), columns = [{ name: 'value', type: 'INTEGER' }];
  const sink = { start() {}, row() {}, oversized() { throw new Error('oversized'); } };
  try {
    const path = join(directory, 'valid.parquet'); await writeArtifactParquet(path, columns, [[1], [2]], 64);
    await assert.rejects(readArtifactParquet(path, columns, 1, 100, sink, 64), { code: 'ARTIFACT_INVALID' });
    await assert.rejects(readArtifactParquet(path, columns, 3, 100, sink, 64), { code: 'ARTIFACT_INVALID' });
    for (const [name, sql] of [
      ['schema', "SELECT 0::BIGINT ordinal, 'wrong'::VARCHAR c0n, NULL::VARCHAR c0s"],
      ['duplicate', 'SELECT 0::BIGINT ordinal, 1::DOUBLE c0n, NULL::VARCHAR c0s FROM range(2)'],
      ['both', "SELECT 0::BIGINT ordinal, 1::DOUBLE c0n, '2'::VARCHAR c0s"],
    ]) {
      const invalid = join(directory, `${name}.parquet`); await withArtifactFile(invalid, 64, c => c.run(`COPY (${sql}) TO $1 (FORMAT PARQUET)`, [invalid]));
      await assert.rejects(readArtifactParquet(invalid, columns, name === 'duplicate' ? 2 : 1, 100, sink, 64), { code: 'ARTIFACT_INVALID' });
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
