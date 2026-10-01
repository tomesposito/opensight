import type { IncomingMessage, ServerResponse } from 'node:http';
import { connectors } from '@opensight/query-engine';
import { method, send } from './automation-routes.js';
import { readBody } from './query.js';
import { object } from './metadata-resources.js';
import { HostedData } from './hosted-data.js';
import { HostedPrep } from './hosted-prep.js';
import type { TenantContext } from './metadata.js';
import { sourceError } from './source-schema.js';

export class HostedDataRoutes {
  readonly prep: HostedPrep;
  constructor(readonly data: HostedData) { this.prep = new HostedPrep(data); }
  async route(request: IncomingMessage, response: ServerResponse, path: string, context: TenantContext, recheck: () => Promise<void>): Promise<boolean> {
    this.data.begin(context);
    const revisions = await this.data.sources.metadata.revisions(context);
    const read = request.method === 'GET' || /\/(query|preview|rows|output|refresh|schema)$/.test(path);
    const input = async () => {
      const body = await readBody(request);
      // A durable write invalidates revision-bound sessions, including this one.
      // Verify after body intake and before mutation; acknowledge the committed write.
      if (!read) await recheck();
      return body;
    };
    const publish = async (status: number, body: unknown) => {
      if (read) { await recheck(); await this.data.publication(context, revisions); }
      else await this.data.sources.metadata.revisions(context);
      send(response, status, body);
    };
    if (path === '/api/connectors') {
      method(request, response, ['GET']); await this.data.sources.capability(context, 'build');
      await publish(200, connectors.filter(c => ['file', 'postgresql'].includes(c.id)).map(c => ({ id: c.id, name: c.name }))); return true;
    }
    if (path === '/api/sources' || path === '/api/prep-sources' || path === '/api/ai/sources') {
      method(request, response, ['GET']); await publish(200, await this.data.discover(context, path === '/api/ai/sources' ? 'ai' : 'discovery')); return true;
    }
    if (path === '/api/uploads') {
      method(request, response, ['POST']); await publish(201, await this.data.sources.upload(context, await input())); return true;
    }
    const source = /^\/api\/sources\/([A-Za-z0-9_-]{1,512})(?:\/(bind|rotate|preview|rows|output|query|refresh|policy))?$/.exec(path);
    if (source) {
      const id = source[1]!, action = source[2];
      if (!action) {
        method(request, response, ['GET', 'PUT', 'DELETE']);
        if (request.method === 'GET') await publish(200, await this.data.schema(context, id));
        else if (request.method === 'PUT') await publish(201, await this.data.sources.create(context, id, await input()));
        else { const raw = object(await input(), ['expectedVersion']); await this.data.sources.retire(context, id, raw.expectedVersion as number); await publish(200, { retired: true }); }
      } else if (action === 'bind' || action === 'rotate') {
        method(request, response, ['POST']); await this.data.sources[action](context, id, await input()); await publish(200, { updated: true });
      } else if (action === 'policy') {
        method(request, response, ['GET']); await this.data.sources.capability(context, 'build');
        const s = await this.data.sources.get(context, id); await publish(200, { version: s.version, policy: s.policy });
      } else if (action === 'refresh') {
        method(request, response, ['POST']); object(await input(), []); await publish(200, await this.data.refresh(context, id));
      } else {
        method(request, response, ['POST']); await publish(200, await this.data.execute(context, id, action === 'rows' ? 'output' : action as 'query' | 'preview' | 'output', await input()));
      }
      return true;
    }
    const upload = /^\/api\/uploads\/(upload_[a-f0-9]{32})$/.exec(path);
    if (upload) { method(request, response, ['GET']); await publish(200, await this.data.execute(context, upload[1]!, 'preview', {})); return true; }
    const ai = /^\/api\/ai\/sources\/([A-Za-z0-9_-]{1,512})\/schema$/.exec(path);
    if (ai) { method(request, response, ['GET']); await publish(200, await this.data.schema(context, ai[1]!, 'ai')); return true; }
    if (path === '/api/prep-datasets') { method(request, response, ['GET']); await publish(200, { datasets: await this.prep.list(context), persistence: 'durable' }); return true; }
    if (path === '/api/prep-datasets/import') { method(request, response, ['POST']); await publish(201, await this.prep.import(context, await input())); return true; }
    const prep = /^\/api\/datasets\/([A-Za-z0-9_-]{1,128})\/(prep(?:\/preview)?|execution|refresh|rows|query|share|permissions|embed)$/.exec(path);
    if (prep) {
      const id = prep[1]!, action = prep[2]!;
      if (['share', 'permissions', 'embed'].includes(action)) { await this.prep.get(context, id); sourceError(action === 'embed' ? 'PREP_EMBED_REFUSED' : 'PREP_SHARING_REFUSED', 403); }
      if (action === 'prep') {
        method(request, response, ['GET', 'PUT', 'DELETE']);
        if (request.method === 'GET') await publish(200, await this.prep.get(context, id));
        else if (request.method === 'PUT') await publish(200, await this.prep.save(context, id, await input()));
        else { const raw = object(await input(), ['expectedVersion']); await this.prep.remove(context, id, raw.expectedVersion as number); await publish(200, { removed: true }); }
      } else if (action === 'prep/preview') {
        method(request, response, ['POST']); await publish(200, await this.prep.preview(context, id, await input()));
      } else if (action === 'execution') {
        method(request, response, ['GET', 'PUT']);
        await publish(200, request.method === 'GET' ? (await this.prep.get(context, id)).execution : await this.prep.configure(context, id, await input()));
      } else {
        method(request, response, action === 'rows' ? ['GET'] : ['POST']);
        await publish(200, await this.prep.execute(context, id, action as 'rows' | 'query' | 'refresh', action === 'rows' ? {} : await input()));
      }
      return true;
    }
    return false;
  }
}
