import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { MetadataError } from './metadata-db.js';
import type { ResourceKey, Scope } from './metadata-resources.js';

function key(value: string): Buffer {
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length !== 32 || bytes.toString('base64') !== value) throw new MetadataError('METADATA_ENCRYPTION_KEY_REQUIRED', 503);
  return bytes;
}
function aad(scope: Scope, secret: ResourceKey): Buffer { return Buffer.from(JSON.stringify([2, scope.tenantId, scope.namespaceId, secret.ownerId ?? '', secret.id])); }
export function encryptMetadataSecret(value: string, encryptionKey: string, scope: Scope, secret: ResourceKey): { ciphertext: string; aadVersion: 2 } {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(encryptionKey), iv);
  cipher.setAAD(aad(scope, secret));
  const bytes = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return { ciphertext: [iv, cipher.getAuthTag(), bytes].map(v => v.toString('base64')).join('.'), aadVersion: 2 };
}
function decrypt(ciphertext: string, encryptionKey: string, associated: Buffer): string {
  try {
    const parts = ciphertext.split('.'); if (parts.length !== 3) throw new Error();
    const [iv, tag, bytes] = parts.map(p => Buffer.from(p, 'base64'));
    const cipher = createDecipheriv('aes-256-gcm', key(encryptionKey), iv!);
    cipher.setAAD(associated); cipher.setAuthTag(tag!);
    return Buffer.concat([cipher.update(bytes!), cipher.final()]).toString('utf8');
  } catch { throw new MetadataError('METADATA_SECRET_UNAVAILABLE', 503); }
}
export function decryptMetadataSecret(ciphertext: string, encryptionKey: string, scope: Scope, secret: ResourceKey): string {
  return decrypt(ciphertext, encryptionKey, aad(scope, secret));
}
export function migrateAISecret(saved: { namespaceId: string; provider: string; baseUrl?: string; encryptedKey: string }, encryptionKey: string, scope: Scope): { ciphertext: string; aadVersion: 2 } {
  const plaintext = decrypt(saved.encryptedKey, encryptionKey, Buffer.from(JSON.stringify([saved.namespaceId, saved.provider, saved.baseUrl ?? ''])));
  return encryptMetadataSecret(plaintext, encryptionKey, scope, { kind: 'secret', id: 'ai-provider' });
}
