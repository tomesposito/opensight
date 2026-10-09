// Shared browser navigation for acceptance/capture scripts. Click the same
// product and secondary links a user follows; no private component state.
export async function navigate(page, mode) {
  const target = {
    sample: ['Home'], 'my-stuff': ['My stuff'], 'my-folders': ['My folders'], 'shared-folders': ['Shared folders'], analyses: ['Analyses'], author: ['Analyses', 'Author'],
    'data-prep': ['Data', 'Data preparation'], 'data-sources': ['Data', 'Data sources'],
    security: ['Admin', 'Security & namespaces'], organization: ['Admin', 'Folders, sharing & embedding'],
    automation: ['Admin', 'Schedules & alerts'], 'ai-settings': ['Admin', 'AI provider settings'],
    users: ['Admin', 'Users and invitations'], fixtures: ['Admin', 'Developer fixture preview'], api: ['Admin', 'API definition preview'],
  }[mode];
  if (!target) throw new Error(`Unknown capture destination: ${mode}`);
  if (target[0] === 'Home') { await page.locator('.product-header .brand').click(); return; }
  const rail = page.locator('#product-navigation');
  const ensureRail = async () => { if (!await rail.isVisible()) await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click(); };
  await ensureRail();
  if (target[0] === 'Admin') {
    const more = page.getByRole('button', { name: 'More', exact: true });
    if (await more.getAttribute('aria-expanded') !== 'true') await more.click();
  } else {
    await page.getByRole('navigation', { name: 'Product', exact: true }).getByRole('link', { name: target[0], exact: true }).click();
    if (target[0] === 'Analyses' && target[1]) await ensureRail();
  }
  if (target[1]) await page.locator('.section-nav').getByRole('link', { name: target[1], exact: true }).click();
}

export async function openPropertySection(page, name) {
  const section = page.locator('.properties-panel details.property-section').filter({ has: page.locator('summary', { hasText: new RegExp(`^${name}$`) }) });
  if (await section.getAttribute('open') === null) await section.locator('summary').click();
}
