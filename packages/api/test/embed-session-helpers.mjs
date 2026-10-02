import { randomBytes } from 'node:crypto';
import { authFixture } from './hosted-helpers.mjs';
import { TenantMetadata } from '../dist/metadata.js';
import { HostedEmbedding, initializeEmbedding, embeddingPolicy, defaultEmbedConfig } from '../dist/embedding-config.js';
import { EmbedSessions, resourceArn } from '../dist/embed-sessions.js';
export const parentOrigin = 'https://product.example';
export const request = (extra = {}) => ({ ExperienceConfiguration: { Dashboard: { InitialDashboardId: 'dashboard' } }, ...extra });
export async function sessionFixture(t, authorize = async () => {}) {
  const f = await authFixture(t), metadata = new TenantMetadata(f.db, f.db);
  const identity = await f.auth.verify((await f.login()).token);
  const context = () => metadata.authenticate(null, async () => identity);
  await initializeEmbedding(f.db);
  const policyInput = { origins: [{ id: 'canonical', origin: f.config.origin }], tenants: [{ tenantId: f.tenant.tenantId,
    allowedParentOrigins: [parentOrigin, 'https://second.example', 'https://third.example', 'https://fourth.example'], embedOriginIds: ['canonical'], maxSessionSeconds: 36000 }], assets: [] };
  const policy = embeddingPolicy({ OPENSIGHT_EMBEDDING_POLICY: JSON.stringify(policyInput) }, f.config.origin);
  const embedding = new HostedEmbedding(f.db, metadata, policy), config = { ...defaultEmbedConfig(), enabled: true, allowedParentOrigins: [parentOrigin], embedOriginId: 'canonical', maxSessionSeconds: 36000 };
  config.features.anonymous = true; config.features.authoring = true;
  await embedding.put(await context(), config, 0);
  const key = { id: 'embed-one', secret: randomBytes(32) }, sessions = new EmbedSessions(f.db, metadata, policy, key, authorize, f.clock);
  await sessions.initialize();
  const issue = (body = request(), anonymous = false) => context().then(c => sessions.issue(c, body, anonymous));
  const redeem = (issued, extra = {}) => sessions.redeem(issued.sessionId, { bootstrap: new URL(issued.EmbedUrl).hash.slice('#bootstrap='.length), parentOrigin, channelId: randomBytes(24).toString('base64url'), ...extra });
  return { ...f, metadata, identity, context, policy, policyInput, embedding, config, key, sessions, issue, redeem, arn: (kind, id) => resourceArn(identity.namespaceId, kind, id) };
}
