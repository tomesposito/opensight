import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assert, button, launchBrowser, navigate, repo, runJourney, startLocalStack, temporaryRoot } from './harness.mjs';

await runJourney('j6-self-host', 'Self-Hoster', async j => {
  const root = await temporaryRoot(); j.cleanup(() => rm(root, { recursive: true, force: true }));
  const stack = await startLocalStack(root); j.cleanup(stack.stop);
  const browser = await launchBrowser(j); let page = await browser.page(stack), datasetId;
  await j.step('empty-home', page, async () => {
    await page.goto(stack.origin); await page.getByRole('complementary', { name: 'Local data workspace' }).waitFor();
    await page.getByText('Add your data to build your first analysis.', { exact: true }).waitFor();
    assert.equal(await page.locator('.chart svg').count(), 0);
    assert.doesNotMatch(await page.locator('.workspace-banner').innerText(), /Sample sales data loaded/);
    const sample = button(page, 'Try sample data'); await sample.waitFor();
    assert.equal(await sample.isEnabled(), true);
    return '“Try sample data” is an explicit opt-in button. It is left untouched; this API starts with an empty data root.';
  });
  await j.step('empty-analyses', page, async () => {
    await navigate(page, 'analyses'); await page.getByText('Create your first analysis and find it here.', { exact: true }).waitFor();
    assert.equal(await page.locator('.draft-name-link').count(), 0);
    assert.equal(await page.locator('.chart').count(), 0);
  });
  await j.step('empty-data', page, async () => {
    await navigate(page, 'data-sources');
    await page.getByText('No data sources yet. Upload a file or configure a data source to get started.', { exact: true }).waitFor();
    await page.getByRole('tab', { name: 'Datasets', exact: true }).click(); await page.getByText('No datasets yet', { exact: true }).waitFor();
    const result = await page.evaluate(async () => { const response = await fetch('/api/api/prep-sources'); return { status: response.status, body: await response.json() }; });
    assert.equal(result.status, 200); assert.deepEqual(result.body, []);
    return 'Home, saved analyses, datasets and source catalog are empty; no sample dataset was preloaded.';
  });
  await j.step('create-durable-dataset', page, async () => {
    await button(page, 'Create dataset').first().click(); await button(page, 'Upload file').click();
    await page.getByLabel('File', { exact: true }).setInputFiles(resolve(repo, 'fixtures/renderable-sales/sales.csv'));
    await button(page, 'Upload to staging').click();
    await page.getByRole('tab', { name: 'Preview', exact: true }).click(); await page.getByText(/8 rows shown/).waitFor();
    await page.getByLabel('Dataset name', { exact: true }).fill('Durable sales'); await button(page, 'Save pipeline').click();
    await page.getByRole('heading', { name: 'Durable sales', exact: true }).waitFor();
    datasetId = new URL(page.url()).hash.split('/').at(-1); assert.match(datasetId, /^prepared-/);
  });
  await page.context().close();
  await Promise.allSettled([...j.pending]);
  const previousApi = stack.api, previousVite = stack.vite;
  await stack.stop(); assert.equal(previousApi.listening, false); assert.equal(previousVite.httpServer.listening, false);
  await stack.start(); assert.notEqual(stack.api, previousApi); assert.notEqual(stack.vite, previousVite);
  page = await browser.page(stack);
  await j.step('restart-durability', page, async () => {
    await page.goto(stack.origin); await page.locator('.app-shell').waitFor();
    await navigate(page, 'data-sources'); await page.getByRole('tab', { name: 'Datasets', exact: true }).click();
    await button(page, 'Durable sales').click(); await page.getByRole('heading', { name: 'Durable sales', exact: true }).waitFor();
    assert.equal(new URL(page.url()).hash.split('/').at(-1), datasetId);
    assert.equal(await button(page, 'Generate analysis').isEnabled(), true);
    const response = await page.evaluate(async id => {
      const r = await fetch(`/api/api/datasets/${encodeURIComponent(id)}/rows`); return { status: r.status, body: await r.json() };
    }, datasetId);
    assert.equal(response.status, 200); assert.equal(response.body.rows.length, 8);
    assert.equal(response.body.rows.reduce((sum, row) => sum + Number(row.revenue), 0), 900);
    await button(page, 'Edit dataset').click(); await page.getByRole('tab', { name: 'Preview', exact: true }).click();
    await page.getByText(/8 rows shown/).waitFor(); assert.equal(await page.locator('.prep-table-scroll tbody tr').count(), 8);
    return 'Both API and Vite were stopped and recreated against the same root. A new browser context still sees the saved dataset, all 8 rows, and total revenue 900.';
  });
  await j.step('no-phone-home', null, () => {
    assert.deepEqual(j.external, []); assert.deepEqual(j.pageerrors, []);
    assert.equal(j.requests.some(r => r.path.endsWith('/sales/query')), false);
    return 'Every browser HTTP/WebSocket request stayed on the synthetic origin and was served by this local stack. No sample sales query ran.';
  });
});
