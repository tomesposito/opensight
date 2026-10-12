import { manifestFixture } from './manifest-helpers.mjs';
import { migrateDispatch } from '../dist/dispatch-schema.js';
import { migrateExecutions } from '../dist/execution-schema.js';
import { DurableDispatch } from '../dist/dispatch.js';
import { DurableExecution } from '../dist/durable-execution.js';
import { JobStore } from '../dist/job-store.js';
import { DurableJobs } from '../dist/durable-jobs.js';
import { StubMailTransport } from '../dist/mail.js';
import { executor, report } from './job-helpers.mjs';

export async function sr3Fixture(t, options = {}) {
  const f = await manifestFixture(t);
  await migrateDispatch(f.db, 'test', 'frozen', 'sqlite');
  await migrateExecutions(f.db, 'test', 'frozen', 'sqlite');
  await f.db.transaction(async c => {
    for (const ns of ['one', 'two']) {
      await c.query("INSERT INTO h2_identities (subject,email,status) VALUES (?,?,'active')", [`${ns}-other`, `${ns}-other@example.test`]);
      await c.query("INSERT INTO h2_memberships (subject,tenant_id,namespace_id,user_id,status) VALUES (?,?,?,'other','active')", [`${ns}-other`, `tenant-${ns}`, ns]);
    }
  });
  await f.open();
  const faults = { query: undefined, beforeCommit: undefined, afterCommit: undefined }, time = { now: Date.now() }, queries = [];
  const db = { durable: true, close: async () => {}, transaction: async work => {
    const result = await f.db.transaction(async c => {
      const result = await work({ query: async (sql, values) => {
        queries.push(sql); await faults.query?.(sql, values);
        if (sql.includes(' AS now_ms')) return [{ now_ms: time.now }];
        return c.query(sql, values);
      } });
      await faults.beforeCommit?.(); return result;
    });
    await faults.afterCommit?.(); return result;
  } };
  const calls = [], transport = { recover: async envelope => { calls.push({ envelope }); }, dispatch: async (envelope, event) => { calls.push({ envelope, event }); } };
  const dispatch = new DurableDispatch(db, f.metadata, 'test', transport, 'sqlite'), execution = new DurableExecution(dispatch);
  const store = new JobStore(db, f.metadata, () => new Date(time.now), dispatch), mail = options.mail ?? new StubMailTransport(), render = options.executor ?? executor();
  const jobs = new DurableJobs(store, render, mail);
  return { ...f, db, rawDb: f.db, faults, time, queries, calls, transport, dispatch, execution, store, mail, executor: render, jobs,
    put: (id = 'report', spec = report, version = 0) => store.put(f.contexts[0], id, spec, version, (c, s) => render.authorize(c, s)),
    event: async kind => {
      const rows = await f.rows('sr_outbox'); const row = rows.findLast(r => r.kind === kind);
      if (!row) throw Error(`missing ${kind}`);
      return { version: 1, deploymentEpoch: Number(row.control_epoch), eventId: row.event_id, kind: 'execute' };
    },
    sql: (sql, args) => f.db.transaction(c => c.query(sql, args)),
  };
}
