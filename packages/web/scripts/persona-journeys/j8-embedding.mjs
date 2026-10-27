import { assert, launchBrowser, runJourney, startStaticSite } from './harness.mjs';

await runJourney('j8-embedding', 'Embedder (future)', async j => {
  const stack = await startStaticSite({ embed: true }); j.cleanup(stack.stop);
  const browser = await launchBrowser(j), page = await browser.page(stack);
  await j.step('preview-disclosure', page, async () => {
    await page.goto(`${stack.origin}/embed/`); await page.getByRole('heading', { name: 'Embed appearance preview', exact: true }).waitFor();
    const copy = await page.locator('body').innerText(); assert.match(copy, /Offline fixture/i); assert.match(copy, /no active session/i);
    return 'The real built preview is served locally, with its explicit offline-fixture/no-active-session disclosure.';
  });
  const states = { loading: /Loading dashboard/, empty: /No visuals/, error: /Data access was denied/, expired: /Embed URL expired/ };
  for (const [state, expected] of Object.entries(states)) await j.step(`state-${state}`, page, async () => {
    const host = page.locator(`[data-preview-state="${state}"] iframe`), frame = host.contentFrame();
    await frame.locator('.embed-brand > span').first().filter({ hasText: 'OpenSight' }).waitFor();
    const status = frame.getByRole(state === 'error' ? 'alert' : 'status'); await status.waitFor();
    assert.match(await status.innerText(), expected);
    assert.equal(await frame.locator('.embed-notices').innerText(), 'OpenSight · Apache-2.0\nData access permissions apply');
    assert.equal(await frame.locator('body').evaluate(el => el.scrollWidth <= innerWidth), true);
    assert.equal(await frame.locator('button, input, a').count(), 0, 'A preview must not imply live interaction');
  });
  await j.step('branding-switcher', page, async () => {
    await page.getByLabel('Branding', { exact: true }).selectOption('atlas');
    for (const state of Object.keys(states)) {
      const host = page.locator(`[data-preview-state="${state}"] iframe`), frame = host.contentFrame();
      await frame.locator('.embed-brand > span').first().filter({ hasText: 'Atlas Analytics' }).waitFor();
      assert.match(await host.getAttribute('title'), /^Atlas analytics dashboard/);
      assert.equal(await frame.locator('.embed-brand img').evaluate(img => img.complete && img.naturalWidth === 32), true);
      assert.match(await frame.locator('.embed-brand img').getAttribute('src'), /^data:image\/png;base64,/);
    }
    assert.match(await page.locator('body').innerText(), /no active session/i);
    return 'All four real preview frames changed from OpenSight to Atlas Analytics with a local data-URL logo.';
  });
  j.gap('live-embedded-sessions', 'A product embeds a live tenant-scoped dashboard session.', 'Live embedded sessions are not shipped as the persona journey: D14 is future vision and H11 is gated. This page provides offline appearance states only, with no active session.');
});
