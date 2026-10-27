import { assert, launchBrowser, runJourney, startStaticSite } from './harness.mjs';
await runJourney('j1-discover', 'Evaluator', async j => {
  const stack = await startStaticSite(); j.cleanup(stack.stop);
  const browser = await launchBrowser(j), page = await browser.page(stack);
  await j.step('homepage', page, async () => {
    await page.goto(stack.origin);
    const hero = await page.locator('.hero').innerText();
    assert.match(hero, /open.source/i);
    if (!/QuickSight/i.test(hero)) j.gap('hero-quicksight-proposition', 'The hero states the QuickSight-compatible proposition.', hero);
    else assert.match(hero, /QuickSight/i);
    await page.locator('.hero').getByRole('link', { name: 'Try the live demo', exact: true }).waitFor();
    await page.getByRole('link', { name: 'Login', exact: true }).waitFor();
    assert.ok(await page.locator('a[href="https://github.com/tomesposito/opensight"]').count());
  });
  await j.step('crawler-files', page, async () => {
    for (const [path, pattern] of [['/robots.txt', /User-agent:/], ['/sitemap.xml', /<urlset/]]) {
      const result = await page.evaluate(async path => { const r = await fetch(path); return { status: r.status, type: r.headers.get('content-type'), text: await r.text() }; }, path);
      assert.equal(result.status, 200); assert.match(result.type, /text|xml/); assert.match(result.text, pattern); assert.doesNotMatch(result.text, /<!doctype html>/i);
    }
    return 'Repo-side static serving returns actual robots.txt and sitemap.xml (#149); no deployed-host claim.';
  });
  const access = page.getByRole('link', { name: /request access|waitlist/i }).or(page.getByRole('button', { name: /request access|waitlist/i }));
  if (!await access.count()) j.gap('request-access', 'On-site request access with confirmation and manual provisioning expectations (D-79).', 'D-79 request access has no on-site entry point');
  else await j.step('request-access-entry', page, async () => { await access.first().waitFor(); return await access.allTextContents(); });
  await j.step('live-demo', page, async () => {
    await page.locator('.hero').getByRole('link', { name: 'Try the live demo', exact: true }).click();
    await page.locator('.chart svg').first().waitFor();
    assert.ok(await page.locator('.chart svg path').count(), 'Dashboard SVG has drawable content');
  });
  await j.step('ask-o-sample', page, async () => {
    await page.getByRole('button', { name: /^Ask a question about / }).click();
    await page.locator('#o-question').fill('revenue by region'); await page.locator('#o-question').press('Enter');
    await page.locator('.o-result .chart svg').waitFor();
    await page.locator('.o-result summary').filter({ hasText: 'View data' }).click();
    assert.deepEqual(await page.locator('.o-result tbody tr').evaluateAll(rows => rows.map(r => [...r.cells].map(c => c.textContent))), [['East', '500'], ['West', '400']]);
    assert.match(await page.locator('.o-source').innerText(), /Offline demo/);
    return 'The supported sample question recomputes synthetic sales: East 500, West 400.';
  });
});
