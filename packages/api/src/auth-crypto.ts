import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { MetadataError } from './metadata-db.js';

export const digest = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
export function equal(a: string, b: string): boolean {
  // Fixed-size digests avoid leaking the length of the stored credential.
  return timingSafeEqual(Buffer.from(digest(a), 'hex'), Buffer.from(digest(b), 'hex'));
}
let activeDerivations = 0;
async function derive(password: string, salt: Buffer): Promise<Buffer> {
  if (activeDerivations >= 2) throw new MetadataError('AUTH_BUSY', 429);
  activeDerivations++;
  try { return await new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 32, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (error, result) => error ? reject(error) : resolve(result))); }
  finally { activeDerivations--; }
}
export function passwordInput(value: unknown): string {
  if (typeof value !== 'string' || value.length < 15 || Buffer.byteLength(value) > 1024) throw new MetadataError('PASSWORD_INVALID', 400);
  return value;
}
export async function hashPassword(password: string): Promise<string> {
  passwordInput(password);
  const salt = randomBytes(16), derived = await derive(password, salt);
  return `scrypt$131072$8$1$${salt.toString('base64')}$${derived.toString('base64')}`;
}
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const parts = hash.split('$');
  if (parts.length !== 6 || parts.slice(0, 4).join('$') !== 'scrypt$131072$8$1') throw new MetadataError('CREDENTIAL_UNAVAILABLE', 503);
  const salt = Buffer.from(parts[4]!, 'base64'), expected = Buffer.from(parts[5]!, 'base64');
  if (salt.length !== 16 || expected.length !== 32 || salt.toString('base64') !== parts[4] || expected.toString('base64') !== parts[5]) throw new MetadataError('CREDENTIAL_UNAVAILABLE', 503);
  return timingSafeEqual(await derive(password, salt), expected);
}
/** AES-GCM binds each envelope to its purpose and immutable subject/invitation ID. */
export function seal(value: string, key: Buffer, associated: string): string {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(associated));
  const bytes = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), bytes].map(v => v.toString('base64')).join('.');
}
export function unseal(value: string, key: Buffer, associated: string): string {
  try {
    const parts = value.split('.').map(v => Buffer.from(v, 'base64'));
    if (parts.length !== 3 || parts[0]!.length !== 12 || parts[1]!.length !== 16) throw Error();
    const cipher = createDecipheriv('aes-256-gcm', key, parts[0]!);
    cipher.setAAD(Buffer.from(associated)); cipher.setAuthTag(parts[1]!);
    return Buffer.concat([cipher.update(parts[2]!), cipher.final()]).toString('utf8');
  } catch { throw new MetadataError('CREDENTIAL_UNAVAILABLE', 503); }
}
export function base32(bytes: Buffer): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0, value = 0, text = '';
  for (const byte of bytes) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { bits -= 5; text += alphabet[(value >>> bits) & 31]; } }
  if (bits) text += alphabet[(value << (5 - bits)) & 31];
  return text;
}
export function totp(secret: Buffer, step: number, digits = 6): string {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', secret).update(counter).digest(), offset = mac[19]! & 15;
  return ((mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits).toString().padStart(digits, '0');
}
export function verifyTotp(secret: Buffer, code: string, now: number, lastStep: number): number | undefined {
  if (!/^\d{6}$/.test(code)) return undefined;
  const current = Math.floor(now / 30000); let found: number | undefined;
  for (const step of [current - 1, current, current + 1]) if (step >= 0 && equal(totp(secret, step), code) && step > lastStep) found = step;
  return found;
}
