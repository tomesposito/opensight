import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { SqliteMetadataDatabase } from '../dist/metadata-db.js';
import { initializeMetadata } from '../dist/metadata-schema.js';
import { initializeAuth } from '../dist/auth-schema.js';
import { hostedConfig } from '../dist/hosted-config.js';
import { HostedAuth } from '../dist/hosted-auth.js';
import { HostedProvisioning } from '../dist/hosted-provisioning.js';
import { StubMailTransport } from '../dist/mail.js';
import { totp } from '../dist/auth-crypto.js';

export function environment() {
  return { OPENSIGHT_PUBLIC_ORIGIN: 'https://opensight.example', OPENSIGHT_AUTH_ISSUER: 'opensight-test', OPENSIGHT_AUTH_AUDIENCE: 'opensight-api',
    OPENSIGHT_AUTH_KEY_ID: 'test-key', OPENSIGHT_AUTH_SIGNING_KEY: randomBytes(32).toString('base64'),
    OPENSIGHT_AUTH_ENCRYPTION_KEY: randomBytes(32).toString('base64'), OPENSIGHT_OPERATOR_KEY: randomBytes(32).toString('base64'),
    OPENSIGHT_SESSION_SECONDS: '900', OPENSIGHT_INVITATION_SECONDS: '86400' };
}
export async function database(t) {
  const directory = await mkdtemp(join(tmpdir(), 'opensight-h2-')), path = join(directory, 'metadata.sqlite');
  const db = new SqliteMetadataDatabase(path);
  t.after(async () => { await db.close(); await rm(directory, { recursive: true, force: true }); });
  await initializeMetadata(db); await initializeAuth(db);
  return { db, path, config: hostedConfig(environment()) };
}
export function decode32(value) {
  let bits = 0, acc = 0; const bytes = [];
  for (const ch of value) { acc = (acc << 5) | 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(ch); bits += 5; if (bits >= 8) { bits -= 8; bytes.push((acc >>> bits) & 255); } }
  return Buffer.from(bytes);
}
export async function authFixture(t) {
  const f = await database(t), mail = new StubMailTransport();
  let now = 1800000000000;
  const clock = () => now, advance = (ms = 30000) => { now += ms; };
  const auth = await HostedAuth.create(f.db, f.config, clock), provisioning = new HostedProvisioning(f.db, f.config, mail, clock);
  const email = 'invited@example.test', password = randomBytes(24).toString('base64');
  const input = { name: 'Synthetic tenant', administrator: { email, name: 'Invited administrator' } };
  const tenant = await provisioning.provision('onboard-one', input);
  const invitation = mail.messages[0].html.match(/<code>([^<]+)<\/code>/)[1];
  const enrollment = await auth.enroll(invitation, password, 'local');
  const secret = decode32(enrollment.secret), code = () => totp(secret, Math.floor(now / 30000));
  await auth.accept(invitation, password, code(), 'local'); advance();
  const login = async () => { const session = await auth.login(email, password, code(), tenant.tenantId, 'local'); advance(); return session; };
  return { ...f, mail, clock, advance, auth, provisioning, email, password, input, tenant, invitation, secret, code, login };
}
