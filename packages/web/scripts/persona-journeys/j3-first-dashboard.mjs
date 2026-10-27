import { cp, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assert, button, launchBrowser, navigate, repo, runJourney, startLocalStack, temporaryRoot } from './harness.mjs';

await runJourney('j3-first-dashboard', 'Author', async j => {
  const root = await temporaryRoot(); j.cleanup(() => rm(root, { recursive: true, force: true }));
  await cp(resolve(repo, 'fixtures/renderable-sales'), resolve(root, 'renderable-sales'), { recursive: true });
  const csv = resolve(root, 'renderable-sales/sales.csv');
  const [header, ...lines] = (await readFile(csv, 'utf8')).trim().split(/\r?\n/).map(line => line.split(','));
  assert.ok(header.includes('revenue') && header.includes('region'));
  const expected = lines.reduce((sum, row) => sum + Number(row[header.indexOf('revenue')]), 0);
  const stack = await startLocalStack(root); j.cleanup(stack.stop);
  const browser = await launchBrowser(j), page = await browser.page(stack);
  await j.step('fresh-workspace', page, async () => {
    await page.goto(stack.origin); await page.getByRole('complementary', { name: 'Local data workspace' }).waitFor();
    await page.getByText('Add your data to build your first analysis.', { exact: true }).waitFor();
    assert.equal(await page.locator('.chart svg').count(), 0);
    await navigate(page, 'analyses'); await page.getByText('Create your first analysis and find it here.', { exact: true }).waitFor();
    assert.equal(await page.locator('.draft-name-link').count(), 0);
  });
  await j.step('upload-sales', page, async () => {
    await navigate(page, 'data-sources');
    await page.getByRole('tab', { name: 'Datasets', exact: true }).click();
    await page.getByText('No datasets yet', { exact: true }).waitFor();
    await button(page, 'Create dataset').first().click(); await button(page, 'Upload file').click();
    await page.getByLabel('File', { exact: true }).setInputFiles(csv);
    await button(page, 'Upload to staging').click();
    await page.getByRole('tab', { name: 'Preview', exact: true }).click();
    await page.getByText(/8 rows shown/).waitFor();
    assert.equal(await page.locator('.prep-table-scroll tbody tr').count(), 8);
    return 'The current Upload file dialog opens preparation immediately after upload, rather than showing the old staging confirmation.';
  });
  await j.step('calculated-field', page, async () => {
    await page.getByText(/8 rows shown/).waitFor();
    await page.getByLabel('Dataset name', { exact: true }).fill('Journey sales');
    await page.getByRole('button', { name: /Add calculated columns/ }).click();
    await page.getByLabel('Column name', { exact: true }).fill('checked_revenue');
    await page.getByLabel('Expression', { exact: true }).fill('{revenue} * 1');
    await button(page, 'Apply step').click();
    await page.getByRole('tab', { name: 'Preview', exact: true }).click();
    await page.getByRole('columnheader', { name: /checked_revenue/ }).waitFor();
    return `Actual CSV columns: ${header.join(', ')}. Revenue already exists, so checked_revenue = {revenue} * 1; source sum = ${expected}.`;
  });
  await j.step('save-dataset', page, async () => {
    await button(page, 'Save pipeline').click();
    await page.getByRole('heading', { name: 'Journey sales', exact: true }).waitFor();
    await page.getByRole('cell', { name: 'checked_revenue', exact: true }).waitFor();
    return 'Current UI opens dataset details after Save pipeline; Generate analysis replaces the older Build a chart flow.';
  });
  const checkTotal = async () => {
    const card = page.locator('.author-card'); await card.locator('.chart svg').waitFor();
    assert.ok(await card.locator('.chart svg path[d]').count(), 'The SVG contains drawable paths');
    const summary = card.locator('summary').filter({ hasText: 'View data' });
    if (await summary.locator('..').getAttribute('open') === null) await summary.click();
    await page.waitForFunction(() => document.querySelectorAll('.author-card tbody tr').length === 2);
    const rows = await card.locator('tbody tr').evaluateAll(rows => rows.map(r => [...r.cells].map(c => c.textContent)));
    assert.deepEqual(rows, [['East', '500'], ['West', '400']]);
    assert.equal(rows.reduce((sum, row) => sum + Number(row[1]), 0), expected);
    assert.ok(j.requests.some(r => r.path.includes('/prepared-') && r.path.endsWith('/query') && r.status === 200 && r.body.rows.reduce((sum, row) => sum + Number(row.checked_revenue ?? 0), 0) === expected));
    return `Rendered total ${expected} equals the CSV sum, including blank revenue cells and zero values.`;
  };
  await j.step('bar-analysis-total', page, async () => {
    await button(page, 'Generate analysis').click(); await button(page, 'Assign checked_revenue').waitFor();
    await page.getByLabel('Analysis title', { exact: true }).fill('Revenue by region');
    await page.locator('.add-visual').getByRole('button', { name: 'Add visual', exact: true }).click();
    await button(page, 'Assign region').click(); await button(page, 'Assign checked_revenue').click();
    assert.equal(await page.locator('.change-type select').inputValue(), 'bar');
    return checkTotal();
  });
  await j.step('publication-state', page, async () => {
    await button(page, 'Save draft').click(); await page.getByText('Draft saved on this device.', { exact: true }).waitFor();
    await button(page, 'PUBLISH').click();
    const actual = await page.locator('.toolbar-notice').innerText(); assert.match(actual, /no publication destination/); assert.match(actual, /Nothing has been published/);
    j.gap('save-dashboard', 'Publish and persist a dashboard for Readers.', actual);
  });
  await j.step('reload-draft-total', page, async () => {
    await page.reload(); await page.locator('.app-shell').waitFor(); await navigate(page, 'analyses');
    await button(page, 'Open Revenue by region').click();
    return `${await checkTotal()} This is a persistent analysis draft; dashboard publication remains the recorded gap.`;
  });
});
