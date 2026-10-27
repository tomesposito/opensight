import { execFileSync } from 'node:child_process';
import { readFile, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assert, button, launchBrowser, navigate, output, repo, runJourney, startLocalStack, temporaryRoot } from './harness.mjs';

await runJourney('j5-migration', 'Admin + Author', async j => {
  const root = await temporaryRoot(); j.cleanup(() => rm(root, { recursive: true, force: true }));
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
      const actual = await page.locator('.author-card').allTextContents();
      assert.match(actual.join('\n'), /unresolved|unavailable|No data|Unable to load|not found|not supported/i);
      j.gap('imported-live-visual', 'The imported asset renders at least one populated visual.', { reason: 'This sanitized bundle contains definitions only, referring to an unconfigured Athena dataset; no source rows are included.', actual });
    }
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
