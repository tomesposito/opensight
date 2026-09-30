import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { hashPassword, verifyPassword, seal, unseal, equal, totp, verifyTotp, base32 } from '../dist/auth-crypto.js';
import { hostedConfig } from '../dist/hosted-config.js';
import { SqliteMetadataDatabase } from '../dist/metadata-db.js';
import { initializeAuth } from '../dist/auth-schema.js';
import { environment, database } from './hosted-helpers.mjs';

test('H2 config requires HTTPS origin, explicit lifetimes, issuer/audience and separate strong environment keys', () => {
  const env = environment(); assert.equal(hostedConfig(env).origin, env.OPENSIGHT_PUBLIC_ORIGIN);
  for (const field of Object.keys(env)) assert.throws(() => hostedConfig({ ...env, [field]: undefined }), { code: 'HOSTED_CONFIG_INVALID' });
  for (const origin of ['http://opensight.example', 'https://opensight.example/', 'https://opensight.example/path', 'https://user@opensight.example', 'null']) assert.throws(() => hostedConfig({ ...env, OPENSIGHT_PUBLIC_ORIGIN: origin }), { code: 'HOSTED_CONFIG_INVALID' });
  for (const value of ['0', '-1', 'Infinity', '86401']) assert.throws(() => hostedConfig({ ...env, OPENSIGHT_SESSION_SECONDS: value }), { code: 'HOSTED_CONFIG_INVALID' });
  assert.throws(() => hostedConfig({ ...env, OPENSIGHT_AUTH_SIGNING_KEY: env.OPENSIGHT_OPERATOR_KEY }), { code: 'HOSTED_CONFIG_INVALID' });
  assert.throws(() => hostedConfig({ ...env, OPENSIGHT_AUTH_ENCRYPTION_KEY: 'short' }), { code: 'HOSTED_CONFIG_INVALID' });
});
test('H2 authentication schema refuses ephemeral storage and is idempotent on durable storage', async t => {
  const memory = new SqliteMetadataDatabase(':memory:');
  await assert.rejects(initializeAuth(memory), { code: 'DURABLE_MEMBERSHIP_STORE_REQUIRED' }); await memory.close();
  const { db } = await database(t); await initializeAuth(db);
  assert.equal((await db.transaction(c => c.query('SELECT * FROM h2_identities'))).length, 0);
});
test('H2 memory-hard password hashes have unique salts and bounded, constant-time verification', async () => {
  const password = randomBytes(24).toString('base64');
  const first = await hashPassword(password), second = await hashPassword(password);
  assert.notEqual(first, second); assert.match(first, /^scrypt\$131072\$8\$1\$/);
  assert.equal(await verifyPassword(password, first), true); assert.equal(await verifyPassword(`${password}x`, first), false);
  await assert.rejects(hashPassword('short'), { code: 'PASSWORD_INVALID' });
  await assert.rejects(hashPassword('x'.repeat(1025)), { code: 'PASSWORD_INVALID' });
  await assert.rejects(verifyPassword(password, 'scrypt$2$8$1$bad$bad'), { code: 'CREDENTIAL_UNAVAILABLE' });
  assert.equal(equal('a', 'a'), true); assert.equal(equal('a', 'ab'), false);
});
test('H2 encrypted secrets reject tampering, wrong keys and cross-subject substitution', () => {
  const key = randomBytes(32), secret = randomBytes(20).toString('base64');
  const saved = seal(secret, key, 'totp:subject-a');
  assert.ok(!saved.includes(secret)); assert.notEqual(saved, seal(secret, key, 'totp:subject-a'));
  assert.equal(unseal(saved, key, 'totp:subject-a'), secret);
  for (const [value, encryptionKey, aad] of [[saved, key, 'totp:subject-b'], [saved, randomBytes(32), 'totp:subject-a'], [`${saved.slice(0, -5)}AAAAA`, key, 'totp:subject-a']]) assert.throws(() => unseal(value, encryptionKey, aad), { code: 'CREDENTIAL_UNAVAILABLE' });
});
test('H2 TOTP matches RFC 6238 SHA-1 vectors and enforces window/replay checks', () => {
  const secret = Buffer.from('12345678901234567890');
  for (const [time, expected] of [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']]) assert.equal(totp(secret, Math.floor(time / 30), 8), expected);
  assert.equal(base32(Buffer.from('foobar')), 'MZXW6YTBOI');
  const now = 900000, step = now / 30000;
  assert.equal(verifyTotp(secret, totp(secret, step), now, -1), step);
  assert.equal(verifyTotp(secret, totp(secret, step), now, step), undefined);
  assert.equal(verifyTotp(secret, totp(secret, step - 2), now, -1), undefined);
  assert.equal(verifyTotp(secret, 'invalid', now, -1), undefined);
});
