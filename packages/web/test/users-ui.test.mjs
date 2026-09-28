import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { AccessProvider } from '../build/test/access.js';
import { UserManagement, AcceptInvitation } from '../build/test/UserManagement.js';
const access = role => ({ mode: 'hosted', session: { id: 'admin', namespaceId: 'default', name: 'Admin', role } });

test('user management is hidden for all non-admin roles and static preview', () => {
  for (const role of ['author', 'author_ai', 'reader', 'reader_ai', undefined]) {
    const html = renderToStaticMarkup(createElement(AccessProvider, { access: access(role) }, createElement(UserManagement, { client: {} })));
    assert.match(html, /SECURITY_ADMIN_REQUIRED/); assert.doesNotMatch(html, /Create invitation/);
  }
  assert.match(renderToStaticMarkup(createElement(UserManagement, { client: {} })), /Hosted administrator/);
});
test('administrator invite, role edit and revocation use server API and never invent delivery', async t => {
  const old = globalThis.IS_REACT_ACT_ENVIRONMENT, oldWindow = globalThis.window; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.window = { location: { href: 'https://example.test/app' } };
  let renderer; const calls = [];
  const user = { id: 'alice', namespaceId: 'default', name: 'Alice', role: 'reader' };
  let invitations = [];
  const client = { async listUsers() { return [user]; }, async listInvitations() { return invitations; }, async inviteUser(body) { calls.push(body); invitations = [{ ...body, expiresAt: '2030-01-01T00:00:00Z' }]; return { invitation: invitations[0], token: 'a'.repeat(64) }; }, async saveUser(id, body) { calls.push({ id, ...body }); Object.assign(user, body); }, async revokeInvitation(id) { calls.push({ revoke: id }); invitations = []; } };
  await act(() => { renderer = create(createElement(AccessProvider, { access: access('administrator') }, createElement(UserManagement, { client }))); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = old; globalThis.window = oldWindow; });
  const form = () => renderer.root.findByProps({ 'aria-label': 'Invite user' });
  await act(() => form().findAllByType('input')[0].props.onChange({ target: { value: 'invited' } }));
  await act(() => form().findAllByType('input')[1].props.onChange({ target: { value: 'Invited' } }));
  await act(() => form().findByType('select').props.onChange({ target: { value: 'author_ai' } }));
  await act(() => form().props.onSubmit({ preventDefault() {} }));
  assert.deepEqual(calls[0], { id: 'invited', name: 'Invited', role: 'author_ai' });
  assert.equal(renderer.root.findByProps({ readOnly: true }).props.value, `https://example.test/app#invite=${'a'.repeat(64)}`);
  const edit = renderer.root.findByProps({ 'aria-label': 'Manage alice' });
  await act(() => edit.findByType('select').props.onChange({ target: { value: 'reader_ai' } }));
  await act(() => edit.props.onSubmit({ preventDefault() {} }));
  assert.deepEqual(calls[1], { id: 'alice', name: 'Alice', role: 'reader_ai' });
  await act(() => renderer.root.findAllByType('button').find(b => JSON.stringify(b.props.children).includes('Revoke')).props.onClick());
  assert.deepEqual(calls[2], { revoke: 'invited' });
  assert.equal(renderer.root.findAllByProps({ readOnly: true }).length, 0);
});
test('invitation acceptance is explicit, surfaces authentication errors and sends only token', async t => {
  const old = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer, accepted = false, sent;
  const client = { async acceptInvitation(token) { sent = token; throw new Error('SECURITY_INVITATION_PRINCIPAL_MISMATCH'); } };
  await act(() => { renderer = create(createElement(AcceptInvitation, { token: 'synthetic-token', client, onAccepted() { accepted = true; } })); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = old; });
  assert.equal(sent, undefined);
  await act(() => renderer.root.findByType('button').props.onClick());
  assert.equal(sent, 'synthetic-token'); assert.equal(accepted, false);
  assert.match(JSON.stringify(renderer.toJSON()), /SECURITY_INVITATION_PRINCIPAL_MISMATCH/);
});
