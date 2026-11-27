import { isSurfaceDeclaration } from '@opensight/embedding-sdk/surface';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { method, send } from './automation-routes.js';
import { readBody } from './query.js';
import { object } from './metadata-resources.js';
import { appFeature, appRole, fullAppLocation, fullAppOperation, type AppLocation } from './embed-app-profile.js';
import { embedFailure, type EmbedSessions, type SessionGrant } from './embed-sessions.js';
import type { TenantContext } from './metadata.js';
import type { EmbedContent } from './embed-content.js';
import type { HostedDataRoutes } from './hosted-data-routes.js';
import type { HostedAI } from './hosted-ai.js';
import type { V1Routes } from './v1-routes.js';
import { HostedAnalyses } from './hosted-analyses.js';
import type { EmbedResult } from './embed-session-routes.js';

export class EmbedApp {
  constructor(private readonly content: EmbedContent, private readonly data: HostedDataRoutes, private readonly ai: HostedAI, private readonly v1: V1Routes, private readonly publishResult?: EmbedResult) {}
  async authorize(context: TenantContext, grant: SessionGrant, location?: AppLocation): Promise<void> {
    if (grant.anonymous || grant.experience.kind !== 'full-app') embedFailure('EMBED_SCOPE_DENIED', 403);
    const route = location ?? fullAppLocation(grant.experience.landingRoute, true);
    // Issuance checks config in EmbedSessions; verified operations carry its live snapshot.
    if (grant.appFeatures) appFeature(grant.appFeatures, route.area);
    const user = await this.content.metadata.get(context, { kind: 'user', id: context.userId });
    appRole(user.body.role, route.area);
    if (route.area === 'dashboard' && route.id) await this.content.asset(context, 'dashboard', route.id);
    if (route.area === 'author' && route.id) await this.content.asset(context, 'analysis', route.id);
    if (route.area === 'catalog' && route.id) await this.data.prep.describe(context, route.id);
    if (route.area === 'prep' && route.id) {
      if (route.path.includes('/source/')) await this.data.data.schema(context, route.id);
      else await this.data.prep.describe(context, route.id);
    }
    const declaration = grant.request.Surface;
    const declaresQuestions = !location && isSurfaceDeclaration(declaration)
      && (declaration.actions?.question === 'visible' || declaration.actions?.question === 'disabled');
    if ((route.area === 'ask' || declaresQuestions) && !(await this.ai.settings.status(context)).configured) embedFailure('AI_NOT_CONFIGURED', 503);
  }
  async route(request: IncomingMessage, response: ServerResponse, path: string, sessions: EmbedSessions): Promise<boolean> {
    const match = /^\/api\/embed\/sessions\/([A-Za-z0-9_-]{32})\/app(\/.*)$/.exec(path);
    if (!match) return false;
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Embed ')) embedFailure('INVALID_EMBED_TOKEN', 401);
    const id = match[1]!, target = match[2]!, credential = authorization.slice(6);
    const { session, context } = await sessions.verify(id, credential);
    if (session.experience.kind !== 'full-app') embedFailure('EMBED_SCOPE_DENIED', 403);
    sessions.protectAppWrites(context, id, credential);
    await this.content.metadata.usage?.consume(this.content.metadata, context, 'apiCalls');
    const recheck = async () => { await sessions.verify(id, credential); };
    if (this.publishResult) this.data.bindOutput(request, (context, status, body, validate) => this.publishResult!(context, session, body, async () => { await recheck(); await validate(); }));
    if (target === '/session') {
      method(request, response, ['GET']);
      const user = await this.content.metadata.get(context, { kind: 'user', id: context.userId });
      await recheck();
      send(response, 200, { id: context.userId, namespaceId: context.namespaceId, tenantId: context.tenantId, name: user.body.name, role: user.body.role }); return true;
    }
    if (target === '/route') {
      method(request, response, ['POST']);
      const location = fullAppLocation(object(await readBody(request), ['path']).path);
      await this.authorize(context, session, location); await recheck();
      send(response, 200, { path: location.path }); return true;
    }
    const analysis = /^\/analysis\/([A-Za-z0-9_-]{1,512})$/.exec(target);
    if (analysis) {
      method(request, response, ['GET']);
      await this.authorize(context, session, { path: target, area: 'author', id: analysis[1]! });
      const backend = new HostedAnalyses(this.data, context, recheck), record = await backend.get(analysis[1]!);
      const schemas = await backend.resolve(record.datasetBindings);
      await recheck();
      send(response, 200, { ...record, schemas: Object.fromEntries([...schemas].map(([id, schema]) => [id, { columns: schema.columns.filter(c => !schema.deniedColumns?.includes(c.name)) }])) }); return true;
    }
    const area = fullAppOperation(target, request.method ?? '');
    if (!area) embedFailure('EMBED_SCOPE_DENIED', 403);
    // Status reports unconfigured AI honestly; actual Ask O operations require it.
    if (target === '/api/o/status') appRole((await this.content.metadata.get(context, { kind: 'user', id: context.userId })).body.role, 'ask');
    else await this.authorize(context, session, { path: target, area });
    if (await this.ai.route(request, response, target, context, recheck)) return true;
    if (await this.data.route(request, response, target, context, recheck)) return true;
    if (await this.v1.route(request, response, target, context, recheck)) return true;
    return embedFailure('EMBED_SCOPE_DENIED', 403);
  }
}
