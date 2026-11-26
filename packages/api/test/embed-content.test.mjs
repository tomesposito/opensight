import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionFixture, request } from './embed-session-helpers.mjs';
import { readerMember, seedEmbedContent, assetDefinition, interactiveDefinition, configureInteractions } from './embed-content-helpers.mjs';
import { tagSecurity } from '../dist/embed-content.js';
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
  await assert.rejects(f.content.visuals(opened.context, opened.session, forged), { code: 'UNRESOLVED_BINDING' }); // #180: planner conceals denied-column existence.
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

test('H6 anonymous tag configuration fails closed on absent, malformed, duplicate and unknown rule keys', () => {
  const base = { namespaceId: 'namespace', userId: 'issuer', users: [{ id: 'issuer', namespaceId: 'namespace' }], groups: [], policy: { namespaceId: 'namespace', dataSetArn: 'dataset', rowLevel: true, rowRules: [] } };
  const rule = { TagKey: 'region', ColumnName: 'region' }, config = { Status: 'ENABLED', TagRules: [rule] };
  for (const raw of [undefined, { ...config, TagRules: [{ ColumnName: 'region' }] }, { ...config, TagRules: [rule, rule] }, { ...config, TagRuleConfigurations: [['unknown'], ['region']] }, { ...config, Status: 'DISABLED' }]) {
    assert.throws(() => tagSecurity(base, raw === undefined ? {} : { RowLevelPermissionTagConfiguration: raw }, { region: 'east' }), { code: 'EMBED_TAG_CONFIGURATION_REQUIRED' });
  }
  const resolved = tagSecurity(base, { RowLevelPermissionTagConfiguration: { ...config, TagRules: [{ ...rule, TagMultiValueDelimiter: '|', MatchAllValue: '*' }] } }, { region: 'east|west' });
  assert.deepEqual(resolved.policy.rowRules[0].predicate, { any: [{ all: [{ column: 'region', operator: 'in', values: ['east', 'west'] }] }] });
  assert.equal(resolved.userId, 'anonymous'); assert.deepEqual(resolved.policy.columnGrants, []);
});

test('#335 dashboard and visual controls re-plan typed state within viewer RLS and preserve stored defaults', async t => {
  const f = await fixture(t); await configureInteractions(f);
  for (const ExperienceConfiguration of [request().ExperienceConfiguration, { DashboardVisual: { InitialDashboardVisualId: { DashboardId: 'dashboard', SheetId: 'sheet', VisualId: 'total' } } }]) {
    const opened = await f.open(request({ ExperienceConfiguration, UserArn: f.arn('user', f.reader.identity.userId) }));
    const read = state => f.content.content(opened.context, opened.session, state);
    const initial = await read(); assert.deepEqual(initial.visuals[0].rows, [{ amount: 40 }]);
    assert.equal(initial.controls.filters[0].label, 'Regions'); assert.equal(initial.controls.parameters[0].label, 'Minimum amount');
    const narrowed = await read({ filters: { 'region-filter': ['east'] }, parameters: { Minimum: [25] } });
    assert.deepEqual(narrowed.visuals[0].rows, [{ amount: 30 }]);
    assert.deepEqual(narrowed.controls.parameters[0].values, [25]);
    // Requesting west never grants the viewer the issuer's west row (amount 20).
    for (const filters of [{ 'region-filter': ['west'] }, { 'region-filter': [] }, { 'region-filter': ["east' OR 1=1 --"] }]) {
      assert.deepEqual((await read({ filters })).visuals[0].rows, [{ amount: null }]);
    }
    assert.deepEqual((await read({ parameters: { Minimum: [] } })).visuals[0].rows, [{ amount: null }]);
    assert.deepEqual((await read()).visuals[0].rows, [{ amount: 40 }]); // No server/session persistence.
  }
  const stored = await f.metadata.get(await f.context(), { kind: 'dashboard', id: 'dashboard' });
  assert.deepEqual(stored.body.definition, interactiveDefinition());
});

test('#335 flags independently hide controls and reject even empty state maps before source I/O', async t => {
  for (const features of [{ filtering: false, parameterControls: false }, { filtering: true, parameterControls: false }, { filtering: false, parameterControls: true }]) {
    const f = await fixture(t); await configureInteractions(f, features); const opened = await f.open();
    const initial = await f.content.content(opened.context, opened.session);
    assert.equal(initial.controls.filters.length, Number(features.filtering));
    assert.equal(initial.controls.parameters.length, Number(features.parameterControls));
    f.content.data.table = async () => assert.fail('Disabled state must not read a source');
    for (const [key, flag] of [['filters', 'filtering'], ['parameters', 'parameterControls']]) if (!features[flag]) {
      for (const value of [{}, null, { unknown: ['west'] }]) await assert.rejects(f.content.content(opened.context, opened.session, { [key]: value }), { code: 'EMBED_FEATURE_DISABLED' });
    }
  }
});

test('#335 unknown, mistyped, structural, duplicate and oversized state fails before source I/O', async t => {
  const f = await fixture(t); await configureInteractions(f); const opened = await f.open();
  f.content.data.table = async () => assert.fail('Invalid state must not read a source');
  for (const state of [null, [], { security: {} }, { filters: null }, { parameters: [] },
    { filters: { unknown: ['east'] } }, { filters: { 'region-filter': [1] } }, { filters: { 'region-filter': ['east', 'east'] } },
    { filters: { 'region-filter': ['x'.repeat(10001)] } }, { filters: { 'region-filter': { ColumnName: 'private' } } },
    { filters: { 'minimum-filter': [30] } }, { parameters: { Unknown: [0] } }, { parameters: { Minimum: ['25'] } },
    { parameters: { Minimum: [1.5] } }, { parameters: { Minimum: [1, 2] } }, { parameters: { Minimum: Array(1001).fill(1) } },
    JSON.parse('{"filters":{"__proto__":["east"]}}'), { parameters: { constructor: [1] } }]) {
    await assert.rejects(f.content.content(opened.context, opened.session, state), { code: 'EMBED_STATE_INVALID' });
  }
});

test('#335 filter and parameter CLS bypasses, including calculated columns, fail before source I/O', async t => {
  for (const mode of ['filter', 'parameter', 'calculated']) {
    const f = await fixture(t), definition = interactiveDefinition(), d = definition.Definition;
    if (mode === 'filter') d.FilterGroups[0].Filters[0].CategoryFilter.Column.ColumnName = 'private';
    else {
      d.ParameterDeclarations = [{ StringParameterDeclaration: { Name: 'Secret', ParameterValueType: 'SINGLE_VALUED', DefaultValues: { StaticValues: ['hidden'] } } }];
      d.Sheets[0].ParameterControls[0].TextField.SourceParameterName = 'Secret';
      d.FilterGroups[1].Filters = [{ CategoryFilter: { FilterId: 'secret-filter', Column: { DataSetIdentifier: 'data', ColumnName: mode === 'calculated' ? 'alias' : 'private' }, Configuration: { CustomFilterConfiguration: { MatchOperator: 'EQUALS', NullOption: 'NON_NULLS_ONLY', ParameterName: 'Secret' } } } }];
      if (mode === 'calculated') d.CalculatedFields = [{ Name: 'alias', DataSetIdentifier: 'data', Expression: '{private}' }];
    }
    await configureInteractions(f, { definition });
    const opened = await f.open(request({ UserArn: f.arn('user', f.reader.identity.userId) }));
    f.content.data.table = async () => assert.fail('CLS denial must precede source I/O');
    await assert.rejects(f.content.content(opened.context, opened.session, mode === 'filter' ? { filters: { 'region-filter': ['hidden'] } } : { parameters: { Secret: ['hidden'] } }), { code: 'UNRESOLVED_BINDING' });
  }
});

test('#335 scoped-out and disabled filters/parameters are not editable; calculations bind real parameters', async t => {
  const f = await fixture(t), definition = interactiveDefinition(), d = definition.Definition;
  const other = structuredClone(d.Sheets[0].Visuals[0]); other.KPIVisual.VisualId = 'other'; d.Sheets[0].Visuals.push(other);
  d.FilterGroups[0].Status = 'DISABLED';
  d.FilterGroups[1].ScopeConfiguration = { SelectedSheets: { SheetVisualScopingConfigurations: [{ SheetId: 'sheet', Scope: 'SELECTED_VISUALS', VisualIds: ['other'] }] } };
  d.ParameterDeclarations.push({ DecimalParameterDeclaration: { Name: 'Factor', ParameterValueType: 'SINGLE_VALUED', DefaultValues: { StaticValues: [1] } } });
  d.CalculatedFields = [{ Name: 'scaled', DataSetIdentifier: 'data', Expression: '{amount} * ${Factor}' }];
  d.Sheets[0].Visuals[0].KPIVisual.ChartConfiguration.FieldWells.Values[0].NumericalMeasureField.Column.ColumnName = 'scaled';
  await configureInteractions(f, { definition });
  const opened = await f.open({ UserArn: f.arn('user', f.reader.identity.userId), ExperienceConfiguration: { DashboardVisual: { InitialDashboardVisualId: { DashboardId: 'dashboard', SheetId: 'sheet', VisualId: 'total' } } } });
  const result = await f.content.content(opened.context, opened.session, { parameters: { Factor: [2] } });
  assert.deepEqual(result.visuals[0].rows, [{ amount: 80 }]);
  assert.deepEqual(result.controls.filters, []); assert.deepEqual(result.controls.parameters.map(p => p.id), ['Factor']);
  f.content.data.table = async () => assert.fail('Out-of-scope state must not read a source');
  for (const state of [{ filters: { 'region-filter': ['west'] } }, { parameters: { Minimum: [20] } }]) await assert.rejects(f.content.content(opened.context, opened.session, state), { code: 'EMBED_STATE_INVALID' });
});

test('#335 anonymous filtering intersects immutable tags and dataset RLS remains effective with parameters', async t => {
  const f = await fixture(t); await configureInteractions(f);
  const opened = await f.open(request({ Namespace: 'virtual', AuthorizedResourceArns: [f.arn('dashboard', 'dashboard')], SessionTags: [{ Key: 'region', Value: 'west' }] }), true);
  assert.deepEqual((await f.content.content(opened.context, opened.session, { filters: { 'region-filter': ['east'] } })).visuals[0].rows, [{ amount: null }]);
  await assert.rejects(f.content.content(opened.context, opened.session, { tags: { region: 'east' } }), { code: 'EMBED_STATE_INVALID' });
  await f.metadata.put(await f.context(), { kind: 'policy', id: 'dataset-policy' }, { datasetId: 'dataset', dataSetArn: 'urn:opensight:dataset', rowLevel: true,
    rowRules: [{ id: 'large', principals: [{ type: 'user', id: f.reader.identity.userId }], predicate: { column: 'amount', operator: 'gte', value: 30 } }], protectedColumns: [], columnGrants: [] });
  const reader = await f.open(request({ UserArn: f.arn('user', f.reader.identity.userId) }));
  assert.deepEqual((await f.content.content(reader.context, reader.session, { parameters: { Minimum: [0] }, filters: { 'region-filter': ['east', 'west'] } })).visuals[0].rows, [{ amount: 30 }]);
});
