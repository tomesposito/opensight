import type { IncomingMessage, ServerResponse } from 'node:http';
import { hasCapability, type MetricDataset, type UploadType } from '@opensight/query-engine';
import { method, send } from './automation-routes.js';
import { readBody, validateQuery } from './query.js';
import { record, id } from './schedule.js';
import { AIError } from './ai-providers.js';
import { HostedAISettings, type HostedAIOptions } from './hosted-ai-settings.js';
import { generateAnswer, type GenerativeSchemaSource } from './o-generative.js';
import { HostedDashboards } from './hosted-dashboards.js';
import { HostedAnalyses } from './hosted-analyses.js';
import { dashboardVersion } from './dashboard-model.js';
import { dashboardQuestion } from './metric-consumption.js';
import { boundColumns } from './source-schema.js';
import type { HostedDataRoutes } from './hosted-data-routes.js';
import type { TenantContext } from './metadata.js';
import type { AiMeter } from './ai-settings.js';

function columns(input: readonly { name: string; type: string }[]) {
  return boundColumns(input.map(c => {
    if (!['STRING', 'INTEGER', 'DECIMAL', 'DATETIME', 'BOOLEAN'].includes(c.type)) throw new AIError(422, 'UNRESOLVED_BINDING', 'Dataset column type is unresolved');
    return { name: c.name, type: c.type as UploadType };
  }));
}
export class HostedAI {
  readonly settings: HostedAISettings;
  constructor(private readonly routes: HostedDataRoutes, encryptionKey: string, env: NodeJS.ProcessEnv, meter?: AiMeter, options?: HostedAIOptions) {
    this.settings = new HostedAISettings(routes.data.sources.metadata, encryptionKey, env, meter, options);
  }
  private get metadata() { return this.routes.data.sources.metadata; }
  private async require(context: TenantContext, capability: 'ai' | 'build' | 'admin') {
    const user = await this.metadata.get(context, { kind: 'user', id: context.userId });
    if (!hasCapability(user.body.role, capability)) throw new AIError(403, `SECURITY_${capability.toUpperCase()}_REQUIRED`, `${capability} capability required`);
  }
  private async source(context: TenantContext, body: Record<string, unknown>, recheck: () => Promise<void>): Promise<GenerativeSchemaSource> {
    await this.require(context, 'ai');
    if (body.dashboardId !== undefined) {
      const dashboard = new HostedDashboards(this.routes, context, recheck), dashboardId = id(body.dashboardId, '$.dashboardId');
      const version = dashboardVersion(await dashboard.get(dashboardId)), binding = Object.values(version.datasetBindings);
      if (binding.length !== 1 || body.datasetId !== undefined && body.datasetId !== binding[0]!.id) throw new AIError(403, 'SECURITY_DATASET_SCOPE', 'Dashboard has no resolved dataset in this scope');
      return {
        securitySchema: async () => { const schema = await dashboard.questionSchema(version); return { columns: columns(schema.columns), deniedColumns: schema.deniedColumns ?? [], datasetId: binding[0]!.id }; },
        metricLookup: () => dashboard.metricVocabulary(version),
        execute: async query => { const { bindings: _bindings, ...result } = await dashboard.query(version, dashboardQuestion(query, version), 'query'); return result; },
      };
    }
    await this.require(context, 'build');
    // A builder explicitly names its dataset. Legacy clients retain their sales binding.
    const datasetId = body.datasetId === undefined ? 'sales' : id(body.datasetId, '$.datasetId');
    const prepared = (await this.metadata.list(context, 'prepared-dataset')).some(r => r.id === datasetId && r.ownerId === context.userId);
    const ref: MetricDataset = prepared ? { kind: 'prepared-dataset', id: datasetId, ownerId: context.userId } : { kind: 'dataset', id: datasetId };
    const analyses = new HostedAnalyses(this.routes, context, recheck);
    return {
      securitySchema: async () => { const schema = (await analyses.resolve({ data: { kind: ref.kind, id: ref.id } })).get('data')!; return { columns: columns(schema.columns), deniedColumns: schema.deniedColumns ?? [], datasetId }; },
      metricLookup: () => this.metadata.metricVocabulary(context, ref),
      execute: async query => {
        if (prepared) return this.routes.prep.execute(context, datasetId, 'query', query);
        // Use the dashboard visual path for legacy dataset policy intersections as well.
        const schema = await analyses.resolve({ data: { kind: 'dataset', id: datasetId } });
        if (!schema.has('data')) throw new AIError(403, 'SECURITY_DATASET_SCOPE', 'Dataset is unresolved');
        const { interactiveRequest } = await import('@opensight/query-engine');
        const dataSetArn = `urn:opensight:dataset:${datasetId}`;
        const wire = interactiveRequest(query, { dataSet: { DataSet: { Arn: dataSetArn } }, dataSource: {}, localData: {} }).analysis as { Definition: Record<string, unknown> };
        const { convertDefinition } = await import('@opensight/web/analysis');
        const v = { version: 1, publishedAt: '', publishedBy: context.userId, name: datasetId, definition: convertDefinition(wire.Definition), wireDefinition: wire.Definition, datasetBindings: { sales_data: { kind: 'dataset' as const, id: datasetId } }, bindingOwnerId: context.userId, sourceAnalysisId: '', errors: [] };
        const { bindings: _bindings, ...result } = await new HostedDashboards(this.routes, context, recheck).query(v, wire.Definition, 'query'); return result;
      },
    };
  }
  async route(request: IncomingMessage, response: ServerResponse, path: string, context: TenantContext, recheck: () => Promise<void>): Promise<boolean> {
    const admin = /^\/api\/admin\/ai(?:\/(key|test))?$/.exec(path);
    if (admin) {
      await this.require(context, 'admin');
      const action = admin[1], verb = method(request, response, action ? ['POST'] : ['GET', 'POST']);
      if (verb === 'GET') { const result = await this.settings.summary(context); await recheck(); send(response, 200, result); return true; }
      const body = await readBody(request); await recheck(); await this.require(context, 'admin');
      if (action === 'test') {
        record(body, []); await this.settings.complete(context, { system: 'Reply with OK only.', prompt: 'Connection test', maxTokens: 32 }, true);
        await recheck(); await this.require(context, 'admin'); send(response, 200, { ok: true }); return true;
      }
      if (action === 'key') await this.settings.saveKey(context, body); else await this.settings.save(context, body);
      await recheck(); await this.require(context, 'admin');
      send(response, 200, await this.settings.summary(context)); return true;
    }
    if (!['/api/o/status', '/api/o/generate', '/api/o/calculation', '/api/o/query'].includes(path)) return false;
    await this.require(context, 'ai');
    if (path === '/api/o/status') { method(request, response, ['GET']); const result = await this.settings.status(context); await recheck(); send(response, 200, result); return true; }
    method(request, response, ['POST']);
    const calculation = path === '/api/o/calculation', query = path === '/api/o/query';
    if (calculation) await this.require(context, 'build');
    const body = record(await readBody(request), query ? ['dashboardId', 'datasetId', 'query'] : ['question', 'dashboardId', 'datasetId', 'calculatedFields']);
    const source = await this.source(context, body, recheck), stamp = await this.metadata.revisions(context);
    const check = async () => { await recheck(); await this.require(context, 'ai'); if (calculation) await this.require(context, 'build'); await this.metadata.assertRevisions(context, stamp); await this.source(context, body, recheck); };
    if (query) {
      const result = await source.execute(validateQuery(body.query)); await check();
      const output = await this.routes.output(request, context, 200, result, check); send(response, output.status, output.body);
    } else {
      const result = await generateAnswer(body, calculation, source, input => this.settings.complete(context, input), check,
        () => this.routes.data.analytics.track(context, { name: 'ask_o_asked', props: { count: 1 } }));
      send(response, 200, result);
    }
    return true;
  }
}
