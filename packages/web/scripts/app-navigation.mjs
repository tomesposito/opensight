// Shared browser navigation for acceptance/capture scripts. Click the same
// product and secondary links a user follows; no private component state.
export async function navigate(page, mode) {
  const target = {
    sample: ['Home'], analyses: ['Analyses'], author: ['Analyses', 'Author'],
    'data-prep': ['Data', 'Data preparation'], 'data-sources': ['Data', 'Data sources'],
    security: ['Admin', 'Security & namespaces'], organization: ['Admin', 'Folders, sharing & embedding'],
    automation: ['Admin', 'Schedules & alerts'], 'ai-settings': ['Admin', 'AI provider settings'],
    users: ['Admin', 'Users and invitations'], fixtures: ['Admin', 'Developer fixture preview'], api: ['Admin', 'API definition preview'],
  }[mode];
  if (!target) throw new Error(`Unknown capture destination: ${mode}`);
  await page.getByRole('navigation', { name: 'Product', exact: true }).getByRole('link', { name: target[0], exact: true }).click();
  if (target[1]) await page.locator('.section-nav').getByRole('link', { name: target[1], exact: true }).click();
}

export async function openPropertySection(page, name) {
  const section = page.locator('.properties-panel details.property-section').filter({ has: page.locator('summary', { hasText: new RegExp(`^${name}$`) }) });
  if (await section.getAttribute('open') === null) await section.locator('summary').click();
}
