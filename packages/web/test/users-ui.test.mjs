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
test('Issue 150: tenant administrators see invitations, seven-day expiry and the operator removal restriction', () => {
  const a = access('administrator'); a.session.tenantId = 'tenant';
  const html = renderToStaticMarkup(createElement(AccessProvider, { access: a }, createElement(UserManagement, { client: {} })));
  assert.match(html, /Create invitation/); assert.match(html, /Email address/); assert.match(html, /Display name/);
  assert.match(html, /7 days/); assert.match(html, /transferring or stopping/); assert.match(html, /Tenant administrator sessions cannot remove members/);
  assert.doesNotMatch(html, /Membership in this hosted tenant is managed by the operator|#operator-users|Sign-in user ID|does not create login credentials or send email/);
  for (const label of ['Administrator', 'Author', 'Author AI', 'Reader', 'Reader AI']) assert.ok(html.includes(`>${label}</option>`));
});
test('administrator invite, role edit and revocation use server API and never invent delivery', async t => {
  const old = globalThis.IS_REACT_ACT_ENVIRONMENT, oldWindow = globalThis.window; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.window = { location: { href: 'https://example.test/app' } };
  let renderer; const calls = [];
  const user = { id: 'alice', namespaceId: 'default', name: 'Alice', role: 'reader' };
  let invitations = [];
  const client = { async listUsers() { return [user]; }, async listInvitations() { return invitations; }, async inviteUser(body) { calls.push(body); invitations = [{ ...body, expiresAt: '2030-01-01T00:00:00Z' }]; return { invitation: invitations[0], token: 'a'.repeat(64) }; }, async saveUser(id, body) { calls.push({ id, ...body }); Object.assign(user, body); }, async deleteUser(id) { calls.push({ remove: id }); }, async revokeInvitation(id) { calls.push({ revoke: id }); invitations = []; } };
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
  await act(() => renderer.root.findAllByType('button').find(b => JSON.stringify(b.props.children).includes('Remove')).props.onClick());
  assert.deepEqual(calls[3], { remove: 'alice' });
});
test('Issue 150: tenant administrator creates and revokes by email, lists users without removal, and forgets the shared link on remount', async t => {
  const old = globalThis.IS_REACT_ACT_ENVIRONMENT, oldWindow = globalThis.window; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.window = { location: { href: 'https://example.test/app?old=1#users' } };
  const a = access('administrator'); a.session.tenantId = 'tenant';
  let renderer, pending = []; const calls = [];
  const client = {
    async listUsers() { return [{ id: 'admin', name: 'Workspace admin', role: 'administrator' }, { id: 'reader', name: 'Workspace reader', role: 'reader_ai' }]; },
    async listInvitations() { return pending; },
    async inviteUser(body) { calls.push(body); pending = [{ id: 'opaque-invitation', ...body, expiresAt: '2030-01-01T00:00:00Z' }]; return { invitation: pending[0], token: 'synthetic-token' }; },
    async revokeInvitation(id) { calls.push({ revoke: id }); pending = []; },
    async deleteUser() { assert.fail('Tenant UI must not remove members'); },
    async saveUser() { assert.fail('Tenant UI must not offer unsupported member edits'); },
  };
  const mount = () => { renderer = create(createElement(AccessProvider, { access: a }, createElement(UserManagement, { client }))); };
  t.after(async () => { await act(() => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = old; globalThis.window = oldWindow; });
  await act(mount);
  assert.match(JSON.stringify(renderer.toJSON()), /Workspace reader/);
  assert.equal(renderer.root.findAllByType('button').some(b => /Remove|Save/.test(JSON.stringify(b.props.children))), false);
  const form = () => renderer.root.findByProps({ 'aria-label': 'Invite user' });
  assert.equal(form().findAllByType('input')[0].props.type, 'email');
  await act(() => form().findAllByType('input')[0].props.onChange({ target: { value: 'reader@example.test' } }));
  await act(() => form().findAllByType('input')[1].props.onChange({ target: { value: 'Invited reader' } }));
  await act(() => form().findByType('select').props.onChange({ target: { value: 'reader_ai' } }));
  await act(() => form().props.onSubmit({ preventDefault() {} }));
  assert.deepEqual(calls[0], { email: 'reader@example.test', name: 'Invited reader', role: 'reader_ai' });
  assert.equal(renderer.root.findByProps({ readOnly: true }).props.value, 'https://example.test/app#invite=synthetic-token');
  assert.match(JSON.stringify(renderer.root.findByProps({ role: 'status' }).props.children), /Invitation created/);
  await act(() => renderer.unmount()); await act(mount);
  assert.equal(renderer.root.findAllByProps({ readOnly: true }).length, 0);
  assert.match(JSON.stringify(renderer.toJSON()), /reader@example.test/);
  await act(() => renderer.root.findAllByType('button').find(b => JSON.stringify(b.props.children).includes('Revoke')).props.onClick());
  assert.deepEqual(calls[1], { revoke: 'opaque-invitation' });
  assert.match(JSON.stringify(renderer.toJSON()), /No pending invitations/);
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
