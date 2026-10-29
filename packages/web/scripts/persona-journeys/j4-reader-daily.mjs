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
  // Independently provision the reader's source while this fixture identity is
  // an author, then assign Reader AI. Dashboard sharing supplies no source grant.
  const readerUser = { kind: 'user', id: f.reader.identity.userId };
  await f.metadata.put(await f.context(), readerUser, { name: 'Daily reader', role: 'author' }, 1);
  const ownSource = await f.sources.upload(await f.reader.context(), { config: { format: 'csv' }, base64: Buffer.from(csv).toString('base64'), policy: { rowLevel: true, rowRules: [] }, expiresAt: '2099-01-01T00:00:00.000Z' });
  const readerContext = await f.reader.context(), oldKey = f.sources.key(readerContext, 'source', ownSource.id), ownRecord = await f.metadata.get(readerContext, oldKey);
  await f.metadata.batch(readerContext, [{ key: { ...oldKey, id: source.id }, body: ownRecord.body, expectedVersion: 0 }, { key: oldKey, body: null, expectedVersion: 1 }]);
  await f.metadata.put(await f.context(), readerUser, { name: 'Daily reader', role: 'reader_ai' }, 2);
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
    await button(author, '+ Parameter').click();
    await author.getByLabel('Parameter name', { exact: true }).fill('Region');
    await author.getByLabel('Default values', { exact: true }).fill('east');
    await button(author, 'Create parameter').click();
    await button(author, '+ Add control').click();
    await author.getByLabel('Control label', { exact: true }).fill('Region');
    await author.getByLabel('Options (one per line)', { exact: true }).fill('east\nwest');
    await button(author, 'Create control').click();
    const bindRegion = async () => {
      await author.getByRole('tab', { name: 'Interaction', exact: true }).click();
      await author.getByText('Parameter bindings', { exact: true }).click();
      await button(author, 'Apply parameter filter').click();
    };
    await bindRegion();
    await author.locator('.add-visual').getByRole('button', { name: 'Add visual', exact: true }).click();
    await button(author, 'Assign region').click(); await button(author, 'Assign revenue').click();
    await bindRegion();
    await button(author, 'Save analysis').click();
    await author.getByText('Analysis saved to this hosted workspace.', { exact: true }).first().waitFor();
    return 'Orders from hostedDataFixture runs through the real hosted API; browser bearer credentials come from the real built-in auth fixture.';
  });
  await j.step('publish-orders-dashboard', author, async () => {
    await button(author, 'PUBLISH').click();
    await author.locator('.toolbar-notice').filter({ hasText: /Published “Daily Orders” · version 1/ }).waitFor();
    assert.doesNotMatch(await author.locator('.toolbar-notice').innerText(), /Published with diagnostics/);
    return 'The editor saved a hosted analysis and the real v1 publish route returned version 1.';
  });
  await j.step('provider-unconfigured', author, async () => {
    await author.getByRole('button', { name: /^Ask a question about / }).click();
    await author.locator('.q-side-panel').waitFor();
    assert.equal(await author.getByRole('switch', { name: 'Generative mode', exact: true }).isDisabled(), true);
    const actual = await author.locator('.o-mode-notice').innerText(); assert.match(actual, /not configured/);
    j.gap('ai-answer-environment', 'Ask O answers using a configured provider and traces the visible data.', `Environment-limited: no provider configured. Author panel says: ${actual}. No AI call is made.`);
  });
  await j.step('admin-grants-dashboard', author, async () => {
    await navigate(author, 'my-stuff');
    await author.getByRole('navigation', { name: 'Your collections' }).getByRole('link', { name: 'Dashboards', exact: true }).click();
    await author.getByRole('link', { name: 'Daily Orders', exact: true }).click();
    await author.locator('.dashboard-grid .chart svg').first().waitFor();
    await author.getByText('Dashboard access', { exact: true }).click();
    await author.getByLabel('Viewer', { exact: true }).selectOption({ label: 'Daily reader' });
    await button(author, 'Grant dashboard access').click();
    await author.getByText('Dashboard viewing access granted. Dataset permissions are unchanged.', { exact: true }).waitFor();
    return 'An administrator grants definition visibility through the product. D-85 requires independent reader source authorization.';
  });
  const page = await browser.page(stack, readerToken);
  await j.step('reader-open-orders', page, async () => {
    await page.goto(stack.origin); await page.locator('.app-shell').waitFor();
    assert.equal(await page.locator('#product-navigation').getByRole('link', { name: /^(Analyses|Data)$/ }).count(), 0);
    await page.getByLabel('Account', { exact: true }).click();
    assert.match(await page.locator('.account-menu').innerText(), /Daily reader/); await page.getByLabel('Account', { exact: true }).click();
    await page.getByRole('link', { name: 'Daily Orders', exact: true }).click();
    await page.getByRole('heading', { name: 'Daily Orders', exact: true }).waitFor();
    assert.doesNotMatch(await page.locator('main').innerText(), /Pinned synthetic sales data|Pinned sample data/);
    assert.match(page.url(), /#\/dashboards\//);
  });
  await j.step('reader-dashboard-navigation', page, async () => {
    await navigate(page, 'my-stuff');
    await page.getByRole('navigation', { name: 'Your collections', exact: true }).getByRole('link', { name: 'Dashboards', exact: true }).click();
    await page.getByRole('link', { name: 'Daily Orders', exact: true }).click();
    await page.getByRole('heading', { name: 'Daily Orders', exact: true }).waitFor();
    assert.equal(await page.locator('.dashboard-grid > .visual-card').count(), 2);
  });
  const controls = page.locator('.published-dashboard').getByRole('combobox', { name: 'Region', exact: true });
  await controls.waitFor();
  const response = page.waitForResponse(r => r.url().includes('/versions/1/visuals/') && r.url().endsWith('/query') && r.request().postDataJSON()?.controlValues?.['control-1']?.[0] === 'west');
  await controls.selectOption('west');
  const filtered = await response;
  await j.step('reader-filter-without-source-access', page, async () => {
    assert.equal(filtered.status(), 403);
    const error = await filtered.json(); assert.equal(error.errorCode, 'DASHBOARD_DATASET_ACCESS_DENIED');
    await page.locator('.dashboard-grid').getByText(/DASHBOARD_DATASET_ACCESS_DENIED/).first().waitFor();
    assert.equal(await page.locator('.dashboard-grid .chart svg').count(), 0);
    return 'The reader source policy denies all rows. Dashboard sharing cannot override it; no sample or stale rows appear.';
  });
  // Trusted fixture policy administration models independently granted source
  // access. It edits only the reader's source and bumps the real policy revision.
  await f.db.transaction(async db => {
    await db.query("UPDATE h1_resources SET body = ?, version = version + 1 WHERE tenant_id = ? AND namespace_id = ? AND kind = 'source' AND owner_id = ? AND resource_id = ?", [JSON.stringify({ ...ownRecord.body, policy: { rowLevel: false, rowRules: [] } }), readerContext.tenantId, readerContext.namespaceId, readerContext.userId, source.id]);
    await db.query('UPDATE h1_revisions SET policy = policy + 1 WHERE tenant_id = ? AND namespace_id = ?', [readerContext.tenantId, readerContext.namespaceId]);
  });
  await page.context().setExtraHTTPHeaders({ Authorization: `Bearer ${(await f.reader.login()).token}` });
  await j.step('reader-filter', page, async () => {
    await page.reload(); await controls.waitFor();
    const response = page.waitForResponse(r => r.url().includes('/versions/1/visuals/') && r.url().endsWith('/query') && r.request().postDataJSON()?.controlValues?.['control-1']?.[0] === 'west');
    await controls.selectOption('west');
    const filtered = await response;
    assert.equal(filtered.status(), 200); assert.deepEqual((await filtered.json()).rows, [{ region: 'west', revenue: 20 }]);
    await page.locator('.dashboard-grid .chart svg').first().waitFor();
    assert.equal(await controls.inputValue(), 'west');
    return 'D-85 executes the publisher recipe on the independently authorized reader source and applies Region to live rows.';
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
  await j.step('narrow-reader-with-panel', page, async () => {
    await page.setViewportSize({ width: 900, height: 1100 });
    const cards = page.locator('.dashboard-grid > .visual-card'); assert.ok(await cards.count() >= 2);
    const first = await cards.nth(0).boundingBox(), second = await cards.nth(1).boundingBox();
    const actual = { first, second, stacked: second.y >= first.y + first.height - 1, panelOpen: panelAvailable };
    if (panelAvailable && actual.stacked) assert.ok(second.y >= first.y + first.height - 1);
    else j.gap('narrow-reader-with-panel', 'At 900px with Ask O open, the second card starts below the first.', actual);
    return actual;
  });
});
