import { execFileSync } from 'node:child_process';
import { cp, readFile, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assert, button, launchBrowser, navigate, output, repo, runJourney, startLocalStack, temporaryRoot } from './harness.mjs';

await runJourney('j5-migration', 'Admin + Author', async j => {
  const root = await temporaryRoot(); j.cleanup(() => rm(root, { recursive: true, force: true }));
  // The remap target is the local sales dataset: seed the stack's data root
  // with the renderable-sales fixture (same setup as j3) so the sales CSV
  // binding the remap points at actually resolves in this stack.
  await cp(resolve(repo, 'fixtures/renderable-sales'), resolve(root, 'renderable-sales'), { recursive: true });
  const stack = await startLocalStack(root); j.cleanup(stack.stop);
  const browser = await launchBrowser(j), page = await browser.page(stack);
  let title;
  await j.step('import-bundle', page, async () => {
    await page.goto(stack.origin); await page.locator('.app-shell').waitFor(); await navigate(page, 'author');
    await page.locator('.bundle-import summary').click();
    await page.getByLabel('Import .qs or bundle JSON', { exact: true }).setInputFiles(resolve(repo, 'fixtures/real-bundle-sample/TotalDeathByCountry.sanitized.qs'));
    await page.getByRole('dialog', { name: 'Bundle import report', exact: true }).waitFor();
    const report = await page.locator('.import-report').innerText();
    assert.match(report, /Death By Countries|TotalDeathByCountry/); assert.match(report, /athena|us_simplified/i);
    assert.equal(await page.locator('.import-report section').count(), 4);
    return 'The real .qs ZIP imported four resources; its report names the assets and preserves unsupported JSON.';
  });
  await j.step('review-imported-draft', page, async () => {
    await button(page, 'Close import report').click();
    assert.match(await page.locator('.bundle-import').innerText(), /Imported TotalDeathByCountry.sanitized.qs/);
    title = await page.getByLabel('Analysis title', { exact: true }).inputValue(); assert.ok(title.length > 0);
    await button(page, 'View import report').click(); await page.locator('.import-report').waitFor();
    await button(page, 'Close import report').click();
    await page.locator('.author-card').first().waitFor();
    await page.waitForFunction(() => !document.querySelector('.author-card [aria-busy="true"]'));
    const visuals = page.locator('.author-card .chart svg');
    if (await visuals.count()) assert.ok(await visuals.locator('path[d]').count(), 'Imported chart has drawable content');
    else {
      // Expected pre-remap state: the sanitized bundle refers to an
      // unconfigured Athena dataset, so the card shows the unresolved-dataset
      // placeholder until the remap step below binds the local dataset. The
      // imported-live-visual expectation is asserted after remap (#191).
      const actual = await page.locator('.author-card').allTextContents();
      assert.match(actual.join('\n'), /unresolved|unavailable|No data|Unable to load|not found|not supported/i);
    }
  });
  await j.step('remap-and-assign', page, async () => {
    await button(page, 'Remap sheet to local dataset').click();
    await page.locator('.author-card .author-card-toolbar strong').click();
    const binding = page.locator('.dataset-binding');
    await binding.waitFor();
    const bindingText = await binding.innerText();
    assert.match(bindingText, /Local sales dataset/);
    assert.match(bindingText, /Fields requiring manual assignment: country, deaths/);
    await button(page, 'Assign region').click();
    await button(page, 'Assign revenue').click();
    const wells = await page.locator('.field-wells').innerText();
    assert.match(wells, /region/); assert.match(wells, /SUM\(revenue\)/);
    await page.waitForFunction(() => document.querySelectorAll('.author-card .chart svg path[d]').length > 0);
    assert.ok(await page.locator('.author-card .chart svg path[d]').count(), 'The remapped imported pie renders populated');
    const card = await page.locator('.author-card').first().innerText();
    assert.doesNotMatch(card, /Unsupported features:/);
    assert.doesNotMatch(card, /unknown column/);
    return 'Remap binds the local sales dataset, manual assignment fills both wells (region, SUM(revenue)), and the imported pie renders populated: retained, read-only properties stay named in the dataset-binding disclosure and foreign tooltip IDs stay out of the live query (#191, #195).';
  });
  await j.step('save-import', page, async () => {
    await button(page, 'Save draft').click(); await page.getByText('Draft saved on this device.', { exact: true }).waitFor();
    return `Saved the imported draft “${title}”.`;
  });
  await j.step('export-bundle', page, async () => {
    await page.locator('[data-author-menu="File"] > summary').click(); await button(page, 'Exports').click();
    const downloadReady = page.waitForEvent('download'); await button(page, 'Download .qs').click();
    const download = await downloadReady, filename = 'j5-migration-export.qs', path = resolve(output, filename);
    await download.saveAs(path); assert.equal(await download.failure(), null); assert.ok((await stat(path)).size > 0);
    assert.equal((await readFile(path)).subarray(0, 2).toString(), 'PK');
    const entries = execFileSync('unzip', ['-Z1', path], { encoding: 'utf8' }).trim().split('\n');
    const members = entries.filter(name => name.endsWith('.json')); assert.equal(members.length, 4);
    for (const member of members) assert.equal(typeof JSON.parse(execFileSync('unzip', ['-p', path, member], { encoding: 'utf8' })), 'object');
    return { file: filename, members, detail: 'The current export action is File → Exports → Download .qs. ZIP member JSON parses; this validates the container, not semantic parity.' };
  });
  await j.step('reload-imported-analysis', page, async () => {
    await page.reload(); await page.locator('.app-shell').waitFor(); await navigate(page, 'analyses');
    await button(page, `Open ${title}`).waitFor();
    await button(page, `Open ${title}`).click();
    assert.equal(await page.getByLabel('Analysis title', { exact: true }).inputValue(), title);
    await button(page, 'View import report').click(); await page.locator('.import-report').waitFor();
  });
});
