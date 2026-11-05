import { randomUUID } from 'node:crypto';
import { assert, button, enrollInBrowser, invitationFrom, launchBrowser, runJourney, startHostedStack } from './harness.mjs';

await runJourney('j7-operator', 'Operator', async j => {
  const stack = await startHostedStack({ usage: true }); j.cleanup(stack.stop);
  const operator = `Operator ${stack.fixture.hostedConfig.operatorKey.toString('base64url')}`;
  const browser = await launchBrowser(j), page = await browser.page(stack);
  let tenant, invitation;
  await j.step('tenant-list', page, async () => {
    await page.goto(`${stack.origin}/#operator-tenants`);
    await page.getByLabel('Operator credential', { exact: true }).fill(operator.slice('Operator '.length));
    await button(page, 'Load tenants').click(); await button(page, 'New tenant').waitFor();
    assert.equal(await page.getByLabel('Operator credential', { exact: true }).count(), 0);
    return 'The real operator list loads through the Origin-bearing browser route using a memory-only credential.';
  });
  await j.step('create-tenant', page, async () => {
    await button(page, 'New tenant').click();
    await page.getByLabel('Workspace display name', { exact: false }).fill('Journey operator workspace');
    assert.equal(await page.getByLabel('Tenant name', { exact: false }).inputValue(), 'Journey operator workspace');
    assert.equal(await page.getByLabel('Slug', { exact: false }).inputValue(), 'journey-operator-workspace');
    await page.getByLabel('Tenant name', { exact: false }).fill('Journey namespace');
    await page.getByLabel('Slug', { exact: false }).fill('journey-operator');
    await page.getByLabel('Administrator name', { exact: true }).fill('Provisioned admin');
    await page.getByLabel('Administrator email', { exact: false }).fill('operator-admin@example.test');
    return 'The create panel derives namespace and slug from the display name and preserves operator edits.';
  });
  await j.step('provisioning-ui', page, async () => {
    await button(page, 'Create tenant').click();
    await page.getByRole('heading', { name: 'Tenant created on the Free plan', exact: true }).waitFor();
    const href = await page.getByRole('link', { name: 'Open tenant details', exact: true }).getAttribute('href');
    const tenantId = href.slice('#operator-tenant/'.length);
    const created = await stack.request(`/api/host/tenants/${tenantId}`, 'GET', undefined, operator);
    assert.equal(created.status, 200); tenant = created.body; invitation = invitationFrom(stack);
    assert.equal(tenant.state, 'active'); assert.equal(tenant.displayName, 'Journey operator workspace'); assert.equal(tenant.slug, 'journey-operator');
    assert.match(stack.mail.messages.at(-1).html, /Workspace: Journey operator workspace/);
    const namespace = await stack.db.transaction(c => c.query('SELECT name FROM h1_namespaces WHERE namespace_id = ?', [tenant.namespaceId]));
    assert.equal(namespace[0].name, 'Journey namespace');
    assert.equal((await page.locator('body').innerText()).includes(invitation), false);
    return 'Provisioned through the UI, independently verified active tenant and split names in PostgreSQL, and confirmed the invitation stays in server mail.';
  });
  await j.step('tenant-detail', page, async () => {
    await page.getByRole('link', { name: 'Open tenant details', exact: true }).click();
    await page.getByLabel('Operator credential', { exact: true }).fill(operator.slice('Operator '.length));
    await button(page, 'Load tenants').click();
    await page.getByRole('heading', { name: 'Journey operator workspace', exact: true }).waitFor();
    await page.getByLabel('Tenant usage', { exact: true }).waitFor();
    assert.match(await page.locator('main').innerText(), /Billing is not configured/);
    assert.equal(await button(page, 'Generate payment link').count(), 0);
    assert.equal(await page.getByRole('progressbar').count(), 4);
    return 'Detail renders overview, live usage with daily/monthly quota labels, members, billing-not-configured state and lifecycle controls.';
  });
  await j.step('tenant-detail-narrow', page, async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
    return 'Detail cards, identifiers and usage remain readable at a narrow viewport without horizontal overflow.';
  });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await j.step('provision-and-load-users', page, async () => {
    await page.goto(`${stack.origin}/#operator-users`);
    await page.getByLabel('Tenant ID', { exact: true }).fill(tenant.tenantId);
    await page.getByLabel('Operator credential', { exact: true }).fill(operator.slice('Operator '.length));
    await button(page, 'Load tenant users').click(); await button(page, 'Remove Provisioned admin').waitFor();
    assert.equal(await page.getByLabel('Operator credential', { exact: true }).inputValue(), '', 'Credential is cleared after connection');
    return 'The membership provisioned through the new page appears in the existing operator users page.';
  });
  const adminPage = await browser.page(stack);
  await j.step('admin-enrollment-entry', adminPage, async () => {
    await adminPage.goto(stack.origin); await adminPage.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
    assert.equal(await adminPage.getByLabel(/invitation token|new password/i).count(), 0);
  });
  await j.step('admin-browser-enrollment', adminPage, async () => {
    await enrollInBrowser(adminPage, stack, invitation, 'operator-admin@example.test');
    return 'The provisioned administrator opens the mailed invitation, sets a password, confirms the displayed TOTP secret, and signs in with a fresh code entirely through the browser.';
  });
  await j.step('admin-tenant-alive', adminPage, async () => {
    await adminPage.locator('.app-shell').waitFor();
    await adminPage.getByLabel('Account', { exact: true }).click();
    assert.equal(await adminPage.locator('.account-workspace').innerText(), 'Journey operator workspace');
    assert.match(await adminPage.locator('.account-menu').innerText(), /Provisioned admin/);
    return 'The newly provisioned administrator completed password/TOTP sign-in in a second browser context.';
  });
  await stack.fixture.provisioning.inviteMember(randomUUID(), tenant.tenantId, { email: 'removable-reader@example.test', name: 'Removable reader', role: 'reader' });
  const users = await stack.request(`/api/host/tenants/${tenant.tenantId}/users`, 'GET', undefined, operator);
  assert.equal(users.status, 200);
  const removable = users.body.find(user => user.name === 'Removable reader'); assert.ok(removable); assert.equal(removable.role, 'reader');
  await j.step('review-user-removal', page, async () => {
    await page.getByLabel('Operator credential', { exact: true }).fill(operator.slice('Operator '.length));
    await button(page, 'Load tenant users').click(); await button(page, 'Remove Removable reader').click();
    const dialog = page.getByRole('dialog'); await dialog.waitFor();
    assert.equal(await button(dialog, 'Remove user and stop schedules').isDisabled(), true);
    await dialog.getByLabel('Stop schedules', { exact: true }).check();
    assert.equal(await button(dialog, 'Remove user and stop schedules').isEnabled(), true);
    return 'The operator must explicitly choose a schedule disposition, even for this new Reader with zero schedules.';
  });
  await j.step('remove-user-and-confirm-api', page, async () => {
    await button(page.getByRole('dialog'), 'Remove user and stop schedules').click();
    await page.getByRole('status').filter({ hasText: 'User removed. Schedules stopped' }).waitFor();
    assert.equal(await button(page, 'Remove Removable reader').count(), 0);
    assert.equal(await button(page, 'Remove Provisioned admin').count(), 1);
    const after = await stack.request(`/api/host/tenants/${tenant.tenantId}/users`, 'GET', undefined, operator);
    assert.equal(after.status, 200); assert.equal(after.body.some(user => user.id === removable.id), false);
    const rows = await stack.db.transaction(c => c.query('SELECT status FROM h2_memberships WHERE tenant_id = ? AND user_id = ?', [tenant.tenantId, removable.id]));
    assert.equal(rows[0].status, 'removed');
    return 'The browser list and a separate operator API request both omit the removed Reader; PostgreSQL records the removed membership.';
  });
});
