import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, createApiClient } from '../build/test/api-client.js';

const definition = { DataSetIdentifierDeclarations: [], Sheets: [] };
const response = body => Response.json(body);

test('session errors preserve structured reason and HTTP status without leaking response bodies', async () => {
  for (const [reply, code] of [
    [Response.json({ errorCode: 'SECURITY_NOT_CONFIGURED', Message: 'private details' }, { status: 503 }), 'SECURITY_NOT_CONFIGURED'],
    [new Response('<h1>proxy failure</h1>', { status: 502 }), undefined],
    [Response.json(null, { status: 401 }), undefined],
    [Response.json({ errorCode: 42 }, { status: 403 }), undefined],
  ]) {
    const client = createApiClient('/api', async () => reply);
    await assert.rejects(client.getSession(), error => error instanceof ApiError && error.status === reply.status && error.errorCode === code && error.message === 'Session request failed.');
  }
});

test('session success keeps the existing request transport and rejects malformed identities', async () => {
  const controller = new AbortController();
  const session = { id: 'u', namespaceId: 'n', name: 'User', role: 'author' };
  const client = createApiClient('/api', async (url, options) => {
    assert.equal(url, '/api/api/session');
    assert.deepEqual(options, { signal: controller.signal, credentials: 'same-origin', headers: { Accept: 'application/json' } });
    return Response.json(session);
  });
  assert.deepEqual(await client.getSession(controller.signal), session);
  for (const body of [{ ...session, role: 'admin' }, { ...session, id: undefined }, { mode: 'demo' }, null]) {
    await assert.rejects(createApiClient('/api', async () => Response.json(body)).getSession());
  }
});

for (const [kind, route, key] of [['Analysis', 'analyses', 'AnalysisId'], ['Dashboard', 'dashboards', 'DashboardId']]) {
  test(`fetches ${kind.toLowerCase()} definitions with configured prefix, headers and cancellation signal`, async () => {
    const controller = new AbortController();
    const calls = [];
    const client = createApiClient('http://localhost:3000/prefix///', async (...args) => {
      calls.push(args);
      return response({ [key]: 'sample_id-1', Name: 'Example', Definition: definition, RequestId: 'request-1' });
    });
    assert.deepEqual(await client[`get${kind}Definition`]('sample_id-1', controller.signal), {
      id: 'sample_id-1', name: 'Example', definition: { dataSetIdentifierDeclarations: [], sheets: [] },
    });
    assert.deepEqual(calls, [[`http://localhost:3000/prefix/${route}/sample_id-1/definition`, { signal: controller.signal, headers: { Accept: 'application/json' } }]]);
  });
}
test('default base URL uses the same-origin dev proxy and the client is lazy', async () => {
  const calls = [];
  const client = createApiClient(undefined, async url => { calls.push(url); return response({ AnalysisId: 'id', Definition: definition }); });
  assert.deepEqual(calls, []);
  assert.deepEqual(await client.getAnalysisDefinition('id'), { id: 'id', definition: { dataSetIdentifierDeclarations: [], sheets: [] } });
  assert.deepEqual(calls, ['/api/analyses/id/definition']);
});
test('HTTP JSON errors report transport status and API message', async () => {
  const client = createApiClient('/api', async () => Response.json({ Type: 'ResourceNotFoundException', Message: 'No such analysis', RequestId: 'r' }, { status: 404 }));
  await assert.rejects(client.getAnalysisDefinition('missing'), e => e instanceof ApiError && e.status === 404 && /No such analysis/.test(e.message));
});
test('root-relative and whitespace base URL configuration are normalized', async () => {
  for (const [base, prefix] of [['/', ''], ['  ', '/api']]) {
    let requested;
    const client = createApiClient(base, async url => { requested = url; return response({ AnalysisId: 'id', Definition: definition }); });
    await client.getAnalysisDefinition('id');
    assert.equal(requested, `${prefix}/analyses/id/definition`);
  }
});
test('non-JSON proxy errors and nonstandard error JSON retain HTTP status', async () => {
  for (const make of [() => new Response('Bad gateway', { status: 502 }), () => Response.json(null, { status: 500 })]) {
    const client = createApiClient('/api', async () => make());
    await assert.rejects(client.getAnalysisDefinition('id'), e => e instanceof ApiError && /HTTP 50[02]/.test(e.message));
  }
});
test('invalid success JSON is rejected', async () => {
  await assert.rejects(createApiClient('/api', async () => new Response('<html>')).getAnalysisDefinition('id'), /invalid JSON/);
});
test('valid JSON with malformed, wrong-ID or metadata-only response is rejected', async () => {
  for (const body of [null, {}, { Analysis: { AnalysisId: 'id' } }, { AnalysisId: 'other', Definition: definition }, { DashboardId: 'id', Definition: definition }, { AnalysisId: 'id', Definition: {} }, { AnalysisId: 'id', Definition: definition, Name: 123 }, { AnalysisId: 'id', Definition: definition, Errors: [{ Type: 'COLUMN_NOT_FOUND' }] }]) {
    await assert.rejects(createApiClient('/api', async () => response(body)).getAnalysisDefinition('id'), /Invalid definition response/);
  }
});
test('network rejection and AbortError propagate without falling back to fixtures', async () => {
  for (const error of [new TypeError('Failed to fetch'), new DOMException('Aborted', 'AbortError')]) {
    const client = createApiClient('/api', async () => { throw error; });
    await assert.rejects(client.getAnalysisDefinition('id'), e => e === error);
  }
});
test('invalid resource IDs cannot inject route segments or query parameters', async () => {
  let called = false;
  const client = createApiClient('/api', async () => { called = true; throw new Error('unexpected fetch'); });
  for (const id of ['', '../x', 'x/y', 'x?version=1', '%2f', 'x'.repeat(513)]) await assert.rejects(client.getAnalysisDefinition(id), /Resource ID/);
  assert.equal(called, false);
});
