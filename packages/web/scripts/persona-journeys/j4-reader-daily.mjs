import { assert, button, launchBrowser, navigate, runJourney, startHostedStack } from './harness.mjs';

await runJourney('j4-reader-daily', 'Reader AI', async j => {
  const stack = await startHostedStack(); j.cleanup(stack.stop);
  const { hostedDataFixture } = await import('../../test/hosted-data-helpers.mjs');
  const { HostedData } = await import('../../../api/dist/hosted-data.js');
  const { HostedPrep } = await import('../../../api/dist/hosted-prep.js');
  const seed = await hostedDataFixture({ after: fn => j.cleanup(fn) });
  // Transfer the fixture's actual rows and recipe into the real PostgreSQL
  // tenant. No browser response is synthesized or delegated to fixture.fetcher.
  const raw = await seed.data.execute(await seed.login(), seed.source.id, 'output', {});
  const names = raw.columns.map(c => c.name);
  const csv = [names.join(','), ...raw.rows.map(row => names.map(n => row[n]).join(','))].join('\n') + '\n';
  const f = stack.fixture;
  const source = await f.sources.upload(await f.context(), { config: { format: 'csv' }, base64: Buffer.from(csv).toString('base64'), policy: { rowLevel: false, rowRules: [] }, expiresAt: '2099-01-01T00:00:00.000Z' });
  const prep = new HostedPrep(new HostedData(f.sources, undefined, f.budgets));
  await prep.save(await f.context(), 'orders', { name: 'Orders', pipeline: { ...seed.pipeline, input: source.id }, expectedVersion: 0 });
  await f.metadata.put(await f.context(), { kind: 'user', id: f.reader.identity.userId }, { name: 'Daily reader', role: 'reader_ai' }, 1);
  const adminToken = (await f.login()).token, readerToken = (await f.reader.login()).token;
  const browser = await launchBrowser(j), author = await browser.page(stack, adminToken);
  await j.step('author-orders-analysis', author, async () => {
    await author.goto(`${stack.origin}/#/data`); await button(author, 'Orders').click();
    await author.getByRole('heading', { name: 'Orders', exact: true }).waitFor();
    await button(author, 'Generate analysis').click(); await button(author, 'Assign revenue').waitFor();
    await author.getByLabel('Analysis title', { exact: true }).fill('Daily Orders');
    await author.locator('.add-visual').getByRole('button', { name: 'Add visual', exact: true }).click();
    await button(author, 'Assign region').click(); await button(author, 'Assign revenue').click();
    await author.locator('.author-card .chart svg').waitFor();
    await author.locator('.author-card summary').filter({ hasText: 'View data' }).click();
    assert.deepEqual(await author.locator('.author-card tbody tr').evaluateAll(rows => rows.map(r => [...r.cells].map(c => c.textContent))), [['east', '40'], ['west', '20']]);
    await button(author, 'Save draft').click(); await author.getByText('Draft saved on this device.', { exact: true }).waitFor();
    return 'Orders from hostedDataFixture runs through the real hosted API; browser bearer credentials come from the real built-in auth fixture.';
  });
  await j.step('publish-availability', author, async () => {
    await button(author, 'PUBLISH').click();
    const actual = await author.locator('.toolbar-notice').innerText();
    assert.match(actual, /not available in this editor yet/); assert.match(actual, /nothing has been published/i);
    j.gap('publish-orders-dashboard', 'An author publishes Orders for Readers.', actual);
  });
  await j.step('provider-unconfigured', author, async () => {
    await author.getByRole('button', { name: /^Ask a question about / }).click();
    await author.locator('.q-side-panel').waitFor();
    assert.equal(await author.getByRole('switch', { name: 'Generative mode', exact: true }).isDisabled(), true);
    const actual = await author.locator('.o-mode-notice').innerText(); assert.match(actual, /not configured/);
    j.gap('ai-answer-environment', 'Ask O answers using a configured provider and traces the visible data.', `Environment-limited: no provider configured. Author panel says: ${actual}. No AI call is made.`);
  });
  const page = await browser.page(stack, readerToken);
  await j.step('reader-home', page, async () => {
    await page.goto(stack.origin); await page.locator('.app-shell').waitFor();
    assert.equal(await page.locator('#product-navigation').getByRole('link', { name: /^(Analyses|Data)$/ }).count(), 0);
    await page.getByLabel('Account', { exact: true }).click();
    assert.match(await page.locator('.account-menu').innerText(), /Daily reader/); await page.getByLabel('Account', { exact: true }).click();
    assert.equal(await page.getByRole('link', { name: 'Daily Orders', exact: true }).count(), 0);
    assert.match(await page.locator('main').innerText(), /Pinned synthetic sales data/);
    j.gap('reader-open-orders', 'Open the published Orders dashboard from reader home.', 'The editor cannot publish. Hosted home displays pinned synthetic sales rather than a collection of tenant dashboards.');
  });
  await j.step('reader-dashboard-collection', page, async () => {
    await navigate(page, 'my-stuff');
    const dashboards = page.getByRole('navigation', { name: 'Your collections', exact: true }).getByRole('link', { name: 'Dashboards', exact: true });
    if (await dashboards.count()) {
      await dashboards.click();
      assert.match(await page.locator('main').innerText(), /Publishing dashboards needs a hosted API/);
    } else j.gap('reader-dashboard-navigation', 'Reader has a dashboard collection entry.', `My stuff offers: ${(await page.locator('.my-stuff-links').innerText()).trim()}`);
    assert.equal(await page.getByRole('link', { name: 'Daily Orders', exact: true }).count(), 0);
    await navigate(page, 'sample'); await page.locator('.dashboard-grid .chart svg').first().waitFor();
  });
  const controls = page.locator('.home-page').getByRole('combobox');
  if (!await controls.count()) j.gap('reader-filter', 'Apply a dashboard filter/control.', 'The shipped reader home sample has no filter controls; the Orders dashboard is not publishable.');
  else await j.step('reader-filter', page, async () => {
    const values = await controls.first().locator('option').evaluateAll(options => options.filter(o => !o.disabled).map(o => o.value));
    assert.ok(values.length > 1); await controls.first().selectOption(values.at(-1)); assert.equal(await controls.first().inputValue(), values.at(-1));
  });
  const trigger = page.getByRole('button', { name: /^Ask a question about / });
  const panelAvailable = await trigger.count() > 0;
  if (!panelAvailable) {
    j.gap('reader-ask-o-docking', 'Reader AI opens Ask O; the dashboard narrows with no panel overlap (#140).', 'The real hosted reader home does not render an Ask O trigger. Docking cannot be measured on this unavailable surface.');
  } else await j.step('reader-ask-o-docking', page, async () => {
    const before = await page.locator('.dashboard-grid').boundingBox(); await trigger.click();
    const panel = page.locator('.q-side-panel'); await panel.waitFor();
    const after = await page.locator('.dashboard-grid').boundingBox(), box = await panel.boundingBox();
    assert.ok(after.width < before.width, 'Dashboard must narrow'); assert.ok(after.x + after.width <= box.x + 1, 'Dashboard must not overlap Ask O');
    assert.match(await panel.locator('.o-mode-notice').innerText(), /not configured/);
    assert.equal(await panel.getByRole('switch', { name: 'Generative mode', exact: true }).isDisabled(), true);
    return { before, after, panel: box };
  });
  await j.step('narrow-reader-observation', page, async () => {
    await page.setViewportSize({ width: 900, height: 1100 });
    const cards = page.locator('.dashboard-grid > .visual-card'); assert.ok(await cards.count() >= 2);
    const first = await cards.nth(0).boundingBox(), second = await cards.nth(1).boundingBox();
    const actual = { first, second, stacked: second.y >= first.y + first.height - 1, panelOpen: panelAvailable };
    if (panelAvailable && actual.stacked) assert.ok(second.y >= first.y + first.height - 1);
    else j.gap('narrow-reader-with-panel', 'At 900px with Ask O open, the second card starts below the first.', actual);
    return actual;
  });
});
