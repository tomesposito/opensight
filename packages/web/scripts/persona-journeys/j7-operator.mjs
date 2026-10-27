import { randomUUID } from 'node:crypto';
import { assert, button, enrollViaApi, invitationFrom, launchBrowser, runJourney, signIn, startHostedStack } from './harness.mjs';

await runJourney('j7-operator', 'Operator', async j => {
  const stack = await startHostedStack(); j.cleanup(stack.stop);
  const operator = `Operator ${stack.fixture.hostedConfig.operatorKey.toString('base64url')}`;
  const created = await stack.request('/api/host/tenants', 'POST', { name: 'Journey operator workspace', slug: 'journey-operator', administrator: { email: 'operator-admin@example.test', name: 'Provisioned admin' } }, operator);
  assert.equal(created.status, 201); assert.equal(created.body.state, 'active');
  const tenant = created.body, invitation = invitationFrom(stack);
  assert.match(stack.mail.messages.at(-1).html, /Workspace: Journey operator workspace/);
  const browser = await launchBrowser(j), page = await browser.page(stack);
  await j.step('provision-and-load-users', page, async () => {
    await page.goto(`${stack.origin}/#operator-users`);
    await page.getByLabel('Tenant ID', { exact: true }).fill(tenant.tenantId);
    await page.getByLabel('Operator credential', { exact: true }).fill(operator.slice('Operator '.length));
    await button(page, 'Load tenant users').click(); await button(page, 'Remove Provisioned admin').waitFor();
    assert.equal(await page.getByLabel('Operator credential', { exact: true }).inputValue(), '', 'Credential is cleared after connection');
    j.gap('provisioning-ui', 'An operator can provision a workspace in the product UI.', 'Tenant provisioning has no UI. This test used the real POST /api/host/tenants operator API, then loaded the provisioned membership in the operator page.');
    return 'Provisioning returned an active tenant and a named invitation; its administrator appears in the real operator UI.';
  });
  const adminPage = await browser.page(stack);
  await j.step('admin-enrollment-entry', adminPage, async () => {
    await adminPage.goto(stack.origin); await adminPage.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
    assert.equal(await adminPage.getByLabel(/invitation token|new password/i).count(), 0);
    j.gap('admin-browser-enrollment', 'Provisioned admin enrolls through the browser.', 'The mail directs password/TOTP enrollment to the API. SignIn accepts existing credentials only; API enrollment precedes the separate-context browser sign-in.');
  });
  const account = await enrollViaApi(stack, invitation, 'operator-admin@example.test');
  await j.step('admin-tenant-alive', adminPage, async () => {
    await signIn(adminPage, stack, account); await adminPage.locator('.app-shell').waitFor();
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
