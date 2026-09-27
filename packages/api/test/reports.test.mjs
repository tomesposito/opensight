import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareFixtures } from '../../web/scripts/prepare-fixtures.mjs';
import { compileVisual } from '@opensight/web/compiler';
import { AutomationStore } from '../dist/automation-store.js';
import { emptyRefreshState } from '../dist/refresh.js';
import { assembleReport, ReportService } from '../dist/reports.js';
import { StubMailTransport, smtpFromEnvironment, MailError } from '../dist/mail.js';
import { Scheduler } from '../dist/schedule.js';
import { interval, startApi } from './automation-helpers.mjs';
const fixtures = await prepareFixtures();
const sales = fixtures.find(f => f.id === 'renderable-sales');
const snapshot = () => ({ dashboardId: 'sales-dashboard', title: '<Sales & profit>', capturedAt: '2026-09-27T00:00:00.000Z', visuals: sales.sheets.flatMap(s => s.visuals.map(compileVisual)) });
const subscription = () => ({ dashboardId: 'sales-dashboard', enabled: true, schedule: interval, recipients: ['reader@example.com'] });

test('report HTML uses compiler cells/options, escaped content and unavailable/empty states', () => {
  const data = snapshot();
  const html = assembleReport(data);
  assert.match(html, /&lt;Sales &amp; profit&gt;/); assert.match(html, /2026-09-27T00:00:00.000Z/);
  for (const visual of data.visuals) assert.ok(html.includes(visual.model.title.replaceAll('&', '&amp;')));
  const input = structuredClone(sales.sheets[0].visuals.find(v => v.definition.BarChartVisual));
  input.rows = null; assert.match(assembleReport({ ...data, visuals: [compileVisual(input)] }), /Data unavailable/);
  input.rows = []; assert.match(assembleReport({ ...data, visuals: [compileVisual(input)] }), /No results/);
  input.rows = [{ region: '<img src=x onerror=alert(1)>', revenue: 5 }];
  const escaped = assembleReport({ ...data, visuals: [compileVisual(input)] });
  assert.match(escaped, /&lt;img/); assert.doesNotMatch(escaped, /<img|<script/);
});
test('report scheduler with fake timers delivers through stub and records run history', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: new Date('2026-09-27T00:00:00Z') });
  const store = await AutomationStore.load(emptyRefreshState()), mail = new StubMailTransport();
  const reports = new ReportService(store, { has: () => true, capture: async () => snapshot() }, mail);
  await reports.put('user', 'daily', subscription());
  const scheduler = new Scheduler(() => reports.tick()); scheduler.start(); await scheduler.idle(); t.after(() => scheduler.stop());
  t.mock.timers.tick(60000); await scheduler.idle();
  assert.equal(mail.messages.length, 1); assert.deepEqual(mail.messages[0].to, ['reader@example.com']);
  assert.match(mail.messages[0].html, /<table/); assert.equal(reports.history('user', 'daily')[0].state, 'sent');
  await reports.put('user', 'daily', { ...subscription(), enabled: false }); t.mock.timers.tick(60000); await scheduler.idle(); assert.equal(mail.messages.length, 1);
});
test('SMTP is environment-only, disabled by default, and validates without opening connections', async () => {
  const missing = smtpFromEnvironment({}); assert.equal(missing.configured, false);
  await assert.rejects(missing.send({ to: ['reader@example.com'], subject: 'x', html: '' }), e => e.code === 'SMTP_NOT_CONFIGURED');
  for (const env of [{ OPENSIGHT_SMTP_HOST: 'smtp.example.com' }, { OPENSIGHT_SMTP_HOST: 'smtp.example.com', OPENSIGHT_SMTP_FROM: 'bad' }, { OPENSIGHT_SMTP_HOST: 'smtp.example.com', OPENSIGHT_SMTP_FROM: 'reports@example.com', OPENSIGHT_SMTP_PORT: '0' }, { OPENSIGHT_SMTP_HOST: 'smtp.example.com', OPENSIGHT_SMTP_FROM: 'reports@example.com', OPENSIGHT_SMTP_SECURE: 'false' }]) assert.throws(() => smtpFromEnvironment(env));
  assert.equal(smtpFromEnvironment({ OPENSIGHT_SMTP_HOST: 'smtp.example.com', OPENSIGHT_SMTP_FROM: 'reports@example.com' }).configured, true);
});
test('missing SMTP, assembly failures and transport failures are recorded without leaking causes', async () => {
  for (const [mail, capture, code] of [
    [smtpFromEnvironment({}), async () => snapshot(), 'SMTP_NOT_CONFIGURED'],
    [new StubMailTransport(), async () => { throw new Error('/private/source'); }, 'SNAPSHOT_FAILED'],
    [{ configured: true, async send() { throw new MailError('SMTP_SEND_FAILED'); } }, async () => snapshot(), 'SMTP_SEND_FAILED'],
  ]) {
    const reports = new ReportService(await AutomationStore.load(emptyRefreshState()), { has: () => true, capture }, mail);
    await reports.put('user', 'report', subscription()); const run = await reports.run('user', 'report');
    assert.equal(run.state, 'failed'); assert.equal(run.error.code, code); assert.doesNotMatch(JSON.stringify(run), /private/);
  }
});
test('subscription API validates resources, scopes owners, assembles real DuckDB rows and delivers stub mail', async t => {
  const { request, mail } = await startApi(t), base = '/api/users/reader/subscriptions/report';
  for (const change of [{ recipients: [] }, { recipients: ['bad'] }, { recipients: ['a@example.com\r\nBcc:x@example.com'] }, { recipients: ['a@example.com', 'A@example.com'] }, { schedule: { ...interval, timeZone: 'bad' } }, { smtpPassword: 'forbidden' }, { userId: 'other' }]) assert.equal((await request(base, 'PUT', { ...subscription(), ...change })).status, 400);
  assert.equal((await request(base, 'PUT', { ...subscription(), dashboardId: 'unknown' })).status, 404);
  assert.equal((await request(base, 'PUT', subscription())).status, 200);
  assert.equal((await (await request('/api/users/reader/subscriptions')).json()).length, 1);
  assert.equal((await request('/api/users/other/subscriptions/report')).status, 404);
  const run = await (await request(`${base}/runs`, 'POST')).json(); assert.equal(run.state, 'sent', JSON.stringify(run));
  assert.equal(mail.messages.length, 1); assert.match(mail.messages[0].html, /Sales &lt;report&gt;/); assert.match(mail.messages[0].html, />500</);
  assert.deepEqual(await (await request(`${base}/runs/${run.id}`)).json(), run);
  assert.equal((await request('/api/users/other/subscriptions/report/runs')).status, 404);
  assert.equal((await request(`${base}?extra=1`)).status, 400);
  assert.equal((await request(base, 'DELETE')).status, 200);
  assert.equal((await (await request(`${base}/runs`)).json()).length, 1);
});
