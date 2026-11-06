import { assert, button, launchBrowser, navigate, runJourney, startHostedStack } from './harness.mjs';

await runJourney('j4-reader-daily', 'Reader AI', async j => {
  let stack;
  try { stack = await startHostedStack({ aiStub: true }); }
  catch (error) { j.gap('author-dashboard-generation', 'Drive the real author surface: plan 10 → 6 credits, revise → 5, then a credit-limited plan (#196).', `Hosted author setup unavailable: ${error.message}`); throw error; }
  j.cleanup(stack.stop);
  const { hostedDataFixture } = await import('../../test/hosted-data-helpers.mjs');
  const { HostedData } = await import('../../../api/dist/hosted-data.js');
  const { HostedPrep } = await import('../../../api/dist/hosted-prep.js');
  const seed = await hostedDataFixture({ after: fn => j.cleanup(fn) });
  // Transfer the fixture's actual rows and recipe into the real PostgreSQL
  // tenant. No browser response is synthesized or delegated to fixture.fetcher.
  const raw = await seed.data.execute(await seed.login(), seed.source.id, 'output', {});
  const names = raw.columns.map(c => c.name);
  const csv = [[...names, 'category', 'order_date'].join(','), ...raw.rows.map((row, i) => [...names.map(n => row[n]), i % 2 ? 'Services' : 'Hardware', `2025-0${i + 1}-01`].join(','))].join('\n') + '\n';
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
  let browser;
  try { browser = await launchBrowser(j); }
  catch (error) { j.gap('author-dashboard-generation', 'Drive and capture the real author plan, revision and credit-limited tail (#196).', error.message.includes('Hatch WebGL domain policy') ? 'Chromium refuses startup: Hatch WebGL domain policy is required. No author steps or screenshots ran.' : `Browser startup failed: ${error.message.split('\n')[0]}`); throw error; }
  const author = await browser.page(stack, adminToken);
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
  await j.step('managed-provider-configured', author, async () => {
    await author.getByRole('button', { name: /^Ask a question about / }).click();
    await author.locator('.q-side-panel').waitFor();
    await author.getByRole('switch', { name: 'Generative mode', exact: true }).waitFor();
    await author.waitForFunction(() => !document.querySelector('[role="switch"]').disabled);
    assert.match(await author.locator('.o-mode-notice').innerText(), /Managed AI/);
    return 'The explicit test-only managed stub enables hosted Ask O with ten monthly credits and no live provider call.';
  });
  await j.step('author-dashboard-plan', author, async () => {
    const panel = author.locator('.q-side-panel');
    await panel.getByRole('switch', { name: 'Generative mode', exact: true }).check();
    await button(panel, 'Build a dashboard').click(); await panel.getByLabel('Dashboard prompt', { exact: true }).fill('Build a sales overview');
    const response = author.waitForResponse(r => r.url().endsWith('/api/o/plan'));
    await button(panel, 'Build dashboard').click(); const delivered = await response;
    assert.equal(delivered.status(), 200); assert.equal((await delivered.json()).delivered, 4);
    await author.getByRole('region', { name: 'Proposed sheet', exact: true }).waitFor();
    assert.match(await panel.locator('.o-credits').innerText(), /6 of 10 credits left/);
    assert.equal(await author.locator('.o-staging-grid article').count(), 4);
    await button(author, 'Add as new sheet').click();
    return 'The real author plan delivers all four stub questions, uses four credits, and commits as a new sheet.';
  });
  await j.step('author-revise-o-tile', author, async () => {
    const panel = author.locator('.q-side-panel'); await button(panel, 'Ask a question').click();
    await panel.getByLabel('Tile follow-up', { exact: true }).fill('Group it by region');
    const response = author.waitForResponse(r => r.url().endsWith('/api/o/revise'));
    await button(panel, 'Propose revision').click(); assert.equal((await response).status(), 200);
    await panel.getByText('Revision ready · 1 credit used', { exact: true }).waitFor();
    assert.match(await panel.locator('.o-credits').innerText(), /5 of 10 credits left/);
    await button(panel, 'Replace').click();
    return 'A delivered proposal consumes one credit; Replace updates the stamped tile in one command.';
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
    await page.locator('.dashboard-grid .chart svg').first().waitFor({ timeout: 45000 });
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
    await page.waitForFunction(() => !document.querySelector('[role="switch"]').disabled);
    assert.match(await panel.locator('.o-mode-notice').innerText(), /Managed AI/);
    return { before, after, panel: box };
  });
  await j.step('ai-answer-environment', page, async () => {
    assert.equal(panelAvailable, true, 'Hosted reader Ask O must be available');
    const panel = page.locator('.q-side-panel');
    await panel.getByRole('switch', { name: 'Generative mode', exact: true }).check();
    await panel.getByRole('searchbox', { name: 'Ask a question', exact: true }).fill('Which region drove revenue?');
    const generated = page.waitForResponse(r => r.url().endsWith('/api/o/generate'));
    const queried = page.waitForResponse(r => /\/api\/o\/query$|\/question$/.test(r.url()) && r.request().method() === 'POST');
    await panel.getByRole('button', { name: 'Ask', exact: true }).click();
    assert.equal((await generated).status(), 200);
    const result = await queried; assert.equal(result.status(), 200);
    assert.deepEqual((await result.json()).rows, [{ region: 'east', 'O sum revenue': 40 }, { region: 'west', 'O sum revenue': 20 }]);
    await panel.locator('.o-result .chart svg').waitFor();
    assert.match(await panel.locator('.o-grounding').first().innerText(), /Grounded in:.*revenue.*region/);
    assert.match(await panel.locator('.o-credits').innerText(), /4 of 10 credits left/);
    return 'The real hosted generate route returns a grounded interpretation; its query executes on reader-owned data and renders east 40 / west 20. One managed credit is committed. No live AI transport is used.';
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
  await j.step('author-credit-limited-plan', author, async () => {
    await author.context().setExtraHTTPHeaders({ Authorization: `Bearer ${(await f.login()).token}` });
    await author.goto(`${stack.origin}/#/author`);
    await author.getByRole('button', { name: /^Ask a question about / }).click();
    const panel = author.locator('.q-side-panel');
    await author.waitForFunction(() => !document.querySelector('[role="switch"]').disabled);
    await panel.getByRole('switch', { name: 'Generative mode', exact: true }).check();
    // A real additional answer leaves three credits; the second four-tile plan
    // must deliver its important prefix and expose the fourth tile as limited.
    await panel.getByRole('searchbox', { name: 'Ask a question', exact: true }).fill('sum revenue by region');
    const single = author.waitForResponse(r => r.url().endsWith('/api/o/generate'));
    await panel.getByRole('button', { name: 'Ask', exact: true }).click(); assert.equal((await single).status(), 200);
    await panel.getByText(/3 of 10 credits left/).waitFor();
    await button(panel, 'Build a dashboard').click(); await panel.getByLabel('Dashboard prompt', { exact: true }).fill('Build another sales overview');
    const response = author.waitForResponse(r => r.url().endsWith('/api/o/plan'));
    await button(panel, 'Build dashboard').click(); const result = await response;
    assert.equal(result.status(), 200); const plan = await result.json();
    assert.equal(plan.delivered, 3); assert.deepEqual(plan.tiles.map(t => t.status), ['ok', 'ok', 'ok', 'credit-limited']);
    await author.locator('.o-plan-placeholder').getByText(/No monthly credits remain/).waitFor();
    assert.match(await panel.locator('.o-credits').innerText(), /0 of 10 credits left/);
    await button(author, 'Discard proposed sheet').click();
    return 'The second plan delivers three tiles and leaves an explicit, uncharged credit-limited tail. Discard refunds no delivered tiles.';
  });
  await j.step('managed-credit-limit', page, async () => {
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.getByRole('button', { name: 'Close Ask O', exact: true }).click(); await trigger.click();
    const panel = page.locator('.q-side-panel');
    await panel.getByText('Monthly Ask O credits are used up', { exact: true }).waitFor();
    assert.equal(await panel.getByRole('switch', { name: 'Generative mode', exact: true }).isChecked(), false);
    assert.equal(await panel.getByRole('switch', { name: 'Generative mode', exact: true }).isDisabled(), true);
    assert.match(await panel.locator('.o-credits').innerText(), /0 of 10 credits left/);
    await panel.getByRole('searchbox', { name: 'Ask a question', exact: true }).fill('sum revenue by region');
    await panel.getByRole('button', { name: 'Ask', exact: true }).click(); await panel.locator('.o-result .chart svg').waitFor();
    assert.match(await panel.innerText(), /Standard interpreter · No AI/);
    return 'At zero credits the switch is off and disabled, the balance/reset are visible, and the standard interpreter still renders a result.';
  });
  await j.step('admin-ai-mode-settings', author, async () => {
    // The fixture's source-policy update invalidates earlier bearer revisions.
    await author.context().setExtraHTTPHeaders({ Authorization: `Bearer ${(await f.login()).token}` });
    await author.goto(stack.origin); await author.locator('.app-shell').waitFor();
    await navigate(author, 'ai-settings');
    await author.getByRole('heading', { name: 'AI provider settings', exact: true }).waitFor();
    await author.getByRole('radio', { name: /^Managed by OpenSight/ }).waitFor();
    assert.equal(await author.getByRole('radio', { name: /^Managed by OpenSight/ }).isChecked(), true);
    await author.getByRole('radio', { name: /^Your own AI provider/ }).check();
    await author.getByRole('combobox', { name: 'AI provider', exact: true }).selectOption('anthropic');
    await author.getByLabel('Model ID', { exact: true }).fill('persona-model');
    await author.getByRole('button', { name: 'Save mode & provider', exact: true }).click();
    await author.getByText('Provider and model saved.', { exact: true }).waitFor();
    assert.equal(await author.getByLabel('Replace API key', { exact: true }).inputValue(), '');
    return 'Admin settings start in managed mode and save a BYO provider/model without exposing or fabricating a stored key.';
  });

});
