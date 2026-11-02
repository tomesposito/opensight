import { rm } from 'node:fs/promises';
import { assert, button, launchBrowser, runJourney, startHostedStack, startLocalStack, temporaryRoot } from './harness.mjs';

await runJourney('j9-ideas', 'Member + Operator', async j => {
  const stack = await startHostedStack(); j.cleanup(stack.stop);
  const browser = await launchBrowser(j), member = await browser.page(stack, stack.tokens.admin);
  const title = 'Export dashboards to PDF', description = 'Let workspace members download dashboards as PDFs to share in offline review meetings.';
  const myIdeas = member.getByRole('region', { name: 'My ideas', exact: true });
  const idea = myIdeas.getByRole('listitem').filter({ has: member.getByRole('heading', { name: title, exact: true }) });
  await j.step('member-submits-idea', member, async () => {
    await member.goto(`${stack.origin}/#/ideas`);
    const form = member.getByRole('form', { name: 'Suggest an idea', exact: true });
    await form.getByLabel('Title', { exact: true }).fill(title);
    await form.getByLabel('Description', { exact: true }).fill(description);
    await button(form, 'Submit idea').click();
    await form.getByRole('status').filter({ hasText: 'Idea received. You can follow its status below.' }).waitFor();
    await myIdeas.getByRole('heading', { name: 'My ideas', exact: true }).waitFor();
    await idea.getByText('Received', { exact: true }).waitFor();
    assert.equal(await idea.getByText(description, { exact: true }).isVisible(), true);
    return 'The hosted member submitted a title and description through the real form; My ideas shows the submission as Received.';
  });
  const reader = await browser.page(stack, stack.tokens.reader);
  await j.step('second-member-cannot-see', reader, async () => {
    assert.notEqual(reader.context(), member.context());
    await reader.goto(`${stack.origin}/#/ideas`);
    const list = reader.getByRole('region', { name: 'My ideas', exact: true });
    await list.getByText('No ideas submitted yet.', { exact: true }).waitFor();
    assert.equal(await list.getByRole('heading', { name: title, exact: true }).count(), 0);
    const response = await stack.request('/api/ideas', 'GET', undefined, `Bearer ${stack.tokens.reader}`);
    assert.equal(response.status, 200); assert.deepEqual(response.body.ideas, []);
    return 'A second member of the same hosted tenant has an empty My ideas list in a separate browser context and an empty member API result.';
  });
  const operator = `Operator ${stack.fixture.hostedConfig.operatorKey.toString('base64url')}`;
  const operatorPage = await browser.page(stack), note = 'Not now — revisit after the next release.';
  await j.step('operator-reviews-and-declines', operatorPage, async () => {
    await operatorPage.goto(`${stack.origin}/#operator-ideas`);
    const connection = operatorPage.getByRole('form', { name: 'Operator connection', exact: true });
    await connection.getByLabel('Operator credential', { exact: true }).fill(operator.slice('Operator '.length));
    await button(connection, 'Load ideas').click();
    const article = operatorPage.getByRole('article').filter({ has: operatorPage.getByRole('heading', { name: title, exact: true }) });
    await article.getByText('Received', { exact: true }).waitFor();
    const review = article.getByRole('form', { name: `Review ${title}`, exact: true });
    assert.equal(await review.getByLabel('Next status').inputValue(), 'under_review');
    await button(review, 'Update status').click();
    await article.locator('strong').filter({ hasText: /^Under review$/ }).waitFor();
    await operatorPage.getByRole('status').filter({ hasText: 'Idea status updated.' }).waitFor();
    await review.getByLabel('Next status').selectOption('declined');
    assert.equal(await review.getByLabel('Decline category').inputValue(), '');
    assert.equal(await review.getByLabel('Decline note', { exact: true }).inputValue(), '');
    assert.equal(await button(review, 'Update status').isDisabled(), true);
    const queue = await stack.request('/api/host/ideas', 'GET', undefined, operator);
    assert.equal(queue.status, 200);
    const matches = queue.body.ideas.filter(item => item.title === title); assert.equal(matches.length, 1);
    const submitted = matches[0]; assert.equal(submitted.status, 'under_review');
    const declined = await stack.request(`/api/host/ideas/${encodeURIComponent(submitted.id)}`, 'PATCH', { status: 'declined' }, operator);
    assert.equal(declined.status, 400); assert.equal(declined.body.errorCode, 'IDEA_DECLINE_REASON_REQUIRED');
    await review.getByLabel('Decline category').selectOption('later');
    assert.equal(await button(review, 'Update status').isDisabled(), true, 'A category alone is insufficient');
    await review.getByLabel('Decline note', { exact: true }).fill(note);
    assert.equal(await button(review, 'Update status').isEnabled(), true);
    await button(review, 'Update status').click();
    await article.locator('strong').filter({ hasText: /^Declined$/ }).waitFor();
    await operatorPage.getByRole('status').filter({ hasText: 'Idea status updated.' }).waitFor();
    await article.getByText(`Reason: Later · ${note}`, { exact: true }).waitFor();
    return 'The operator moved Received to Under review in the UI. Missing decline reasons disable Update status and return HTTP 400 IDEA_DECLINE_REASON_REQUIRED; Later plus a note completes the UI decline.';
  });
  await j.step('member-sees-decline', member, async () => {
    await button(myIdeas, 'Refresh ideas').click();
    await idea.getByText('Declined', { exact: true }).waitFor();
    await idea.getByText(`Reason: Later · ${note}`, { exact: true }).waitFor();
    return 'Refreshing the submitting member’s My ideas list shows Declined and the operator’s Later category and full note.';
  });
  const root = await temporaryRoot(); j.cleanup(() => rm(root, { recursive: true, force: true }));
  let local;
  try { local = await startLocalStack(root); } catch (error) {
    j.gap('local-mode-hosted-only', 'A fresh local stack shows Ideas need a hosted workspace with no submission form.', `The local stack could not start: ${error.message}`);
    return;
  }
  j.cleanup(local.stop);
  // Register this browser after the local stack so cleanup closes its contexts
  // and drains their requests before stopping the local API or removing its root.
  const localBrowser = await launchBrowser(j), localPage = await localBrowser.page(local);
  await j.step('local-mode-hosted-only', localPage, async () => {
    await localPage.goto(`${local.origin}/#/ideas`);
    await localPage.getByRole('heading', { name: 'Ideas need a hosted workspace', exact: true }).waitFor();
    assert.equal(await button(localPage, 'Submit idea').count(), 0);
    assert.equal(await localPage.getByRole('form', { name: 'Suggest an idea', exact: true }).count(), 0);
    const response = await localPage.evaluate(async () => {
      const result = await fetch('/api/api/ideas'); return { status: result.status, body: await result.json() };
    });
    assert.equal(response.status, 409); assert.equal(response.body.errorCode, 'IDEAS_HOSTED_ONLY');
    return 'A fresh local context shows the hosted-workspace notice and no submit form or button; the real local API returns HTTP 409 IDEAS_HOSTED_ONLY. No external link was opened.';
  });
});
