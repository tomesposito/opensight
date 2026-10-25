import test from 'node:test';
import assert from 'node:assert/strict';
import { database } from './hosted-helpers.mjs';
import { HostedProvisioning } from '../dist/hosted-provisioning.js';
import { StubMailTransport } from '../dist/mail.js';
import { SqliteMetadataDatabase } from '../dist/metadata-db.js';
import { initializeMetadata, ensureTenantNaming } from '../dist/metadata-schema.js';
import { deriveWorkspaceSlug } from '../dist/workspace-naming.js';

const input = (name, slug) => ({ name, ...(slug === undefined ? {} : { slug }), administrator: { email: 'admin@example.test', name: 'Administrator' } });
async function setup(t) {
  const f = await database(t), mail = new StubMailTransport();
  return { ...f, mail, provision: new HostedProvisioning(f.db, f.config, mail) };
}
const tenant = (db, id) => db.transaction(c => c.query('SELECT * FROM h1_tenants WHERE tenant_id = ?', [id])).then(rows => rows[0]);
const counts = db => db.transaction(async c => {
  const result = {};
  for (const table of ['h1_tenants', 'h1_namespaces', 'h1_revisions', 'h1_resources', 'h1_operations', 'h1_outbox', 'h2_identities', 'h2_memberships', 'h2_invitations', 'h2_onboarding', 'h8_audit']) {
    result[table] = Number((await c.query(`SELECT COUNT(*) AS n FROM ${table}`))[0].n);
  }
  return result;
});

test('Issue #146 item 1: provision stores validated names, derived/explicit slugs, and keeps namespace semantics', async t => {
  const f = await setup(t);
  for (const [name, slug, expected] of [['  Sales & Ops!  ', undefined, 'sales-ops'], ['Another workspace', 'custom-name', 'custom-name'], ['東京', undefined, null], ['😀', undefined, null], ['A'.repeat(63) + ' !tail', undefined, 'a'.repeat(63)]]) {
    const op = await f.provision.provision(`name-${f.mail.messages.length}`, input(name, slug)), row = await tenant(f.db, op.tenantId);
    assert.equal(row.display_name, name); assert.equal(row.slug, expected);
    assert.equal((await f.db.transaction(c => c.query('SELECT name FROM h1_namespaces WHERE namespace_id = ?', [op.namespaceId])))[0].name, name);
  }
  assert.equal(deriveWorkspaceSlug('A'.repeat(70)), 'a'.repeat(64));
});

test('Issue #146 item 1: invalid explicit slugs and labels fail with METADATA_INVALID 400', async t => {
  const f = await setup(t);
  for (const slug of ['', null, 42, 'UPPER', '-bad', 'bad-', 'two--parts', 'with space', 'a/b', 'é', 'a'.repeat(65)]) {
    await assert.rejects(f.provision.provision('invalid', input('Valid name', slug)), { code: 'METADATA_INVALID', status: 400 });
  }
  for (const name of ['', '  ', 'bad\nname', 'x'.repeat(513)]) {
    await assert.rejects(f.provision.provision('invalid-name', input(name)), { code: 'METADATA_INVALID', status: 400 });
  }
  assert.equal((await counts(f.db)).h1_tenants, 0);
});

test('Issue #146 item 1: slug conflicts are named and atomic; retries preserve input checksums', async t => {
  const f = await setup(t), raw = input('Sales', 'sales'), first = await f.provision.provision('first', raw);
  const before = await counts(f.db);
  assert.deepEqual(await f.provision.provision('first', raw), first);
  assert.deepEqual(await counts(f.db), before); assert.equal(f.mail.messages.length, 1);
  await assert.rejects(f.provision.provision('first', { ...raw, slug: 'changed' }), { code: 'OPERATION_ID_REUSED' });
  await assert.rejects(f.provision.provision('second', input('Different name', 'sales')), { code: 'TENANT_SLUG_CONFLICT', status: 409 });
  await assert.rejects(f.provision.provision('derived-conflict', input('Sales!')), { code: 'TENANT_SLUG_CONFLICT', status: 409 });
  assert.deepEqual(await counts(f.db), before); assert.equal(f.mail.messages.length, 1);
});

test('Issue #146 item 1: existing SQLite tenants upgrade idempotently and NULL slugs coexist', async t => {
  const db = new SqliteMetadataDatabase(':memory:'); t.after(() => db.close());
  await db.transaction(async c => {
    await c.query('CREATE TABLE h1_tenants (tenant_id TEXT PRIMARY KEY, state TEXT, version INTEGER, tombstone TEXT, placement TEXT, limit_policy TEXT)');
    await c.query("INSERT INTO h1_tenants VALUES ('old','active',1,NULL,NULL,NULL)");
  });
  await initializeMetadata(db); await initializeMetadata(db);
  assert.equal((await tenant(db, 'old')).display_name, null); assert.equal((await tenant(db, 'old')).slug, null);
  await db.transaction(c => c.query("INSERT INTO h1_tenants (tenant_id,state,version) VALUES ('other','active',1)"));
  await db.transaction(c => c.query("UPDATE h1_tenants SET slug = 'shared' WHERE tenant_id = 'old'"));
  await assert.rejects(db.transaction(c => c.query("UPDATE h1_tenants SET slug = 'shared' WHERE tenant_id = 'other'")), { code: 'METADATA_CONFLICT' });
});

test('Issue #146 item 1: Postgres upgrade guards each column and installs the unique index idempotently', async () => {
  const columns = new Set(['tenant_id']), statements = [];
  const c = { async query(sql) {
    statements.push(sql);
    if (sql.includes('information_schema.columns')) { assert.match(sql, /current_schema\(\)/); return [...columns].map(name => ({ name })); }
    const match = /ALTER TABLE h1_tenants ADD COLUMN (display_name|slug) TEXT$/.exec(sql);
    if (match) { assert.equal(columns.has(match[1]), false); columns.add(match[1]); }
    else assert.equal(sql, 'CREATE UNIQUE INDEX IF NOT EXISTS h1_tenants_slug ON h1_tenants(slug)');
    return [];
  } };
  await ensureTenantNaming(c, 'postgres'); await ensureTenantNaming(c, 'postgres');
  assert.equal(statements.filter(sql => sql.startsWith('ALTER')).length, 2);
  assert.equal(statements.filter(sql => sql.startsWith('CREATE UNIQUE')).length, 2);
});

test('Issue #146 item 2: invitation uses the workspace name, escapes labels, and falls back for legacy tenants', async t => {
  const f = await setup(t), op = await f.provision.provision('mail', input('Sales & <Ops>'));
  assert.match(f.mail.messages[0].html, /<p>Workspace: Sales &amp; &lt;Ops&gt;<\/p>/);
  assert.equal(f.mail.messages[0].html.includes(op.tenantId), false);
  for (const name of [null, '']) {
    await f.db.transaction(c => c.query('UPDATE h1_tenants SET display_name = ? WHERE tenant_id = ?', [name, op.tenantId]));
    await f.provision.inviteMember(`legacy-${f.mail.messages.length}`, op.tenantId, { email: `legacy-${f.mail.messages.length}@example.test`, name: 'Legacy invite', role: 'author' });
    assert.ok(f.mail.messages.at(-1).html.includes(`<p>Tenant: ${op.tenantId}</p>`));
    assert.doesNotMatch(f.mail.messages.at(-1).html, /Workspace:/);
  }
});
