import { readFile } from 'node:fs/promises';
import { digest } from './auth-crypto.js';
import { HostedLifecycle, boundedSetting } from './hosted-lifecycle.js';
import { auditWriter } from './hosted-events.js';
import { assertEncryptionKey } from './hosted-key-rotation.js';
import { EmbedSessions, embedSessionKey } from './embed-sessions.js';
import { EmbedContent } from './embed-content.js';
import { EmbedSources } from './embed-sources.js';
import { embedSessionRoute } from './embed-session-routes.js';
import { loadBudgets } from './budget-store.js';
import { embeddingPolicy, expectedEmbedRevision, HostedEmbedding, initializeEmbedding } from './embedding-config.js';
import { assertHostedSourcesReady, expireUploads } from './source-maintenance.js';
import { HostedSources } from './hosted-sources.js';
import { HostedData } from './hosted-data.js';
import { HostedDataRoutes } from './hosted-data-routes.js';
import { sourceEndpoints } from './source-schema.js';
import { QueryEngineError, UploadError } from '@opensight/query-engine';
import { PrepError } from '@opensight/bundle-parser/prep';
import { BlazeError } from './blaze.js';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { hasCapability } from '@opensight/query-engine';
import { HostedAuth } from './hosted-auth.js';
import { initializeAuth } from './auth-schema.js';
import { equal } from './auth-crypto.js';
import { hostedConfig } from './hosted-config.js';
import { HostedProvisioning } from './hosted-provisioning.js';
import { MetadataError, type Database } from './metadata-db.js';
import { TenantMetadata } from './metadata.js';
import { identifier, object } from './metadata-resources.js';
import type { SecurityOptions } from './security.js';
import { scopePath } from './namespace-routes.js';
import { readBody, RequestError, SecurityError } from './query.js';
import { method, send } from './automation-routes.js';
import { smtpFromEnvironment, type MailTransport } from './mail.js';
import { initializeJobs } from './job-schema.js';
import { JobStore } from './job-store.js';
import { JobRenderer } from './job-renderer.js';
import { JobRunner } from './job-runner.js';
import { JobOwnership, disposition } from './job-ownership.js';
import { jobRoute } from './job-routes.js';
import { Scheduler } from './schedule.js';

const drains = new WeakMap<Server, () => Promise<void>>();
export async function drainHostedServer(server: Server): Promise<void> { await drains.get(server)?.(); }

export interface HostedServerOptions {
  membershipDatabase: Database;
  tenantDatabase: Database;
  /** A verifier router may select several credential adapters; never caller-asserted subjects. */
  security: Pick<SecurityOptions, 'authenticate'>;
  builtinAuth?: HostedAuth;
  env?: NodeJS.ProcessEnv;
  mailTransport?: MailTransport;
  roleProbe?: () => Promise<void>;
}
const forgedHeaders = ['x-user', 'x-user-id', 'x-principal', 'x-groups', 'x-group-ids', 'x-namespace', 'x-namespace-id', 'x-tenant', 'x-tenant-id', 'x-subject', 'x-role', 'x-roles', 'x-capabilities'];
const forgedFields = ['subject', 'principal', 'userId', 'namespaceId', 'groups', 'security', 'capabilities', 'issuer', 'audience'];
async function body(request: IncomingMessage, allowed: readonly string[]) {
  const value = object(await readBody(request));
  if (forgedFields.some(k => Object.hasOwn(value, k))) throw new MetadataError('FORGED_PRINCIPAL', 403);
  return object(value, allowed);
}
function code(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{6}$/.test(value)) throw new MetadataError('AUTHENTICATION_FAILED', 401);
  return value;
}
function idempotency(request: IncomingMessage): string { return identifier(request.headers['idempotency-key']); }
function boundary(request: IncomingMessage, origin: string): void {
  for (const header of ['host', 'authorization', 'origin', 'idempotency-key', 'if-match']) {
    let count = 0;
    for (let i = 0; i < request.rawHeaders.length; i += 2) if (request.rawHeaders[i]!.toLowerCase() === header) count++;
    if (count > 1) throw new MetadataError('HOSTED_REQUEST_INVALID', 400);
  }
  if (request.headers.host !== new URL(origin).host || request.headers.origin !== undefined && request.headers.origin !== origin
    || request.headers.forwarded !== undefined || request.headers['x-forwarded-host'] !== undefined) throw new MetadataError(
      /^\/api\/(?:namespaces\/[^/]+\/)?embedding(?:\/|$)/.test(request.url ?? '') ? 'EMBED_ORIGIN_DENIED' : 'UNTRUSTED_ORIGIN', 403);
  if (forgedHeaders.some(h => request.headers[h] !== undefined)) throw new MetadataError('FORGED_PRINCIPAL', 403);
  if (['GET', 'HEAD'].includes(request.method ?? '') && (request.headers['transfer-encoding'] || request.headers['content-length'] && request.headers['content-length'] !== '0')) throw new MetadataError('HOSTED_REQUEST_INVALID', 400);
  if (!request.url?.startsWith('/') || request.url.startsWith('//') || request.url.includes('?') || request.url.includes('#')) throw new MetadataError('HOSTED_REQUEST_INVALID', 400);
}

/** Hosted tenant plane never exposes legacy fixture stores or ownerless schedulers. */
export async function createHostedApiServer(options: HostedServerOptions): Promise<Server> {
  const config = hostedConfig(options.env);
  if (options.membershipDatabase?.durable !== true || options.tenantDatabase?.durable !== true) throw new MetadataError('DURABLE_MEMBERSHIP_STORE_REQUIRED', 503);
  if (typeof options.security?.authenticate !== 'function') throw new MetadataError('HOSTED_VERIFIER_REQUIRED', 503);
  await assertEncryptionKey(options.membershipDatabase, config.encryptionKey.toString('base64'));
  const audit = auditWriter(options.membershipDatabase);
  const authenticate = options.security.authenticate;
  const metadata = new TenantMetadata(options.tenantDatabase, options.membershipDatabase);
  const policy = embeddingPolicy(options.env ?? process.env, config.origin);
  await initializeEmbedding(options.membershipDatabase);
  const embedding = new HostedEmbedding(options.membershipDatabase, metadata, policy);
  const budgets = await loadBudgets(options.membershipDatabase, metadata);
  const jobs = new JobStore(options.membershipDatabase, metadata);
  const data = new HostedDataRoutes(new HostedData(new HostedSources(metadata, config.encryptionKey.toString('base64'), sourceEndpoints(options.env), Date.now, audit), undefined, budgets), jobs);
  const embedContent = new EmbedContent(new HostedData(new EmbedSources(metadata, config.encryptionKey.toString('base64'), sourceEndpoints(options.env), Date.now, audit), undefined, budgets));
  const mail = options.mailTransport ?? smtpFromEnvironment(options.env);
  await initializeJobs(options.membershipDatabase);
  const unmigrated = await options.membershipDatabase.transaction(c => c.query(`SELECT j.resource_id FROM h1_resources j WHERE j.kind = 'job'
    AND NOT EXISTS (SELECT 1 FROM h7_migrations m WHERE m.tenant_id = j.tenant_id AND m.namespace_id = j.namespace_id)`));
  if (unmigrated.length) throw new MetadataError('JOB_MIGRATION_REQUIRED', 503);
  const renderer = new JobRenderer(data.data, embedContent), runner = new JobRunner(jobs, renderer, mail);
  let schedulerHealthy = true;
  const ownership = new JobOwnership(jobs, renderer), scheduler = new Scheduler(async () => { await runner.tick(); schedulerHealthy = true; }, () => { schedulerHealthy = false; });
  const sessions = new EmbedSessions(options.membershipDatabase, metadata, policy, embedSessionKey(options.env ?? process.env), (context, grant) => embedContent.authorize(context, grant));
  await sessions.initialize();
  const provisioning = new HostedProvisioning(options.membershipDatabase, config, mail, Date.now, ownership);
  // Prove that the durable H1/H2 schema is reachable before binding a socket.
  await options.membershipDatabase.transaction(async c => { await c.query('SELECT tenant_id FROM h1_tenants WHERE 1 = 0'); await c.query('SELECT subject FROM h2_memberships WHERE 1 = 0'); });
  await assertHostedSourcesReady(options.membershipDatabase);
  await expireUploads(options.membershipDatabase);
  const runtimeEnv = options.env ?? process.env;
  const lifecycle = new HostedLifecycle(async () => {
    await options.membershipDatabase.transaction(async c => {
      await c.query('SELECT subject FROM h2_memberships WHERE 1 = 0');
      await c.query('SELECT tenant_id FROM h7_jobs WHERE 1 = 0');
      const key = (await c.query('SELECT fingerprint, active FROM h2_keys WHERE key_id = ?', [config.keyId]))[0];
      if (options.builtinAuth && (!key || Number(key.active) !== 1 || key.fingerprint !== digest(config.signingKey))) throw new MetadataError('AUTH_KEY_REVOKED', 503);
      const encryption = (await c.query('SELECT fingerprint FROM h8_encryption WHERE id = 1'))[0];
      if (encryption?.fingerprint !== digest(config.encryptionKey)) throw new MetadataError('ENCRYPTION_KEY_VERSION_MISMATCH', 503);
    });
    await options.tenantDatabase.transaction(async c => { await c.query('SELECT tenant_id FROM h1_tenants WHERE 1 = 0'); }, { tenantId: 'health', namespaceId: 'health' });
    await readFile('/proc/self/stat');
    if (!schedulerHealthy) throw new MetadataError('SCHEDULER_UNAVAILABLE', 503);
    await options.roleProbe?.();
  }, boundedSetting(runtimeEnv, 'OPENSIGHT_HTTP_MAX_INFLIGHT', 64, 4096));
  const server = createServer((request, response) => {
    let release: (() => void) | undefined;
    void (async () => {
      if (request.url === '/health/live' || request.url === '/health/ready') {
        method(request, response, ['GET']);
        const ready = request.url === '/health/live' || await lifecycle.ready();
        send(response, ready ? 200 : 503, { status: ready ? 'ok' : 'unavailable' }); return;
      }
      release = lifecycle.admit();
      boundary(request, config.origin);
      let path = request.url!;
      if (path === '/api/host' || path.startsWith('/api/host/')) {
        const authorization = request.headers.authorization;
        const browserMembership = /^\/api\/host\/tenants\/[A-Za-z0-9_-]+\/users(?:\/[A-Za-z0-9_-]+)?$/.test(path);
        if (request.headers.origin !== undefined && !browserMembership || !authorization?.startsWith('Operator ') || !equal(authorization.slice(9), config.operatorKey.toString('base64url'))) throw new MetadataError('OPERATOR_REQUIRED', 403);
        if (path === '/api/host/tenants') {
          method(request, response, ['POST']);
          const input = await body(request, ['name', 'administrator']), administrator = object(input.administrator, ['email', 'name']);
          const result = await provisioning.provision(idempotency(request), { name: input.name as string, administrator: { email: administrator.email as string, name: administrator.name as string } });
          send(response, 201, { ...result, state: (await provisioning.operator.tenant(result.tenantId)).state }); return;
        }
        const operation = /^\/api\/host\/operations\/([A-Za-z0-9_-]+)$/.exec(path);
        if (operation) { method(request, response, ['GET']); send(response, 200, await provisioning.operator.inspect(identifier(operation[1]))); return; }
        const tenant = /^\/api\/host\/tenants\/([A-Za-z0-9_-]+)(?:\/(suspend|resume|invitations|users)(?:\/([A-Za-z0-9_-]+))?)?$/.exec(path);
        if (tenant) {
          const tenantId = identifier(tenant[1]), action = tenant[2];
          if (!action && request.method === 'GET') { send(response, 200, await provisioning.operator.tenant(tenantId)); return; }
          if (action === 'invitations' && !tenant[3]) {
            method(request, response, ['POST']); const input = await body(request, ['email', 'name', 'role']);
            send(response, 201, await provisioning.inviteMember(idempotency(request), tenantId, { email: input.email as string, name: input.name as string, role: input.role as Parameters<HostedProvisioning['inviteMember']>[2]['role'] })); return;
          }
          if (action === 'users') {
            if (!tenant[3]) { method(request, response, ['GET']); send(response, 200, await ownership.users(tenantId)); return; }
            method(request, response, ['GET', 'DELETE']);
            if (request.method === 'GET') send(response, 200, await ownership.preview(tenantId, identifier(tenant[3])));
            else {
              const input = await body(request, ['jobs']);
              await provisioning.removeMember(tenantId, identifier(tenant[3]), disposition(input.jobs)); send(response, 200, { removed: true });
            }
            return;
          }
          if (!action || action === 'suspend' || action === 'resume') {
            method(request, response, [action ? 'POST' : 'DELETE']);
            const input = await body(request, ['expectedVersion']);
            send(response, 200, await provisioning.transition(idempotency(request), tenantId, action === 'suspend' ? 'suspend' : action === 'resume' ? 'resume' : 'delete', input.expectedVersion as number)); return;
          }
        }
        throw new MetadataError('RESOURCE_NOT_FOUND', 404);
      }
      const peer = request.socket.remoteAddress ?? 'unknown';
      if (['/api/auth/enroll', '/api/auth/accept', '/api/auth/login'].includes(path)) {
        if (!options.builtinAuth) throw new MetadataError('BUILTIN_AUTH_UNAVAILABLE', 503);
        method(request, response, ['POST']);
        if (request.headers.authorization || request.headers.cookie) throw new MetadataError('HOSTED_REQUEST_INVALID', 400);
        if (path === '/api/auth/login') {
          const input = await body(request, ['email', 'password', 'code', 'tenantId']);
          send(response, 200, await options.builtinAuth.login(input.email, input.password, code(input.code), input.tenantId, peer));
        } else {
          const input = await body(request, path.endsWith('/enroll') ? ['invitationToken', 'password'] : ['invitationToken', 'password', 'code']);
          send(response, 200, path.endsWith('/enroll') ? await options.builtinAuth.enroll(input.invitationToken, input.password, peer)
            : await options.builtinAuth.accept(input.invitationToken, input.password, code(input.code), peer));
        }
        return;
      }
      if (await embedSessionRoute(request, response, path, sessions, embedContent)) return;
      // Every other request, including unknown and legacy routes, must verify first.
      const verified = async (req: IncomingMessage) => {
        try {
          const identity = await authenticate(req);
          if (!identity) return undefined;
          const rows = await options.membershipDatabase.transaction(c => c.query("SELECT subject FROM h2_memberships WHERE namespace_id = ? AND user_id = ? AND status = 'active'", [identity.namespaceId, identity.userId]));
          if (!rows.length) throw new MetadataError('AUTHENTICATION_FAILED', 401);
          return identity;
        }
        catch (error) { if (error instanceof MetadataError) throw error; throw new MetadataError('AUTHENTICATION_FAILED', 401); }
      };
      const context = await metadata.authenticate(request, verified);
      path = scopePath(path, context);
      if (path === '/api/session') {
        method(request, response, ['GET']);
        const user = await metadata.get(context, { kind: 'user', id: context.userId });
        send(response, 200, { id: user.id, namespaceId: context.namespaceId, tenantId: context.tenantId, ...user.body }); return;
      }
      if (path === '/api/auth/switch' || path === '/api/auth/logout') {
        if (!options.builtinAuth) throw new MetadataError('BUILTIN_AUTH_UNAVAILABLE', 503);
        method(request, response, ['POST']);
        const input = await body(request, path.endsWith('/switch') ? ['tenantId'] : []), token = options.builtinAuth.bearer(request);
        if (path.endsWith('/switch')) send(response, 200, await options.builtinAuth.switchTenant(token, input.tenantId));
        else { await options.builtinAuth.logout(token); send(response, 200, { loggedOut: true }); }
        return;
      }
      if (path === '/api/namespaces') {
        method(request, response, ['GET']); await metadata.revisions(context);
        send(response, 200, [{ id: context.namespaceId, tenantId: context.tenantId }]); return;
      }
      if (await jobRoute(request, response, path, context, jobs, renderer, mail)) return;
      if (path === '/api/users' || path === '/api/groups') {
        method(request, response, ['GET']);
        const user = await metadata.get(context, { kind: 'user', id: context.userId });
        if (!hasCapability(user.body.role as Parameters<typeof hasCapability>[0], 'admin')) throw new MetadataError('SECURITY_ADMIN_REQUIRED', 403);
        const resources = await metadata.list(context, path.endsWith('/users') ? 'user' : 'group');
        send(response, 200, resources.map(r => ({ id: r.id, namespaceId: context.namespaceId, ...r.body }))); return;
      }
      if (/^\/api\/(namespaces|users|invitations)(?:\/|$)/.test(path)) throw new MetadataError('OPERATOR_REQUIRED', 403);
      if (path === '/api/embedding/config') {
        method(request, response, ['GET', 'PUT']);
        const result = request.method === 'GET' ? await embedding.get(context)
          : await embedding.put(context, await body(request, ['enabled', 'allowedParentOrigins', 'embedOriginId', 'maxSessionSeconds', 'appearance', 'features']), expectedEmbedRevision(request.headers['if-match']));
        response.setHeader('ETag', `"${result.revision}"`);
        send(response, 200, result); return;
      }
      if (/^\/api\/embedding\/domains(?:\/|$)/.test(path)) throw new MetadataError('EMBED_FEATURE_UNSUPPORTED', 422);
      if (['/api/embedding/sessions', '/api/embedding/GenerateEmbedUrlForRegisteredUser', '/api/embedding/GenerateEmbedUrlForAnonymousUser'].includes(path)) {
        method(request, response, ['POST']);
        if (request.headers.origin !== undefined) throw new MetadataError('EMBED_BACKEND_REQUIRED', 403);
        const anonymous = path.endsWith('GenerateEmbedUrlForAnonymousUser');
        send(response, 200, await sessions.issue(context, await readBody(request), anonymous)); return;
      }
      const embedSession = /^\/api\/embedding\/sessions\/([A-Za-z0-9_-]{32})(?:\/(renew))?$/.exec(path);
      if (embedSession) {
        method(request, response, [embedSession[2] ? 'POST' : 'DELETE']);
        if (request.headers.origin !== undefined) throw new MetadataError('EMBED_BACKEND_REQUIRED', 403);
        await body(request, []);
        if (embedSession[2]) send(response, 200, await sessions.renew(context, embedSession[1]!));
        else { await sessions.revoke(context, embedSession[1]!); send(response, 200, { revoked: true }); }
        return;
      }
      const cancellation = new AbortController();
      request.once('aborted', () => cancellation.abort());
      response.once('close', () => { if (!response.writableFinished) cancellation.abort(); });
      data.data.begin(context, cancellation.signal);
      if (await data.route(request, response, path, context, async () => {
        lifecycle.assertServing();
        const current = await metadata.authenticate(request, verified);
        if (current.tenantId !== context.tenantId || current.userId !== context.userId) throw new MetadataError('AUTHENTICATION_FAILED', 401);
        await metadata.revisions(context);
      })) return;
      throw new MetadataError('HOSTED_CAPABILITY_UNAVAILABLE', 503);
    })().catch((error: unknown) => {
      request.resume();
      const dataError = error instanceof QueryEngineError || error instanceof PrepError || error instanceof UploadError || error instanceof BlazeError;
      const status = dataError ? 422 : error instanceof MetadataError || error instanceof RequestError ? error.status : 500;
      const errorCode = dataError ? error.code : error instanceof MetadataError || error instanceof SecurityError ? error.code : error instanceof RequestError ? 'HOSTED_REQUEST_INVALID' : 'HOSTED_INTERNAL_ERROR';
      send(response, status, { errorCode });
    }).finally(() => release?.());
  });
  const expiryTimer = setInterval(() => { void expireUploads(options.membershipDatabase).catch(() => { /* Reads still fail closed on expiry. */ }); }, 60000);
  await runner.recover();
  server.once('listening', () => { lifecycle.start(); scheduler.start(); });
  expiryTimer.unref();
  const beginDrain = () => { lifecycle.beginDrain(); clearInterval(expiryTimer); scheduler.stop(); runner.stop(); budgets.close(); };
  server.once('close', beginDrain);
  let draining: Promise<void> | undefined;
  drains.set(server, () => draining ??= (async () => {
    beginDrain();
    const complete = await lifecycle.drain(boundedSetting(runtimeEnv, 'OPENSIGHT_DRAIN_MS', 20000, 60000), async () => { await Promise.all([scheduler.idle(), budgets.shutdown()]); });
    if (!complete) { server.closeAllConnections(); throw new MetadataError('DRAIN_DEADLINE_EXCEEDED', 503); }
  })());
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  return server;
}

/** Selected built-in verifier, composed through the same seam as future verifier routers. */
export async function createBuiltinHostedServer(options: Omit<HostedServerOptions, 'security' | 'builtinAuth'>): Promise<Server> {
  const config = hostedConfig(options.env);
  await initializeAuth(options.membershipDatabase);
  const builtinAuth = await HostedAuth.create(options.membershipDatabase, config);
  return createHostedApiServer({ ...options, builtinAuth, security: { authenticate: builtinAuth.authenticate } });
}
