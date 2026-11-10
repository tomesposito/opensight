import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeJobs } from '../dist/job-schema.js';
import { initializeAuth } from '../dist/auth-schema.js';

/** The migration paths (runtime-migration, serverless-migration) hand the
 * initializers a transaction facade: a Database-shaped object whose
 * transaction callback receives a bare connection with NO dialect property.
 * #240: initializeJobs read `db.dialect ?? 'sqlite'` on that facade, so the
 * SQLite delivery-state upgrade ran against Postgres (42P01 sqlite_master).
 * These recording fakes pin the explicit-dialect threading in the root
 * suite, which otherwise never exercises the Postgres branch. */
const recordingDb = (dialect) => {
  const queries = [];
  const connection = { query: async (sql) => { queries.push(String(sql)); return []; } };
  const db = { durable: true, transaction: async work => work(connection), close: async () => {} };
  if (dialect !== undefined) db.dialect = dialect;
  return { db, queries };
};

test('#240 initializeJobs via a dialect-less transaction facade with explicit postgres never queries sqlite_master', async () => {
  const { db, queries } = recordingDb(undefined);
  await initializeJobs(db, 'postgres');
  assert.ok(queries.some(q => q.includes('pg_constraint')), 'postgres branch inspects pg_constraint');
  assert.ok(!queries.some(q => q.includes('sqlite_master')), 'no SQLite query on the postgres path');
});

test('#240 initializeAuth threads an explicit postgres dialect through a dialect-less facade to initializeJobs', async () => {
  const { db, queries } = recordingDb(undefined);
  await initializeAuth(db, 'postgres');
  assert.ok(queries.some(q => q.includes('pg_constraint')), 'postgres branch inspects pg_constraint');
  assert.ok(!queries.some(q => q.includes('sqlite_master')), 'no SQLite query on the postgres path');
});

test('#240 without an explicit dialect, initializeJobs still defaults to the Database dialect and then sqlite', async () => {
  const pg = recordingDb('postgres');
  await initializeJobs(pg.db);
  assert.ok(pg.queries.some(q => q.includes('pg_constraint')));
  assert.ok(!pg.queries.some(q => q.includes('sqlite_master')));

  const bare = recordingDb(undefined);
  await initializeJobs(bare.db);
  assert.ok(bare.queries.some(q => q.includes('sqlite_master')), 'sqlite default preserved for dialect-less callers');
  assert.ok(!bare.queries.some(q => q.includes('pg_constraint')));
});
