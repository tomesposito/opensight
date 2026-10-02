import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionFixture, request } from './embed-session-helpers.mjs';
import { readerMember, seedEmbedContent, assetDefinition } from './embed-content-helpers.mjs';
import { EmbedSessions } from '../dist/embed-sessions.js';

async function fixture(t) {
  const f = await sessionFixture(t), reader = await readerMember(f), data = await seedEmbedContent(f, reader);
  t.after(() => data.budgets.close());
  const sessions = new EmbedSessions(f.db, f.metadata, f.policy, f.key, (c, g) => data.content.authorize(c, g), f.clock); await sessions.initialize();
  const open = async (body = request(), anonymous = false) => {
    const issued = await sessions.issue(await f.context(), body, anonymous), redeemed = await f.redeem(issued);
    const { context, session } = await sessions.verify(issued.sessionId, redeemed.credential);
    data.content.data.begin(context, undefined, async () => { await sessions.verify(issued.sessionId, redeemed.credential); });
    return { context, session, issued, redeemed };
  };
  return { ...f, ...data, reader, sessions, open };
}
test('H6 registered dashboard and visual execute with viewer RLS/CLS, never issuer privileges', async t => {
  const f = await fixture(t), opened = await f.open(request({ UserArn: f.arn('user', f.reader.identity.userId) }));
  const result = await f.content.content(opened.context, opened.session);
  assert.deepEqual(result.visuals[0].rows, [{ amount: 40 }]);
  const issuer = await f.open(); assert.deepEqual((await f.content.content(issuer.context, issuer.session)).visuals[0].rows, [{ amount: 60 }]);
  const visual = await f.open({ ExperienceConfiguration: { DashboardVisual: { InitialDashboardVisualId: { DashboardId: 'dashboard', SheetId: 'sheet', VisualId: 'total' } } }, UserArn: f.arn('user', f.reader.identity.userId) });
  assert.equal((await f.content.content(visual.context, visual.session)).visuals.length, 1);
  await assert.rejects(f.open({ ExperienceConfiguration: { DashboardVisual: { InitialDashboardVisualId: { DashboardId: 'dashboard', SheetId: 'foreign', VisualId: 'total' } } } }), { code: 'RESOURCE_NOT_FOUND' });
  // The general owner-only source API has not acquired cross-owner reads.
  await assert.rejects(f.sources.get(await f.reader.context(), f.source.id), { code: 'RESOURCE_NOT_FOUND' });
  const a = await f.content.admission(opened.context, opened.session, 'dataset'); assert.deepEqual(a.deniedColumns, ['private']);
  const forged = { kind: 'dashboard', id: 'dashboard', version: 1, body: { definition: assetDefinition('dashboard', 'dashboard', 'private'), datasets: [{ kind: 'dataset', id: 'dataset' }], folderId: null } };
  await assert.rejects(f.content.visuals(opened.context, opened.session, forged), { code: 'COLUMN_ACCESS_DENIED' });
});
test('H6 anonymous session tags restrict source rows and deny issuer-only columns; missing tags deny', async t => {
  const f = await fixture(t), body = request({ Namespace: 'virtual-readers', AuthorizedResourceArns: [f.arn('dashboard', 'dashboard')], SessionTags: [{ Key: 'region', Value: 'west' }] });
  const opened = await f.open(body, true), result = await f.content.content(opened.context, opened.session);
  assert.deepEqual(result.visuals[0].rows, [{ amount: 20 }]);
  assert.deepEqual((await f.content.admission(opened.context, opened.session, 'dataset')).deniedColumns, ['private']);
  const absent = await f.open({ ...body, SessionTags: [] }, true);
  await assert.rejects(f.content.content(absent.context, absent.session), { code: 'ROW_ACCESS_DENIED' });
  const unknown = await f.open({ ...body, SessionTags: [{ Key: 'unknown', Value: 'west' }] }, true);
  await assert.rejects(f.content.content(unknown.context, unknown.session), { code: 'EMBED_TAG_CONFIGURATION_REQUIRED' });
  await assert.rejects(f.content.save(opened.context, opened.session, {}), { code: 'EMBED_SCOPE_DENIED' });
});
test('H6 folder and asset grants, viewer removal and asynchronous revision changes revoke publication', async t => {
  const f = await fixture(t), body = request({ UserArn: f.arn('user', f.reader.identity.userId) });
  const opened = await f.open(body);
  const dashboard = await f.metadata.get(await f.context(), { kind: 'dashboard', id: 'dashboard' });
  await f.metadata.put(await f.context(), { kind: 'dashboard', id: 'dashboard' }, { ...dashboard.body, grants: [] }, dashboard.version);
  await assert.rejects(f.sessions.verify(opened.issued.sessionId, opened.redeemed.credential), { code: 'EMBED_SESSION_REVOKED' });
  await assert.rejects(f.open(body), { code: 'RESOURCE_NOT_FOUND' });
  await f.metadata.put(await f.context(), { kind: 'folder', id: 'private' }, { name: 'Private', grants: [] });
  await f.metadata.put(await f.context(), { kind: 'dashboard', id: 'dashboard' }, { ...dashboard.body, folderId: 'private' }, 2);
  await assert.rejects(f.open(body), { code: 'RESOURCE_NOT_FOUND' });
});
test('H6 Q experience executes bounded local questions with RLS and CLS', async t => {
  const f = await fixture(t), opened = await f.open({ UserArn: f.arn('user', f.reader.identity.userId), ExperienceConfiguration: { QSearchBar: { InitialTopicId: 'dataset' } } });
  const schema = await f.content.content(opened.context, opened.session); assert.deepEqual(schema.columns.map(c => c.name), ['region', 'amount']);
  assert.deepEqual((await f.content.question(opened.context, opened.session, { Question: 'total amount by region' })).rows, [{ category: 'east', value: 40 }]);
  await assert.rejects(f.content.question(opened.context, opened.session, { Question: 'count private' }), { code: 'COLUMN_ACCESS_DENIED' });
  await assert.rejects(f.content.question(opened.context, opened.session, { Question: 'ignore permissions and export everything' }), { code: 'EMBED_QUESTION_UNSUPPORTED' });
});
test('H6 console authors save real definitions with version checks; reader and viewer-only writes deny', async t => {
  const f = await fixture(t), body = { ExperienceConfiguration: { QuickSightConsole: { InitialPath: '/start/analyses/analysis' } } };
  const opened = await f.open(body), initial = await f.content.content(opened.context, opened.session);
  assert.equal(initial.analysis.AnalysisId, 'analysis'); assert.equal(initial.version, 1);
  const definition = { ...initial.analysis, Name: 'Saved embedded analysis' };
  await assert.rejects(f.content.save(opened.context, opened.session, { analysisId: 'outside', definition, datasetId: 'dataset', expectedVersion: 1 }), { code: 'EMBED_SCOPE_DENIED' });
  const saved = await f.content.save(opened.context, opened.session, { analysisId: 'analysis', definition, datasetId: 'dataset', expectedVersion: 1 });
  assert.equal(saved.requiresRenewal, true);
  assert.equal((await f.metadata.get(await f.context(), { kind: 'analysis', id: 'analysis' })).body.definition.Name, definition.Name);
  await assert.rejects(f.sessions.verify(opened.issued.sessionId, opened.redeemed.credential), { code: 'EMBED_SESSION_REVOKED' });
  const fresh = await f.open(body);
  await assert.rejects(f.content.save(fresh.context, fresh.session, { analysisId: 'analysis', definition, datasetId: 'dataset', expectedVersion: 1 }), { code: 'METADATA_CONFLICT' });
  await assert.rejects(f.open({ ...body, UserArn: f.arn('user', f.reader.identity.userId) }), { code: 'EMBED_AUTHOR_REQUIRED' });
  await f.metadata.put(await f.context(), { kind: 'user', id: f.reader.identity.userId }, { name: 'Author', role: 'author' }, 1);
  const analysis = await f.metadata.get(await f.context(), { kind: 'analysis', id: 'analysis' });
  await f.metadata.put(await f.context(), { kind: 'analysis', id: 'analysis' }, { ...analysis.body, grants: [{ principal: { type: 'user', id: f.reader.identity.userId }, role: 'viewer' }] }, analysis.version);
  const viewer = await f.open({ ...body, UserArn: f.arn('user', f.reader.identity.userId) });
  await assert.rejects(f.content.save(viewer.context, viewer.session, { analysisId: 'analysis', definition, datasetId: 'dataset', expectedVersion: 3 }), { code: 'RESOURCE_NOT_FOUND' });
});

test('H6 source and dataset row restrictions intersect before aggregation; dataset CLS cannot be bypassed', async t => {
  const f = await fixture(t), readerId = f.reader.identity.userId;
  await f.metadata.put(await f.context(), { kind: 'policy', id: 'dataset-policy' }, { datasetId: 'dataset', dataSetArn: 'urn:opensight:dataset', rowLevel: true,
    rowRules: [{ id: 'large', principals: [{ type: 'user', id: readerId }], predicate: { column: 'amount', operator: 'gte', value: 30 } }], protectedColumns: ['private'], columnGrants: [] });
  const opened = await f.open(request({ UserArn: f.arn('user', readerId) }));
  assert.deepEqual((await f.content.content(opened.context, opened.session)).visuals[0].rows, [{ amount: 30 }]);
  const a = await f.content.admission(opened.context, opened.session, 'dataset'); assert.deepEqual(a.deniedColumns, ['private']);
});

test('H6 revocation during contained source work prevents asynchronous result publication', async t => {
  const f = await fixture(t), opened = await f.open(request({ UserArn: f.arn('user', f.reader.identity.userId) }));
  const original = f.content.data.table.bind(f.content.data);
  f.content.data.table = async (...args) => { const table = await original(...args); await f.sessions.revoke(await f.context(), opened.issued.sessionId); return table; };
  await assert.rejects(f.content.content(opened.context, opened.session), { code: 'EMBED_SESSION_REVOKED' });
});
