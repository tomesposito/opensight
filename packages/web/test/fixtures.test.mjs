import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareFixtures } from '../scripts/prepare-fixtures.mjs';
import { loadQsBundle } from '@opensight/bundle-parser';

const root = new URL('../../../fixtures/', import.meta.url);
test('fixture preparation preserves real definitions, observed placement defaults and absent data', async () => {
  const [fixture] = await prepareFixtures();
  const bundle = await loadQsBundle(new URL('real-bundle-sample/TotalDeathByCountry.sanitized.qs', root));
  const dashboard = bundle.members.find(m => m.resource.resourceType === 'dashboard').resource;
  assert.equal(fixture.id, dashboard.dashboardId);
  const visual = fixture.sheets[0].visuals[0];
  assert.deepEqual(visual.definition, dashboard.definition.sheets[0].visuals[0]);
  assert.deepEqual(visual.placement, { column: 0, columns: 18, row: 0, rows: 12 });
  assert.equal(visual.rows, null);
});
test('all five synthetic visuals are paired with exact oracle rows and grid placements', async () => {
  const [, fixture] = await prepareFixtures();
  const results = JSON.parse(await readFile(new URL('renderable-sales/expected-queries.json', root), 'utf8'));
  assert.equal(fixture.sheets[0].visuals.length, 5);
  for (const visual of fixture.sheets[0].visuals) {
    const id = Object.values(visual.definition)[0].VisualId;
    assert.deepEqual(visual.rows, results.find(r => r.visualId === id).rows);
    assert.equal(visual.placement.columns, 18);
  }
});
for (const filename of ['analysis.json', 'describe-data-set.response.json', 'describe-data-source.response.json', 'local-data.json', 'expected-queries.json', 'sales.csv']) {
  test(`changed ${filename} blocks stale result rendering`, async () => {
    const temp = await mkdtemp(join(tmpdir(), 'opensight-fixtures-'));
    try {
      await cp(root, temp, { recursive: true });
      const path = join(temp, 'renderable-sales', filename);
      // Even a one-byte change requires explicit dependency review; stronger than a
      // shape check that could miss a new filter, security property or calculation.
      await writeFile(path, Buffer.concat([await readFile(path), Buffer.from(' ')]));
      await assert.rejects(prepareFixtures(temp), new RegExp(`${filename}: fixture changed`));
    } finally { await rm(temp, { recursive: true, force: true }); }
  });
}
