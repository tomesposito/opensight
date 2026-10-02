import { digest, seal, unseal } from './auth-crypto.js';
import { MetadataError, type Database } from './metadata-db.js';
import { decryptMetadataSecret, encryptMetadataSecret } from './metadata-secrets.js';
import { appendAudit, initializeEvents } from './hosted-events.js';
import { secretKey } from './hosted-config.js';

export async function assertEncryptionKey(db: Database, value: string): Promise<void> {
  const fingerprint = digest(secretKey(value));
  await initializeEvents(db);
  await db.transaction(async c => {
    // Serializes initial registration and rotation with H2's control row.
    await c.query('UPDATE h2_control SET id = id WHERE id = 1');
    await c.query('INSERT INTO h8_encryption VALUES (1,1,?) ON CONFLICT (id) DO NOTHING', [fingerprint]);
    const row = (await c.query('SELECT fingerprint FROM h8_encryption WHERE id = 1'))[0];
    if (row?.fingerprint !== fingerprint) throw new MetadataError('ENCRYPTION_KEY_VERSION_MISMATCH', 503);
  });
}
/** Offline only; caller holds the reference node's exclusive maintenance lock.
 * All encrypted payloads, TOTP secrets and invitation copies move together. */
export async function rotateEncryptionKey(db: Database, oldValue: string, newValue: string, maintenance: string | undefined): Promise<void> {
  if (maintenance !== 'frozen') throw new MetadataError('REFERENCE_MAINTENANCE_REQUIRED', 503);
  const oldKey = secretKey(oldValue), newKey = secretKey(newValue);
  if (oldKey.equals(newKey)) throw new MetadataError('KEY_ROTATION_INVALID');
  await assertEncryptionKey(db, oldValue);
  await db.transaction(async c => {
    await c.query('UPDATE h2_control SET id = id WHERE id = 1');
    const prior = (await c.query('SELECT * FROM h8_encryption WHERE id = 1'))[0]!;
    if (prior.fingerprint !== digest(oldKey)) throw new MetadataError('ENCRYPTION_KEY_VERSION_MISMATCH', 503);
    for (const row of await c.query("SELECT * FROM h1_resources WHERE kind = 'secret'")) {
      const scope = { tenantId: String(row.tenant_id), namespaceId: String(row.namespace_id) }, key = { kind: 'secret' as const, id: String(row.resource_id), ownerId: String(row.owner_id) };
      const body = JSON.parse(String(row.body)) as { ciphertext: string };
      const next = encryptMetadataSecret(decryptMetadataSecret(body.ciphertext, oldValue, scope, key), newValue, scope, key);
      await c.query("UPDATE h1_resources SET body = ?, version = version + 1 WHERE tenant_id = ? AND namespace_id = ? AND kind = 'secret' AND owner_id = ? AND resource_id = ?", [JSON.stringify(next), scope.tenantId, scope.namespaceId, key.ownerId, key.id]);
    }
    for (const row of await c.query('SELECT subject, totp_secret FROM h2_identities WHERE totp_secret IS NOT NULL')) {
      const aad = `totp:${row.subject}`;
      await c.query('UPDATE h2_identities SET totp_secret = ? WHERE subject = ?', [seal(unseal(String(row.totp_secret), oldKey, aad), newKey, aad), row.subject!]);
    }
    for (const row of await c.query('SELECT invitation_id, token_secret FROM h2_invitations')) {
      const aad = `invitation:${row.invitation_id}`;
      await c.query('UPDATE h2_invitations SET token_secret = ? WHERE invitation_id = ?', [seal(unseal(String(row.token_secret), oldKey, aad), newKey, aad), row.invitation_id!]);
    }
    await c.query('UPDATE h8_encryption SET version = version + 1, fingerprint = ? WHERE id = 1', [digest(newKey)]);
    await c.query('UPDATE h1_revisions SET configuration = configuration + 1');
    await c.query('UPDATE h2_sessions SET revoked = 1');
    await appendAudit(c, { operation: 'key.rotate', outcome: 'succeeded', resourceRevision: Number(prior.version) + 1 });
  });
}
