import test from 'node:test';
import assert from 'node:assert/strict';
import { Duplex } from 'node:stream';
import { smtpFromEnvironment } from '../dist/mail.js';
import { serverlessMail } from '../dist/serverless-mail.js';
import { egressEndpoints } from '../dist/egress.js';

const region = 'us-east-1', smtp = `email-smtp.${region}.api.aws`;
const env = { OPENSIGHT_SMTP_HOST: smtp, OPENSIGHT_SMTP_FROM: 'synthetic@example.test', OPENSIGHT_SMTP_SECRET_ARN: 'synthetic-secret-reference' };
const message = { to: ['reader@example.test'], subject: 'Synthetic', html: '<p>synthetic</p>', dedupeKey: 'a'.repeat(64) };

test('SR3 endpoint selection is regional, IPv6-only and refuses unknown profiles, alternate hosts and paid fallbacks', () => {
  assert.equal(egressEndpoints({}, region).sqs, `sqs.${region}.api.aws`);
  for (const bad of [{ OPENSIGHT_EGRESS_PROFILE: 'nat' }, { OPENSIGHT_EGRESS_PROFILE: 'ipv4' }, { OPENSIGHT_SMTP_PORT: '587' }]) assert.throws(() => egressEndpoints(bad, region), { code: 'EGRESS_ROUTE_UNSUPPORTED' });
  for (const bad of [{ OPENSIGHT_SQS_ENDPOINT: `https://sqs.${region}.amazonaws.com` }, { OPENSIGHT_SCHEDULER_ENDPOINT: 'https://unlisted.example.test' }, { OPENSIGHT_SMTP_HOST: 'smtp.example.test' }, { OPENSIGHT_SECRETS_ENDPOINT: `https://secretsmanager.${region}.amazonaws.com/path` }]) assert.throws(() => egressEndpoints(bad, region), { code: 'EGRESS_ENDPOINT_INVALID' });
});
test('SR3 real deployment mail resolves fresh secret versions, bounds sockets and forwards authorization on every attempt', async () => {
  let secrets = 0, sent = 0, authorized = 0;
  const aws = { region, scope: { signal: new AbortController().signal, remaining: () => 12345, own() {} }, secret: async (ref, fields) => {
    assert.equal(ref, env.OPENSIGHT_SMTP_SECRET_ARN); assert.deepEqual(fields, ['username', 'password']); return { username: 'synthetic', password: `synthetic-${++secrets}` };
  } };
  const mail = serverlessMail(aws, env, (resolved, options) => {
    assert.equal(resolved.OPENSIGHT_SMTP_PASSWORD, `synthetic-${secrets}`); assert.equal(resolved.OPENSIGHT_SMTP_HOST, smtp);
    assert.equal(options.family, 6); assert.equal(options.timeoutMs, 12345); assert.equal(options.signal, aws.scope.signal);
    return { configured: true, async send(body, authorize) { await authorize(); assert.deepEqual(body, message); sent++; } };
  });
  for (let i = 0; i < 2; i++) await mail.send(message, async () => { authorized++; });
  assert.equal(secrets, 2); assert.equal(sent, 2); assert.equal(authorized, 2);
});
test('SR3 deployment mail never selects a stub when configuration or secret resolution is unavailable', async () => {
  const aws = { region, secret: async () => { throw Error('secret unavailable'); } };
  for (const key of Object.keys(env)) {
    const config = { ...env }; delete config[key];
    const mail = serverlessMail(aws, config, () => assert.fail('factory must not run'));
    assert.equal(mail.configured, false); await assert.rejects(mail.send(message), { code: 'SMTP_NOT_CONFIGURED' });
  }
  await assert.rejects(serverlessMail(aws, env).send(message), /secret unavailable/);
});
function socketFixture(mode = 'accept') {
  const written = [], connections = [];
  let body = false;
  const socket = new Duplex({ read() {}, write(chunk, _encoding, done) {
    const line = chunk.toString(); written.push(line);
    if (line.startsWith('QUIT')) { done(); this.destroy(); return; }
    if (body) { body = false; if (mode === 'lost-data-ack') { done(); this.destroy(Error('uncertain acceptance')); return; } this.push('250 accepted\r\n'); }
    else if (line.startsWith('DATA')) { body = true; this.push('354 proceed\r\n'); }
    else this.push('250 ok\r\n');
    done();
  } });
  socket.setTimeout = () => socket;
  const connect = options => { connections.push(options); queueMicrotask(() => { if (mode === 'certificate') socket.destroy(Error('certificate rejected')); else socket.push('220 synthetic\r\n'); }); return socket; };
  const transport = smtpFromEnvironment({ OPENSIGHT_SMTP_HOST: smtp, OPENSIGHT_SMTP_FROM: env.OPENSIGHT_SMTP_FROM }, { family: 6, timeoutMs: 1000, connect });
  return { transport, written, connections, socket };
}
test('SR3 SMTP protocol authorizes immediately before DATA and treats DATA acceptance as success despite lost QUIT', async () => {
  const f = socketFixture(); let checks = 0;
  await f.transport.send(message, async () => { checks++; assert.ok(f.written.at(-1).startsWith('RCPT TO')); assert.ok(!f.written.includes('DATA\r\n')); });
  assert.equal(checks, 1); assert.equal(f.connections.length, 1); assert.equal(f.connections[0].family, 6);
  assert.equal(f.connections[0].autoSelectFamily, false); assert.equal(f.connections[0].servername, smtp); assert.equal(f.connections[0].rejectUnauthorized, true);
  assert.ok(f.written.some(s => s.includes(`Message-ID: <${message.dedupeKey}@opensight.local>`))); assert.ok(f.socket.destroyed);
});
test('SR3 SMTP denies before DATA, bounds ambiguous acceptance and never retries IPv4 or disables TLS verification', async () => {
  const denied = socketFixture();
  await assert.rejects(denied.transport.send(message, async () => { throw Object.assign(Error(), { code: 'JOB_REVISED' }); }), { code: 'JOB_REVISED' });
  assert.ok(!denied.written.includes('DATA\r\n')); assert.ok(denied.socket.destroyed);
  for (const mode of ['lost-data-ack', 'certificate']) {
    const f = socketFixture(mode); await assert.rejects(f.transport.send(message), { code: 'SMTP_SEND_FAILED' }); assert.equal(f.connections.length, 1);
  }
});
