import { sourceFixture } from './source-helpers.mjs';
import { initializeAuth } from '../dist/auth-schema.js';
import { initializeJobs } from '../dist/job-schema.js';
import { JobStore } from '../dist/job-store.js';
import { JobRunner } from '../dist/job-runner.js';
import { StubMailTransport } from '../dist/mail.js';
export const schedule = { kind: 'interval', minutes: 1, timeZone: 'UTC' };
export const report = { kind: 'report', dashboardId: 'dashboard', recipients: ['other'], enabled: true, schedule };
export const refresh = { kind: 'refresh', target: { kind: 'dataset', id: 'dataset' }, enabled: true, schedule };
export const executor = () => ({ begin() {}, async authorize() {}, async execute() { return {}; }, async render(c) { return { subject: 'Synthetic report', html: `<p>${c.namespaceId}/${c.userId}</p>` }; } });
export async function jobFixture(t, execute = executor(), mail = new StubMailTransport(), clock) {
  const f = await sourceFixture(t);
  await initializeAuth(f.db); await initializeJobs(f.db);
  await f.db.transaction(async c => {
    for (const ns of ['one', 'two']) for (const user of ['admin', 'other']) {
      const subject = `${ns}-${user}`;
      await c.query("INSERT INTO h2_identities (subject,email,status) VALUES (?,?,'active')", [subject, `${subject}@example.test`]);
      await c.query("INSERT INTO h2_memberships (subject,tenant_id,namespace_id,user_id,status) VALUES (?,?,?,?,'active')", [subject, `tenant-${ns}`, ns, user]);
    }
  });
  const store = new JobStore(f.db, f.metadata, clock ?? (() => new Date(f.clock()))), runner = new JobRunner(store, execute, mail);
  const put = async (id, spec = report, ns = 'one', user = 'admin', version = 0) => store.put(await f.login(ns, user), id, spec, version, (c, s) => execute.authorize(c, s));
  return { ...f, store, runner, executor: execute, mail, put };
}
