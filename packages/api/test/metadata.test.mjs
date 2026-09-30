import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SqliteMetadataDatabase } from '../dist/metadata-db.js';
import { initializeMetadata } from '../dist/metadata-schema.js';

test('H1 tenant/namespace uniqueness and composite foreign keys survive rollback', async () => {
  const db = new SqliteMetadataDatabase(':memory:');
  try {
    await initializeMetadata(db);
    await db.transaction(async c => {
      for (const t of ['a', 'b']) await c.query("INSERT INTO h1_tenants VALUES (?, 'provisioning', 1, NULL, NULL, NULL)", [t]);
      await c.query("INSERT INTO h1_namespaces VALUES ('one', 'a', 'One')");
    });
    for (const sql of ["INSERT INTO h1_namespaces VALUES ('two', 'a', 'Two')", "INSERT INTO h1_namespaces VALUES ('one', 'b', 'One')"])
      await assert.rejects(db.transaction(c => c.query(sql)), { code: 'METADATA_CONFLICT' });
    await assert.rejects(db.transaction(c => c.query("INSERT INTO h1_revisions VALUES ('b','one',1,1,1)")), { code: 'METADATA_REFERENCE_INVALID' });
    await db.transaction(async c => assert.equal((await c.query('SELECT * FROM h1_namespaces')).length, 1));
  } finally { await db.close(); }
});
