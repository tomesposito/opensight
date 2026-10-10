import { Readable } from 'node:stream';
import { jobFixture } from '../../api/test/job-helpers.mjs';
import { upload } from '../../api/test/source-helpers.mjs';
import { HostedData } from '../../api/dist/hosted-data.js';
import { HostedDataRoutes } from '../../api/dist/hosted-data-routes.js';
import { createApiClient } from '../build/test/api-client.js';

// Use real durable metadata, HostedData and HostedPrep handlers. Only HTTP byte
// transport is in-process. Each request receives a fresh authenticated context;
// revision-bound bearer renewal remains the host's authentication responsibility.
export async function hostedDataFixture(t, { automation = true } = {}) {
  const f = await jobFixture(t);
  const data = new HostedData(f.sources, undefined, f.budgets);
  const routes = new HostedDataRoutes(data, automation ? f.store : undefined);
  const source = await f.sources.upload(await f.login(), upload());
  const pipeline = { version: 1, input: source.id, steps: [{ id: 'rename', kind: 'rename', config: { column: 'amount', name: 'revenue' } }] };
  await routes.prep.save(await f.login(), 'orders', { name: 'Orders', pipeline, expectedVersion: 0 });
  const calls = [];
  const fetcher = async (url, options = {}) => {
    const path = new URL(url, 'http://localhost').pathname;
    calls.push({ path, method: options.method ?? 'GET', body: options.body === undefined ? undefined : JSON.parse(options.body) });
    const request = Object.assign(Readable.from(options.body ? [Buffer.from(options.body)] : []), { method: options.method ?? 'GET', headers: { 'content-type': 'application/json' } });
    let result, status;
    const response = { writeHead(code) { status = code; }, end(body) { result = new Response(body, { status }); } };
    try {
      const handled = await routes.route(request, response, path, await f.login(), async () => {});
      if (!handled) throw new Error(`Unhandled hosted route: ${path}`);
      return result;
    } catch (error) {
      if (!error.code) throw error;
      return Response.json({ errorCode: error.code, Message: error.message }, { status: error.status ?? 400 });
    }
  };
  return { ...f, data, prep: routes.prep, source, pipeline, calls, fetcher, client: createApiClient('/', fetcher) };
}
