import { randomUUID } from 'node:crypto';
import { assert, button, enrollViaApi, invitationFrom, launchBrowser, navigate, runJourney, signIn, startHostedStack } from './harness.mjs';

await runJourney('j2-first-login', 'Workspace Admin', async j => {
  const stack = await startHostedStack({ invitationSeconds: 604800 }); j.cleanup(stack.stop);
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
    await j.step('hosted-empty-home', null, async () => {
      await page.getByText('No published dashboards are available to you yet.', { exact: true }).waitFor();
      assert.equal(await page.locator('.chart svg').count(), 0);
      assert.doesNotMatch(await page.locator('main').innerText(), /Pinned synthetic sales|Pinned sample data/);
      return 'The fresh hosted workspace has a real empty dashboard collection.';
    });
    return 'Password + TOTP sign-in went directly to the sole workspace; its name appears in the header Account menu.';
  });
  await j.step('invitations-ui', page, async () => {
    await navigate(page, 'users');
    await page.getByRole('heading', { name: 'Users and invitations', exact: true }).waitFor();
    await j.step('invitation-expiry-copy', null, async () => {
      assert.match(await page.locator('main').innerText(), /7 days/);
      return 'The workspace invitation form states that invitations expire after 7 days.';
    });
    await j.step('admin-invites-reader', null, async () => {
      const form = page.getByRole('form', { name: 'Invite user' });
      await form.getByLabel('Email address', { exact: true }).fill('acme-reader@example.test');
      await form.getByLabel('Display name', { exact: true }).fill('Acme reader');
      await form.getByRole('combobox', { name: 'Role', exact: true }).selectOption('reader_ai');
      await button(page, 'Create invitation').click();
      await page.getByRole('status').filter({ hasText: 'Invitation created.' }).waitFor();
      const link = await page.getByLabel('Single-use invitation link', { exact: true }).inputValue();
      assert.ok(new URL(link).hash === `#invite=${invitationFrom(stack)}`, 'Shared link must carry the mailed invitation');
      await button(page, 'Revoke acme-reader@example.test').waitFor();
      assert.equal(await page.getByRole('button', { name: /^Remove / }).count(), 0);
      // Reload the management view to prove persistence and avoid retaining tokens in captures.
      await navigate(page, 'sample'); await navigate(page, 'users');
      await button(page, 'Revoke acme-reader@example.test').waitFor();
      assert.equal(await page.getByLabel('Single-use invitation link', { exact: true }).count(), 0);
      return 'Workspace administrator created a Reader AI invitation; the pending invitation persists and its single-use link is shown only at creation.';
    });
  });
  const reader = await enrollViaApi(stack, invitationFrom(stack), 'acme-reader@example.test');
  const readerPage = await browser.page(stack); await watch(readerPage);
  await j.step('reader-sign-in', readerPage, async () => {
    await signIn(readerPage, stack, reader); await readerPage.locator('.app-shell').waitFor();
    assert.equal(await readerPage.locator('#product-navigation').getByRole('link', { name: /^(Analyses|Data)$/ }).count(), 0);
    await readerPage.getByLabel('Account', { exact: true }).click();
    assert.match(await readerPage.locator('.account-menu').innerText(), /Acme reader/);
    assert.doesNotMatch(await readerPage.locator('.account-menu').innerText(), /Acme admin/);
    return 'Reader AI enrollment uses the API because browser enrollment is issue #152; real SignIn establishes the reader session in a separate context.';
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
