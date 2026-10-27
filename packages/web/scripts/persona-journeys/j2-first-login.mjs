import { randomUUID } from 'node:crypto';
import { assert, button, enrollViaApi, invitationFrom, launchBrowser, navigate, runJourney, signIn, startHostedStack } from './harness.mjs';

await runJourney('j2-first-login', 'Workspace Admin', async j => {
  const stack = await startHostedStack(); j.cleanup(stack.stop);
  const email = 'acme-admin@example.test';
  const tenant = await stack.fixture.provisioning.provision(randomUUID(), { name: 'Acme Analytics', administrator: { email, name: 'Acme admin' } });
  const invitation = invitationFrom(stack);
  assert.match(stack.mail.messages.at(-1).html, /Workspace: Acme Analytics/);
  const browser = await launchBrowser(j), page = await browser.page(stack);
  // Observe user input without retaining passwords, codes, or invitation tokens.
  const tenantIds = [tenant.tenantId];
  const watch = async p => {
    await p.exposeFunction('checkTenantInput', value => { assert.ok(!tenantIds.includes(value), 'Tenant ID must never be typed'); });
    await p.addInitScript(() => document.addEventListener('input', e => { void window.checkTenantInput(e.target.value); }));
  };
  await watch(page);
  await j.step('invitation-entry', page, async () => {
    await page.goto(stack.origin);
    await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
    assert.equal(await page.getByLabel(/tenant id/i).count(), 0);
    assert.equal(await page.getByLabel(/invitation|new password/i).count(), 0);
    j.gap('browser-enrollment', 'An invited administrator enrolls password and TOTP through SignIn.', 'SignIn offers existing credentials only; the mail explicitly directs enrollment to the API. API enrollment is setup for the browser sign-in checks below.');
  });
  const admin = await enrollViaApi(stack, invitation, email);
  await j.step('admin-sign-in', page, async () => {
    await signIn(page, stack, admin); await page.locator('.app-shell').waitFor();
    await page.getByLabel('Account', { exact: true }).click();
    assert.equal(await page.locator('.product-header .account-workspace').innerText(), 'Acme Analytics');
    assert.match(await page.locator('.account-menu').innerText(), /Acme admin/);
    await page.getByLabel('Account', { exact: true }).click();
    const charts = await page.locator('.chart svg').count();
    if (charts) j.gap('hosted-empty-home', 'A newly provisioned workspace has no staged dashboards.', `The fresh hosted home renders ${charts} sample SVG charts.`);
    else assert.equal(charts, 0);
    return 'Password + TOTP sign-in went directly to the sole workspace; its name appears in the header Account menu.';
  });
  await j.step('invitations-ui', page, async () => {
    await navigate(page, 'users');
    await page.getByRole('heading', { name: 'Users and invitations', exact: true }).waitFor();
    const actual = await page.locator('main').innerText();
    assert.match(actual, /managed by the operator/);
    assert.equal(await button(page, 'Create invitation').count(), 0);
    j.gap('admin-invites-reader', 'Workspace administrator creates a Reader AI invitation in this UI.', actual);
    if (!/7 days/.test(actual)) j.gap('invitation-expiry-copy', 'The hosted invitations UI states a seven-day expiry.', 'This hosted UI only redirects membership management to the operator; it has no expiry copy.');
    else assert.match(actual, /7 days/);
  });
  await stack.fixture.provisioning.inviteMember(randomUUID(), tenant.tenantId, { email: 'acme-reader@example.test', name: 'Acme reader', role: 'reader_ai' });
  const reader = await enrollViaApi(stack, invitationFrom(stack), 'acme-reader@example.test');
  const readerPage = await browser.page(stack); await watch(readerPage);
  await j.step('reader-sign-in', readerPage, async () => {
    await signIn(readerPage, stack, reader); await readerPage.locator('.app-shell').waitFor();
    assert.equal(await readerPage.locator('#product-navigation').getByRole('link', { name: /^(Analyses|Data)$/ }).count(), 0);
    await readerPage.getByLabel('Account', { exact: true }).click();
    assert.match(await readerPage.locator('.account-menu').innerText(), /Acme reader/);
    assert.doesNotMatch(await readerPage.locator('.account-menu').innerText(), /Acme admin/);
    return 'Reader AI enrollment uses the API because hosted invitation/enrollment UI is absent; real SignIn establishes the reader session in a separate context.';
  });
  const second = await stack.fixture.provisioning.provision(randomUUID(), { name: 'Acme Research', administrator: { email, name: 'Acme admin' } });
  tenantIds.push(second.tenantId);
  const accepted = await stack.request('/api/auth/accept', 'POST', { invitationToken: invitationFrom(stack), password: admin.password, code: await admin.code() });
  assert.equal(accepted.status, 200);
  const picker = await browser.page(stack); await watch(picker);
  await j.step('workspace-picker', picker, async () => {
    await signIn(picker, stack, admin);
    await picker.getByRole('heading', { name: 'Choose your workspace', exact: true }).waitFor();
    assert.deepEqual((await picker.locator('.sign-in-workspace-name').allTextContents()).sort(), ['Acme Analytics', 'Acme Research']);
    assert.match(await picker.locator('.sign-in-identity').innerText(), /acme-admin@example.test/);
    assert.equal(await picker.getByLabel(/tenant id/i).count(), 0);
  });
  await j.step('switch-workspace', picker, async () => {
    await picker.getByRole('button', { name: /Acme Research/ }).click(); await picker.locator('.app-shell').waitFor();
    await picker.getByLabel('Account', { exact: true }).click();
    assert.equal(await picker.locator('.product-header .account-workspace').innerText(), 'Acme Research');
  });
});
