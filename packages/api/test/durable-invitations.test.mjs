import test from 'node:test';
import assert from 'node:assert/strict';
import { coordinationFixture } from './coordination-helpers.mjs';
import { migrateServerless } from '../dist/serverless-migration.js';
import { DurableDispatch } from '../dist/dispatch.js';
import { DurableInvitations } from '../dist/durable-invitations.js';
import { HostedProvisioning } from '../dist/hosted-provisioning.js';
import { hostedConfig } from '../dist/hosted-config.js';
import { StubMailTransport, MailError } from '../dist/mail.js';

async function fixture(t) {
  const f = await coordinationFixture(t, { migrate: false }), env = { ...f.env, OPENSIGHT_ENTITLEMENTS: JSON.stringify(f.entitlements) };
  await migrateServerless(f.db, env, 'sqlite'); await f.open();
  const queued = [], recovered = [], transport = { recover: async e => { recovered.push(e); }, dispatch: async e => { queued.push(e); } };
  const dispatch = new DurableDispatch(f.db, f.metadata, 'test', transport, 'sqlite'), config = hostedConfig(env);
  const requestMail = { configured: false, deliveryConfigured: true, send: async () => assert.fail('request sent email') };
  const service = new DurableInvitations(dispatch, f.metadata, config, requestMail);
  const provisioning = new HostedProvisioning(f.db, config, requestMail, Date.now, undefined, undefined, service);
  const mail = new StubMailTransport(), worker = new DurableInvitations(dispatch, f.metadata, config, mail);
  return { ...f, dispatch, queued, recovered, transport, provisioning, mail, worker,
    invite: () => provisioning.inviteTenantMember(f.contexts[0], { email: 'invited@example.test', name: 'Invited', role: 'reader' }),
    rows: table => f.db.transaction(c => c.query(`SELECT * FROM ${table}`)) };
}
test('D-86 invitations prearm recovery, commit with outbox, and send once from a separate worker', async t => {
  const f = await fixture(t); const recover = f.transport.recover;
  f.transport.recover = async e => { assert.equal((await f.rows('h2_invitations')).length, 0); await recover(e); };
  const invitation = await f.invite(); assert.equal(f.recovered.length, 1); assert.equal(f.queued.length, 1); assert.equal(f.mail.messages.length, 0);
  const row = (await f.rows('h2_invitations'))[0]; assert.equal(row.delivered, 0); assert.notEqual(row.token_secret, invitation.token);
  assert.ok(!JSON.stringify(f.queued).includes(invitation.token)); assert.ok(!JSON.stringify(f.queued).includes('invited@example.test'));
  await f.worker.run(f.queued[0]); await f.worker.run(f.queued[0]);
  assert.equal(f.mail.messages.length, 1); assert.deepEqual(f.mail.messages[0].to, ['invited@example.test']); assert.ok(f.mail.messages[0].html.includes(invitation.token));
  assert.equal((await f.rows('h2_invitations'))[0].delivered, 1); assert.equal((await f.rows('sr_execution'))[0].state, 'completed');
});
test('D-86 recovery acknowledgement failure accepts no invitation or mail obligation', async t => {
  const f = await fixture(t); f.transport.recover = async () => { throw Error('queue unavailable'); };
  await assert.rejects(f.invite(), /queue unavailable/); assert.equal((await f.rows('h2_invitations')).length, 0); assert.equal((await f.rows('sr_outbox')).length, 0);
});
test('D-86 a lost immediate queue hint is recovered from the prearmed durable outbox', async t => {
  const f = await fixture(t); f.transport.dispatch = async () => { throw Error('acknowledgement lost'); };
  const created = await f.invite(); assert.ok(created.token); assert.equal((await f.rows('sr_outbox'))[0].state, 'pending');
  f.transport.dispatch = async e => { f.queued.push(e); }; await f.dispatch.recover(f.recovered[0]);
  await f.worker.run(f.queued[0]); assert.equal(f.mail.messages.length, 1);
});
test('D-86 invitation and outbox insertion roll back together', async t => {
  const f = await fixture(t);
  await f.db.transaction(c => c.query("CREATE TRIGGER break_invitation_event BEFORE INSERT ON sr_outbox BEGIN SELECT RAISE(ABORT, 'outbox unavailable'); END"));
  await assert.rejects(f.invite()); assert.equal((await f.rows('h2_invitations')).length, 0); assert.equal((await f.rows('h2_onboarding')).length, 0);
  assert.equal((await f.rows('sr_outbox')).length, 0); assert.equal(f.mail.messages.length, 0);
});
test('D-86 revocation or expired epoch prevents invitation delivery', async t => {
  const f = await fixture(t), created = await f.invite();
  await f.worker.run({ ...f.queued[0], deploymentEpoch: 999 }); assert.equal(f.mail.messages.length, 0);
  await f.provisioning.revokeTenantInvitation(f.contexts[0], created.invitation.id);
  await f.worker.run(f.queued[0]); assert.equal(f.mail.messages.length, 0); assert.equal((await f.rows('sr_execution'))[0].state, 'failed');
});
test('D-86 current inviter authority is checked immediately before SMTP DATA', async t => {
  const f = await fixture(t); await f.invite();
  f.mail.send = async (_message, authorize) => {
    await f.db.transaction(async c => {
      const row = (await c.query("SELECT body FROM h1_resources WHERE tenant_id = 'tenant-one' AND kind = 'user' AND resource_id = 'admin'"))[0];
      const body = JSON.parse(row.body); body.role = 'reader'; await c.query("UPDATE h1_resources SET body = ? WHERE tenant_id = 'tenant-one' AND kind = 'user' AND resource_id = 'admin'", [JSON.stringify(body)]);
    });
    await authorize(); assert.fail('revoked inviter reached SMTP DATA');
  };
  await f.worker.run(f.queued[0]); assert.equal((await f.rows('sr_execution'))[0].state, 'failed'); assert.equal((await f.rows('h2_invitations'))[0].delivered, 0);
});
test('D-86 ambiguous SMTP outcomes remain held and cannot automatically resend', async t => {
  const f = await fixture(t); await f.invite(); let attempts = 0;
  f.mail.send = async (_message, authorize) => { await authorize(); attempts++; throw new MailError('SMTP_SEND_FAILED'); };
  await assert.rejects(f.worker.run(f.queued[0]), { code: 'SMTP_SEND_FAILED' });
  assert.equal((await f.rows('sr_execution'))[0].state, 'ambiguous');
  await assert.rejects(f.worker.run(f.queued[0]), { code: 'DELIVERY_AMBIGUOUS' });
  await assert.rejects(f.worker.replay(f.queued[0]), { code: 'DELIVERY_AMBIGUOUS' }); assert.equal(attempts, 1);
});
test('D-86 SMTP acceptance followed by a failed SQL receipt never automatically resends', async t => {
  const f = await fixture(t); await f.invite();
  await f.db.transaction(c => c.query("CREATE TRIGGER break_mail_receipt BEFORE UPDATE OF delivered ON h2_invitations WHEN NEW.delivered = 1 BEGIN SELECT RAISE(ABORT, 'receipt unavailable'); END"));
  await assert.rejects(f.worker.run(f.queued[0])); assert.equal(f.mail.messages.length, 1);
  assert.equal((await f.rows('sr_execution'))[0].state, 'sending');
  await f.db.transaction(c => c.query('UPDATE sr_execution SET lease_until = 1'));
  await assert.rejects(f.worker.run(f.queued[0]), { code: 'DELIVERY_AMBIGUOUS' }); assert.equal(f.mail.messages.length, 1);
});
