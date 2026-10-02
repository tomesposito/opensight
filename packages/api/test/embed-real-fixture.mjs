import { randomBytes } from 'node:crypto';
import { initializeMetadata } from '../dist/metadata-schema.js';
import { initializeAuth } from '../dist/auth-schema.js';
import { migrateBudgets } from '../dist/budget-store.js';
import { budgetConfig } from './budget-helpers.mjs';
import { environment, decode32 } from './hosted-helpers.mjs';
import { hostedConfig } from '../dist/hosted-config.js';
import { HostedAuth } from '../dist/hosted-auth.js';
import { HostedProvisioning } from '../dist/hosted-provisioning.js';
import { StubMailTransport } from '../dist/mail.js';
import { TenantMetadata } from '../dist/metadata.js';
import { totp } from '../dist/auth-crypto.js';
import { HostedEmbedding, embeddingPolicy, defaultEmbedConfig, initializeEmbedding } from '../dist/embedding-config.js';
import { EmbedSessions, resourceArn } from '../dist/embed-sessions.js';
import { seedEmbedContent } from './embed-content-helpers.mjs';
/** Synthetic data with the production auth, durable store, query engine and HTTP stack. */
export async function realEmbedFixture(db, dialect, origin, parentOrigin) {
  await initializeMetadata(db, dialect); await initializeAuth(db); await migrateBudgets(db, budgetConfig, 'frozen');
  const env = { ...environment(), OPENSIGHT_PUBLIC_ORIGIN: origin, OPENSIGHT_SESSION_SECONDS: '36000' }, config = hostedConfig(env);
  const mail = new StubMailTransport(), auth = await HostedAuth.create(db, config), provisioning = new HostedProvisioning(db, config, mail), metadata = new TenantMetadata(db, db);
  const tenant = await provisioning.provision('embed-browser', { name: 'Synthetic embed tenant', administrator: { email: 'embed-admin@example.test', name: 'Embed administrator' } });
  const enroll = async email => {
    const invitation = mail.messages.at(-1).html.match(/<code>([^<]+)<\/code>/)[1], password = randomBytes(24).toString('base64');
    const enrollment = await auth.enroll(invitation, password, 'local'), secret = decode32(enrollment.secret);
    await auth.accept(invitation, password, totp(secret, Math.floor(Date.now() / 30000)), 'local');
    const identity = await db.transaction(async c => {
      const rows = await c.query('SELECT m.namespace_id, m.user_id FROM h2_memberships m JOIN h2_identities i ON i.subject = m.subject WHERE m.tenant_id = ? AND i.email = ?', [tenant.tenantId, email]);
      return { namespaceId: String(rows[0].namespace_id), userId: String(rows[0].user_id) };
    });
    let lastStep = Math.floor(Date.now() / 30000);
    return { identity, context: () => metadata.authenticate(null, async () => identity), login: async () => {
      if (lastStep + 1 > Math.floor(Date.now() / 30000) + 1) await new Promise(r => setTimeout(r, 30010 - Date.now() % 30000));
      const step = Math.max(lastStep + 1, Math.floor(Date.now() / 30000));
      const session = await auth.login(email, password, totp(secret, step), tenant.tenantId, 'local'); lastStep = step; return session;
    } };
  };
  const admin = await enroll('embed-admin@example.test');
  await provisioning.inviteMember('embed-reader', tenant.tenantId, { email: 'embed-reader@example.test', name: 'Embed reader', role: 'reader' });
  const reader = await enroll('embed-reader@example.test');
  const policyInput = { origins: [{ id: 'canonical', origin }], tenants: [{ tenantId: tenant.tenantId, allowedParentOrigins: [parentOrigin], embedOriginIds: ['canonical'], maxSessionSeconds: 36000 }], assets: [] };
  const policy = embeddingPolicy({ OPENSIGHT_EMBEDDING_POLICY: JSON.stringify(policyInput) }, origin);
  await initializeEmbedding(db);
  const embedding = new HostedEmbedding(db, metadata, policy), embedConfig = { ...defaultEmbedConfig(), enabled: true, embedOriginId: 'canonical', allowedParentOrigins: [parentOrigin], maxSessionSeconds: 36000 };
  embedConfig.features.anonymous = true; embedConfig.features.authoring = true;
  await embedding.put(await admin.context(), embedConfig, 0);
  const key = { id: 'browser-key', secret: randomBytes(32) };
  const f = { db, tenant, auth, provisioning, metadata, mail, policyInput, policy, embedding, config: embedConfig, hostedConfig: config, key,
    ...admin, reader, arn: (kind, id) => resourceArn(tenant.namespaceId, kind, id) };
  const data = await seedEmbedContent(f, reader), sessions = new EmbedSessions(db, metadata, policy, key, (c, g) => data.content.authorize(c, g)); await sessions.initialize();
  return { ...f, ...data, sessions };
}
