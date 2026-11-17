import { cp, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assert, button, launchBrowser, navigate, repo, runJourney, startHostedStack, startLocalStack, temporaryRoot } from './harness.mjs';

// Browser fetches use the same bridge as the UI: one /api prefix is removed.
async function api(page, path, method = 'GET', body, status = 200) {
  const response = await page.evaluate(async ({ path, method, body }) => {
    const result = await fetch(`/api${path}`, { method, headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: result.status, body: await result.json() };
  }, { path, method, body });
  assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(response.body)}`);
  return response.body;
}
const notebookPath = n => `/api/notebooks/${n.id}`;
const bytes = data => Buffer.byteLength(JSON.stringify(data));
const regionSql = source => `SELECT region, SUM(revenue) AS total FROM ${source} GROUP BY region ORDER BY region`;
const rawSql = id => `SELECT region, revenue FROM "${id}" ORDER BY region, revenue`;
async function save(page) {
  await button(page, 'Save notebook').click();
  await page.locator('.notebook-toolbar [role="status"]').filter({ hasText: /^Saved version / }).waitFor();
}
async function createNotebook(page, name, markdown, sql, refs) {
  await page.getByLabel('Notebook name', { exact: true }).fill(name);
  await button(page, 'Create notebook').click();
  await button(page, 'Add markdown cell').click();
  await page.getByLabel('Markdown', { exact: true }).fill(markdown);
  await button(page, 'Add SQL cell').click();
  await page.getByLabel('SQL', { exact: true }).fill(sql);
  for (const ref of refs) await page.getByRole('group', { name: 'Declared datasets', exact: true }).getByRole('checkbox', { name: new RegExp(`^${ref}`) }).check();
  assert.equal(await button(page, 'Run all').isDisabled(), true, 'Unsaved cells cannot run');
  await save(page);
  const id = new URL(page.url()).hash.split('/').at(-1);
  return api(page, `/api/notebooks/${id}`);
}
async function run(page, n, label = 'Run all') {
  const response = page.waitForResponse(r => new URL(r.url()).pathname === `/api${notebookPath(n)}/run` && r.request().method() === 'POST');
  await button(page, label).click();
  const result = await response;
  assert.equal(result.status(), 200);
  const body = await result.json();
  // The UI fetches history after the run response, before clearing busy.
  await page.locator('.notebook-toolbar [role="status"]').filter({ hasText: /^Saved version / }).waitFor();
  return body;
}
async function totals(page, expected) {
  const result = page.locator('.notebook-result');
  await result.getByText('2 rows', { exact: true }).waitFor();
  const rows = await result.locator('tbody tr').evaluateAll(rows => rows.map(r => [...r.cells].map(c => c.textContent)));
  assert.deepEqual(rows, expected);
  return rows.reduce((sum, row) => sum + Number(row[1]), 0);
}
async function upload(page, stack, csv) {
  await page.goto(stack.origin);
  await page.getByRole('complementary', { name: 'Local data workspace' }).waitFor();
  await navigate(page, 'data-sources');
  await page.getByRole('tab', { name: 'Datasets', exact: true }).click();
  await button(page, 'Create dataset').first().click(); await button(page, 'Upload file').click();
  await page.getByLabel('File', { exact: true }).setInputFiles(csv);
  await button(page, 'Upload to staging').click();
  await page.getByRole('tab', { name: 'Preview', exact: true }).click();
  await page.getByText(/8 rows shown/).waitFor();
  assert.equal(await page.locator('.prep-table-scroll tbody tr').count(), 8);
  await page.getByLabel('Dataset name', { exact: true }).fill('Notebook journey sales');
  await button(page, 'Save pipeline').click();
  await page.getByRole('heading', { name: 'Notebook journey sales', exact: true }).waitFor();
  const { datasets } = await api(page, '/api/prep-datasets');
  const saved = datasets.filter(d => d.name === 'Notebook journey sales'); assert.equal(saved.length, 1);
  const id = `prepared-${saved[0].dataSetId}`;
  assert.ok((await api(page, '/api/notebooks/datasets')).datasets.some(d => d.id === id));
  return id;
}

await runJourney('j11-notebooks', 'Author', async j => {
  const root = await temporaryRoot(); j.cleanup(() => rm(root, { recursive: true, force: true }));
  await cp(resolve(repo, 'fixtures/renderable-sales'), resolve(root, 'renderable-sales'), { recursive: true });
  const csv = resolve(root, 'renderable-sales/sales.csv');
  const [header, ...lines] = (await readFile(csv, 'utf8')).trim().split(/\r?\n/).map(line => line.split(','));
  assert.ok(header.includes('revenue') && header.includes('region'));
  const expected = lines.reduce((sum, row) => sum + Number(row[header.indexOf('revenue')]), 0);
  assert.equal(expected, 900);
  const stack = await startLocalStack(root); j.cleanup(stack.stop);
  const browser = await launchBrowser(j), page = await browser.page(stack);
  let dataset, adjustments, notebook, single, smallBytes, largeBytes;
  const name = 'Regional revenue app', narrative = 'Finished regional revenue', scratchName = 'Scratch notebook', scratchText = 'Private scratch calibration notes';
  await j.step('local-governed-datasets', page, async () => {
    dataset = await upload(page, stack, csv);
    adjustments = await api(page, '/api/input-tables', 'POST', { name: 'Revenue adjustments',
      columns: [{ name: 'region', type: 'text', required: true }, { name: 'revenue', type: 'number', required: true }] }, 201);
    assert.deepEqual(adjustments.rows, []);
    return `Uploaded all ${lines.length} CSV rows through preparation and saved ${dataset}. A real, initially empty input table supplies later revenue adjustments; source total is ${expected}.`;
  });
  await j.step('undeclared-dataset-denied', page, async () => {
    await page.goto(`${stack.origin}/#/notebooks`);
    const adjustmentRef = `input-table-${adjustments.id}`;
    const sql = regionSql(`(SELECT region, revenue FROM "${dataset}" UNION ALL SELECT region, revenue FROM "${adjustmentRef}") AS sales`);
    // Explicit D-91 bypass attempt: an accessible table is still forbidden
    // unless declared. Restore the declaration through the real picker below.
    notebook = await createNotebook(page, name, `# ${narrative}\n\nSource CSV plus recorded revenue adjustments.`, sql, [adjustmentRef]);
    const denied = await run(page, notebook, 'Run cell 2');
    assert.equal(denied.results.length, 1);
    assert.equal(denied.results[0].error.code, 'NOTEBOOK_SQL_UNDECLARED_TABLE');
    assert.equal(denied.results[0].data, undefined);
    await page.getByRole('alert').filter({ hasText: 'NOTEBOOK_SQL_UNDECLARED_TABLE' }).waitFor();
    assert.equal(await page.locator('.notebook-result table').count(), 0);
    return 'Referencing the uploaded prepared dataset without declaring it returns NOTEBOOK_SQL_UNDECLARED_TABLE in the SQL cell, with no result table.';
  });
  await j.step('cell-by-cell-source-total', page, async () => {
    await page.getByRole('group', { name: 'Declared datasets', exact: true }).getByRole('checkbox', { name: new RegExp(`^${dataset}`) }).check();
    await save(page);
    notebook = await api(page, notebookPath(notebook));
    single = await run(page, notebook, 'Run cell 2');
    assert.deepEqual(single.results.map(r => r.cellId), [notebook.cells[1].id], 'Only the selected SQL cell ran');
    assert.equal(single.results[0].error, undefined);
    assert.deepEqual(single.results[0].datasetRefs, [`input-table-${adjustments.id}`, dataset]);
    assert.equal(await totals(page, [['East', '500'], ['West', '400']]), expected);
    assert.equal(single.executedBy, notebook.ownerId);
    assert.ok(Number.isFinite(Date.parse(single.results[0].executedAt)));
    await page.getByText(`Executed as ${single.executedBy} · ${single.results[0].executedAt} · ${single.results[0].elapsedMs} ms`, { exact: true }).waitFor();
    smallBytes = bytes(single.results[0].data);
    return `Only SQL cell 2 executed, under the local owner ${single.executedBy}; its identity and execution time are rendered. East 500 + West 400 = CSV sum ${expected}. The result data occupies ${smallBytes} JSON bytes.`;
  });
  await j.step('publish-and-separate-scratch', page, async () => {
    await page.getByLabel('Publish as an app for this namespace', { exact: true }).check();
    await save(page); await button(page, 'All notebooks').click();
    await page.getByRole('row').filter({ has: button(page, name) }).getByText('Published app', { exact: true }).waitFor();
    const scratch = await createNotebook(page, scratchName, scratchText, rawSql(dataset), [dataset]);
    const calibration = await run(page, scratch, 'Run cell 2');
    assert.equal(calibration.results[0].error, undefined);
    assert.equal(calibration.results[0].data.rowCount, lines.length);
    largeBytes = bytes(calibration.results[0].data);
    assert.ok(largeBytes > smallBytes, 'The raw rows must exceed the grouped result bytes');
    await button(page, 'All notebooks').click();
    await page.getByRole('row').filter({ has: button(page, scratchName) }).getByText('Draft', { exact: true }).waitFor();
    await page.getByRole('row').filter({ has: button(page, name) }).getByText('Published app', { exact: true }).waitFor();
    return `The published app and separate scratch draft have distinct list statuses. The scratch SQL reads all ${lines.length} uploaded rows to calibrate the larger result (${largeBytes} bytes).`;
  });
  let publishedRun;
  await j.step('published-run-view', page, async () => {
    await button(page, name).click(); await button(page, 'Edit notebook').waitFor();
    assert.equal(await page.getByLabel('SQL', { exact: true }).count(), 0);
    assert.equal(await button(page, 'Save notebook').count(), 0);
    await page.getByRole('heading', { name: narrative, exact: true }).waitFor();
    assert.equal(await page.getByRole('region', { name: 'sql cell 2', exact: true }).count(), 1);
    assert.ok(!(await page.locator('.notebooks-page').innerText()).includes(scratchText));
    assert.ok(!(await page.locator('.notebooks-page').innerText()).includes(scratchName));
    publishedRun = await run(page, notebook);
    assert.deepEqual(publishedRun.results.map(r => r.kind), ['markdown', 'sql']);
    assert.ok(publishedRun.results.every(r => !r.error));
    assert.equal(publishedRun.executedBy, notebook.ownerId);
    assert.equal(await totals(page, [['East', '500'], ['West', '400']]), expected);
    return 'Reopening the published app selects run view: finished markdown/cells, no SQL editor or Save notebook, and no scratch content. Run all returns 900. This is the reader-facing surface under the same local owner, not a distinct Reader identity.';
  });
  await j.step('data-change-keeps-original-timestamp', page, async () => {
    const oldResult = publishedRun.results[1];
    const identityLine = `Executed as ${publishedRun.executedBy} · ${oldResult.executedAt} · ${oldResult.elapsedMs} ms`;
    await page.getByText(identityLine, { exact: true }).waitFor();
    const before = (await api(page, `${notebookPath(notebook)}/runs`)).runs;
    await api(page, `/api/input-tables/${adjustments.id}/rows`, 'POST', { values: { region: 'East', revenue: 100 } }, 201);
    const changed = await api(page, `/api/input-tables/${adjustments.id}`);
    assert.deepEqual(changed.rows.map(r => r.values), [{ region: 'East', revenue: 100 }]);
    assert.equal(await totals(page, [['East', '500'], ['West', '400']]), expected);
    assert.equal(await page.getByText(identityLine, { exact: true }).isVisible(), true);
    const after = (await api(page, `${notebookPath(notebook)}/runs`)).runs;
    assert.deepEqual(after, before, 'Data mutation must not silently rewrite or execute retained results');
    return `Added East revenue 100 through the real input-table API. The displayed total remains ${expected}, labelled with its original execution time ${oldResult.executedAt}; retained history is unchanged. No automatic invalidation banner is claimed.`;
  });
  await j.step('rerun-fresh-total-and-history', page, async () => {
    const before = (await api(page, `${notebookPath(notebook)}/runs`)).runs;
    const fresh = await run(page, notebook);
    assert.ok(fresh.results.every(r => !r.error));
    assert.equal(await totals(page, [['East', '600'], ['West', '400']]), expected + 100);
    assert.ok(Date.parse(fresh.results[1].executedAt) > Date.parse(publishedRun.results[1].executedAt));
    await page.getByText(`Executed as ${fresh.executedBy} · ${fresh.results[1].executedAt} · ${fresh.results[1].elapsedMs} ms`, { exact: true }).waitFor();
    const history = (await api(page, `${notebookPath(notebook)}/runs`)).runs;
    assert.deepEqual(history.map(r => r.id), [fresh.id, ...before.map(r => r.id)]);
    assert.ok(history.every((r, i) => i === 0 || Date.parse(history[i - 1].executedAt) >= Date.parse(r.executedAt)));
    const summary = page.locator('.notebook-history summary');
    assert.equal(await summary.innerText(), `Run history (${before.length + 1})`);
    await summary.click();
    assert.deepEqual(await page.locator('.notebook-history li').allTextContents(), history.map(r => `${r.executedAt} · Executed as ${r.executedBy} · Version ${r.notebookVersion}`));
    return `Explicit re-run returns East 600 / West 400 (total ${expected + 100}) with a newer execution time. History grew from ${before.length} to ${history.length}; both API run IDs and rendered history are newest-first.`;
  });

  // Budgets are read at server construction. One second local stack exercises
  // a large refused cell and repeated smaller results under the same limits.
  const limits = { OPENSIGHT_NOTEBOOK_RUN_BYTES: smallBytes, OPENSIGHT_NOTEBOOK_NOTEBOOK_BYTES: smallBytes + Math.floor(smallBytes / 2), OPENSIGHT_NOTEBOOK_STORE_BYTES: 4 * smallBytes };
  assert.ok(limits.OPENSIGHT_NOTEBOOK_RUN_BYTES < largeBytes);
  const budgetRoot = await temporaryRoot(); j.cleanup(() => rm(budgetRoot, { recursive: true, force: true }));
  const savedEnv = Object.fromEntries(Object.keys(limits).map(key => [key, process.env[key]]));
  let budgetStack;
  try {
    for (const [key, value] of Object.entries(limits)) process.env[key] = String(value);
    budgetStack = await startLocalStack(budgetRoot);
  } finally {
    for (const [key, value] of Object.entries(savedEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
  j.cleanup(budgetStack.stop);
  // This browser must close before the newer stack stops during LIFO cleanup.
  const budgetBrowser = await launchBrowser(j), budgetPage = await budgetBrowser.page(budgetStack);
  let budgetDataset;
  const calibrationDetail = `Measured grouped result = ${smallBytes} bytes, raw result = ${largeBytes} bytes; run/notebook/store budgets = ${limits.OPENSIGHT_NOTEBOOK_RUN_BYTES}/${limits.OPENSIGHT_NOTEBOOK_NOTEBOOK_BYTES}/${limits.OPENSIGHT_NOTEBOOK_STORE_BYTES} bytes. Environment restored immediately after stack construction.`;
  await j.step('byte-budget-visible-refusal', budgetPage, async () => {
    budgetDataset = await upload(budgetPage, budgetStack, csv);
    await budgetPage.goto(`${budgetStack.origin}/#/notebooks`);
    const oversized = await createNotebook(budgetPage, 'Oversized result', 'Raw result budget check', rawSql(budgetDataset), [budgetDataset]);
    const refused = await run(budgetPage, oversized, 'Run cell 2');
    assert.equal(refused.results.length, 1);
    assert.equal(refused.results[0].error.code, 'NOTEBOOK_RESULT_BUDGET_EXCEEDED');
    assert.equal(refused.results[0].data, undefined);
    await budgetPage.getByRole('alert').filter({ hasText: 'NOTEBOOK_RESULT_BUDGET_EXCEEDED' }).waitFor();
    assert.equal(await budgetPage.locator('.notebook-result table').count(), 0);
    const history = (await api(budgetPage, `${notebookPath(oversized)}/runs`)).runs;
    assert.equal(history.length, 1);
    assert.equal(history[0].results[0].data, undefined);
    assert.equal(history[0].results[0].error.code, 'NOTEBOOK_RESULT_BUDGET_EXCEEDED');
    return `${calibrationDetail} The raw SQL cell visibly refuses retention with NOTEBOOK_RESULT_BUDGET_EXCEEDED; neither response nor retained history contains result data, and no result table renders.`;
  });
  await j.step('byte-budget-oldest-run-evicted', budgetPage, async () => {
    await button(budgetPage, 'All notebooks').click();
    const bounded = await createNotebook(budgetPage, 'Bounded history', 'Grouped result eviction check', regionSql(`"${budgetDataset}"`), [budgetDataset]);
    const first = await run(budgetPage, bounded);
    assert.ok(first.results.every(r => !r.error));
    assert.equal(bytes(first.results[1].data), smallBytes);
    assert.equal(await totals(budgetPage, [['East', '500'], ['West', '400']]), expected);
    assert.deepEqual((await api(budgetPage, `${notebookPath(bounded)}/runs`)).runs.map(r => r.id), [first.id]);
    const second = await run(budgetPage, bounded);
    assert.notEqual(second.id, first.id);
    assert.ok(second.results.every(r => !r.error));
    assert.equal(bytes(second.results[1].data), smallBytes);
    assert.equal(await totals(budgetPage, [['East', '500'], ['West', '400']]), expected);
    const history = (await api(budgetPage, `${notebookPath(bounded)}/runs`)).runs;
    assert.deepEqual(history.map(r => r.id), [second.id], 'Oldest run must be evicted, not the new one');
    const retained = history.reduce((sum, r) => sum + r.results.reduce((n, c) => n + (c.data ? bytes(c.data) : 0), 0), 0);
    assert.equal(retained, smallBytes);
    assert.ok(retained <= limits.OPENSIGHT_NOTEBOOK_NOTEBOOK_BYTES && 2 * retained > limits.OPENSIGHT_NOTEBOOK_NOTEBOOK_BYTES);
    assert.equal(await budgetPage.locator('.notebook-history summary').innerText(), 'Run history (1)');
    await budgetPage.locator('.notebook-history summary').click();
    assert.deepEqual(await budgetPage.locator('.notebook-history li').allTextContents(), [`${second.executedAt} · Executed as ${second.executedBy} · Version ${second.notebookVersion}`]);
    return `${calibrationDetail} Two successful runs retain only the newer run (${retained} result bytes); API IDs and the visible Run history (1) prove oldest-run eviction below the 20-run cap.`;
  });

  const hosted = await startHostedStack(); j.cleanup(hosted.stop);
  const hostedBrowser = await launchBrowser(j), hostedPage = await hostedBrowser.page(hosted, hosted.tokens.admin);
  await j.step('hosted-notebook-boundary', hostedPage, async () => {
    await hostedPage.goto(`${hosted.origin}/#/notebooks`);
    const response = await hosted.request('/api/notebooks');
    const notice = hostedPage.getByRole('heading', { name: 'Notebooks are not available on this server', exact: true });
    // This specific product regression is a finding, not the designed hosted
    // unavailability itself. Keep the approved 404 + notice path as a PASS;
    // unexpected responses and unrelated UI failures still fail the journey.
    const regression = response.status === 503 && response.body.errorCode === 'HOSTED_CAPABILITY_UNAVAILABLE';
    if (regression) await hostedPage.getByRole('alert').filter({ hasText: 'HOSTED_CAPABILITY_UNAVAILABLE' }).waitFor();
    else { assert.equal(response.status, 404, JSON.stringify(response.body)); await notice.waitFor(); }
    assert.equal(await hostedPage.getByLabel('Notebook name', { exact: true }).count(), 0);
    assert.equal(await button(hostedPage, 'Create notebook').count(), 0);
    assert.equal(await hostedPage.locator('.notebooks-page form').count(), 0);
    if (regression) {
      assert.equal(await notice.count(), 0);
      const actual = { status: response.status, errorCode: response.body.errorCode,
        alert: await hostedPage.locator('.notebooks-page [role="alert"]').innerText(), unavailableNotice: false, createForm: false };
      j.gap('hosted-unavailable-notice-regression',
        { status: 404, heading: 'Notebooks are not available on this server', alert: false, createForm: false }, actual);
      return 'Confirmed the specific hosted route regression through the direct API and real admin page, with no create form. The expected #281 unavailable notice is recorded as a gap; the 503/error banner is not a passing unavailable state.';
    }
    assert.equal(await hostedPage.locator('.notebooks-page [role="alert"]').count(), 0);
    return 'The real hosted admin page shows the designed unavailable notice with no create form or error banner; GET /api/notebooks returns 404. This v1 boundary is a PASS under the approved #281 clarification.';
  });
});
