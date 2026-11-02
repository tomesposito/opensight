import { assert, button, launchBrowser, runJourney, startHostedStack } from './harness.mjs';

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
});
