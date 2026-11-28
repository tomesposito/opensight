import test from 'node:test';
import assert from 'node:assert/strict';
import { startEmbedTransport } from '../build/test/embed-transport.js';
import { embedAppClient } from '../build/test/embed-app-client.js';
import { parseRoute, routeHash } from '../build/test/app-navigation.js';
import { hostedAnalysisInput, saveHostedDraft } from '../build/test/hosted-publish.js';
import { emptyDraft, authorReducer, validateDraft } from '../build/test/authoring.js';
import { embeddedAnalysisDraft } from '../build/test/EmbeddedAnalysis.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
async function connected(t, respond = () => Response.json({})) {
  const listeners = new Map(), timers = new Map(), messages = [], states = [], calls = [];
  let timer = 0;
  const parent = { postMessage: (data, origin) => messages.push({ data, origin }) };
  const view = { parent, location: { origin: 'https://embed.example' }, document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
    addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key),
    setTimeout: fn => { timers.set(++timer, fn); return timer; }, clearTimeout: key => timers.delete(key),
    setInterval: fn => { timers.set(++timer, fn); return timer; }, clearInterval: key => timers.delete(key) };
  const id = 's'.repeat(32), credential = 'c'.repeat(43), expiresAt = Date.now() + 900000;
  const transport = startEmbedTransport({ sessionId: id, allowedDomains: ['https://host.example'], fullApp: { landingRoute: '/data' }, idleReconnect: true }, 'bootstrap', state => states.push(state), async t => t.ready(), view, async (path, init) => {
    calls.push({ path, init });
    if (path.endsWith('/redeem')) return Response.json({ credential, expiresAt });
    if (path.endsWith('/status')) return Response.json({ expiresAt });
    return respond(path, init);
  });
  const initialize = { source: parent, origin: 'https://host.example', data: { version: 2, type: 'opensight:initialize', sessionId: id, channelId: 'h'.repeat(32) } };
  listeners.get('message')(initialize); await settle();
  assert.equal(states.at(-1), 'ready');
  t.after(() => transport.destroy());
  return { transport, client: embedAppClient(transport), calls, messages, states, credential, initialize: () => listeners.get('message')?.(initialize) };
}

test('full-app lands on every route class, navigates and saves through one redeem without a terminal saved event', async t => {
  let version = 0;
  const f = await connected(t, path => path.includes('/api/v1/analyses') ? Response.json({ AnalysisId: 'working' }, { headers: { etag: `"${++version}"` } }) : Response.json({}));
  for (const path of ['/dashboards/d', '/data', '/analyses/author', '/analyses/author/a', '/data/preparation', '/ask-o']) {
    assert.equal(routeHash(parseRoute(`#${path}`)), `#${path}`);
    await f.client.authorizeRoute(path);
  }
  const draft = { ...emptyDraft(), title: 'Embedded', dataset: { id: 'prepared', name: 'Prepared', columns: [{ name: 'amount', type: 'INTEGER' }] } };
  let link = { analysisId: 'working' }; const persist = next => { link = next; };
  await saveHostedDraft(f.client.api, hostedAnalysisInput(draft), link, persist);
  await saveHostedDraft(f.client.api, hostedAnalysisInput({ ...draft, title: 'Edited again' }), link, persist);
  await f.client.authorizeRoute('/data'); f.initialize(); await settle();
  assert.deepEqual(f.messages.filter(m => m.data.payload).map(m => m.data.payload), [1, 2].map(version => ({ type: 'save', analysisId: 'working', version })));
  assert.equal(link.revision, 2); assert.equal(f.calls.filter(c => c.path.endsWith('/redeem')).length, 1);
  assert.deepEqual(f.states, ['ready']); assert.equal(f.messages.some(m => m.data.event === 'saved'), false);
  for (const call of f.calls.filter(c => c.path.includes('/app/'))) {
    assert.equal(call.init.credentials, 'omit'); assert.equal(call.init.redirect, 'error'); assert.equal(call.init.cache, 'no-store');
    assert.equal(call.init.headers.get('Authorization'), `Embed ${f.credential}`);
  }
  assert.ok(!JSON.stringify(f.messages).includes(f.credential));
});

test('full-app stale save errors retain their named errors and do not tear down editing', async t => {
  const f = await connected(t, () => Response.json({ errorCode: 'METADATA_CONFLICT' }, { status: 409 }));
  await assert.rejects(f.client.api.saveHostedAnalysis('a', { name: 'x', definition: {}, datasetBindings: {} }, 1), /METADATA_CONFLICT/);
  assert.deepEqual(f.states, ['ready']);
});

test('full-app credential stays scoped; revocation clears transport and further requests fail', async t => {
  const f = await connected(t, () => Response.json({ errorCode: 'EMBED_SESSION_REVOKED' }, { status: 401 }));
  await assert.rejects(f.transport.app('https://evil.example/api/users'), /EMBED_SCOPE_DENIED/);
  await assert.rejects(f.transport.app('/api/../users'), /EMBED_SCOPE_DENIED/);
  await assert.rejects(f.client.authorizeRoute('/data'), /EMBED_SESSION_REVOKED/);
  assert.equal(f.states.at(-1), 'revoked');
  await assert.rejects(f.client.authorizeRoute('/data'), /EMBED_UNAVAILABLE/);
});

test('full-app recovery storage is isolated in frame memory and can be cleared', async t => {
  const f = await connected(t), second = embedAppClient(f.transport);
  f.client.storage().setItem('draft', 'protected definition');
  assert.equal(second.storage().getItem('draft'), null);
  f.client.clear(); assert.equal(f.client.storage().getItem('draft'), null);
});

test('full-app opens the server-bound definition as a real editable draft without remapping columns', () => {
  const draft = { ...emptyDraft(), title: 'Existing', dataset: { id: 'prepared', name: 'Prepared', columns: [{ name: 'amount', type: 'INTEGER' }] } };
  const input = hostedAnalysisInput(draft);
  const opened = embeddedAnalysisDraft({ id: 'saved', name: 'Existing', version: 4, ...input, schemas: { sales_data: { columns: draft.dataset.columns } } });
  assert.equal(opened.dataset.id, 'prepared'); assert.equal(opened.title, 'Existing');
  assert.deepEqual(hostedAnalysisInput(opened).datasetBindings, input.datasetBindings);
});


test('full-app reopening preserves visual IDs and opaque definition fields while adding and editing real visuals', () => {
  let draft = { ...emptyDraft(), title: 'Visuals', dataset: { id: 'prepared', name: 'Prepared', columns: [{ name: 'amount', type: 'INTEGER' }] } };
  draft = authorReducer(draft, { type: 'add', kind: 'kpi' });
  draft.sheets[0].visuals[0].measures = ['amount'];
  const input = hostedAnalysisInput(draft); input.definition.extension = { preserved: true };
  let opened = embeddedAnalysisDraft({ id: 'saved', version: 4, ...input, schemas: { sales_data: { columns: draft.dataset.columns } } });
  const originalId = opened.sheets[0].visuals[0].imported.visualId;
  opened.sheets[0].visuals[0].title = 'Changed visual';
  opened = authorReducer(opened, { type: 'add', kind: 'kpi' });
  opened.sheets[0].visuals[1].measures = ['amount'];
  const saved = hostedAnalysisInput(opened);
  assert.deepEqual(saved.definition.extension, { preserved: true });
  assert.equal(saved.definition.sheets[0].visuals[0].kpiVisual.visualId, originalId);
  assert.equal(saved.definition.sheets[0].visuals[0].kpiVisual.title.formatText.plainText, 'Changed visual');
  assert.equal(saved.definition.sheets[0].visuals.length, 2);
  assert.equal(saved.definition.dataSetIdentifierDeclarations.length, 1);
  assert.equal(saved.definition.dataSetIdentifierDeclarations[0].dataSetArn, 'opensight:dataset:prepared');
  assert.ok(!JSON.stringify(saved).includes('renderable-sales'));
  assert.throws(() => validateDraft({ ...opened, dataset: { ...opened.dataset, id: 'foreign' } }));
  const multiple = structuredClone(opened); multiple.bundle.original.members.push(structuredClone(multiple.bundle.original.members[0]));
  assert.throws(() => validateDraft(multiple));
});
