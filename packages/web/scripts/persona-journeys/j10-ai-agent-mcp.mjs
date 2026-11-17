// MCP-level journey: real protocol, hosted API and Postgres; no browser or provider.
import { randomBytes, randomUUID } from 'node:crypto';
import { assert, connectHostedMcp, runJourney, startHostedStack } from './harness.mjs';
import { decode32 } from '../../../api/test/hosted-helpers.mjs';
import { totp } from '../../../api/dist/auth-crypto.js';
import { upload } from '../../../api/test/source-helpers.mjs';

const good = (response, status = 200) => {
  assert.equal(response.status, status, JSON.stringify(response.body)); return response.body;
};
const kpi = (visualId, columnName) => ({ kpiVisual: { visualId, chartConfiguration: { fieldWells: {
  values: [{ numericalMeasureField: { fieldId: 'value', column: { dataSetIdentifier: 'sales', columnName },
    aggregationFunction: { simpleNumericalAggregation: 'SUM' } } }],
} } } });
function analysis(analysisId, datasetId, kind = 'prepared-dataset', visuals = [kpi('total', 'amount')]) {
  return { analysisId, name: analysisId, definition: {
    dataSetIdentifierDeclarations: [{ identifier: 'sales', dataSetArn: 'urn:synthetic:journey10:sales' }],
    calculatedFields: [], filterGroups: [], sheets: [{ sheetId: 'weekly', name: 'Weekly sales', visuals }],
  }, datasetBindings: { sales: { kind, id: datasetId } } };
}

// Trusted fixture setup, never counted as an agent action. Enrollment uses the
// real built-in auth implementation and issued token, like realEmbedFixture.
async function fixtureMember(stack) {
  const f = stack.fixture, email = 'journey10-author@example.test', password = randomBytes(24).toString('base64');
  await f.provisioning.inviteMember('journey10-author', f.tenant.tenantId, { email, name: 'Delegating author', role: 'author_ai' });
  const invitation = f.mail.messages.at(-1).html.match(/<code>([^<]+)<\/code>/)[1];
  const enrollment = await f.auth.enroll(invitation, password, 'local'), secret = decode32(enrollment.secret);
  const step = Math.floor(Date.now() / 30000);
  await f.auth.accept(invitation, password, totp(secret, step), 'local');
  const identity = await f.db.transaction(async c => {
    const [row] = await c.query('SELECT m.namespace_id, m.user_id FROM h2_memberships m JOIN h2_identities i ON i.subject = m.subject WHERE m.tenant_id = ? AND i.email = ?', [f.tenant.tenantId, email]);
    return { namespaceId: String(row.namespace_id), userId: String(row.user_id) };
  });
  let token, lastStep = step;
  return { get token() { return token; }, identity, context: () => f.metadata.authenticate(null, async () => identity),
    async login() {
      while (lastStep + 1 > Math.floor(Date.now() / 30000) + 1) await new Promise(r => setTimeout(r, 500));
      lastStep = Math.max(lastStep + 1, Math.floor(Date.now() / 30000));
      token = (await f.auth.login(email, password, totp(secret, lastStep), f.tenant.tenantId, 'local')).token;
      assert.deepEqual(await f.auth.verify(token), identity);
    },
    request: (path, method, body, headers) => stack.request(path, method, body, `Bearer ${token}`, headers) };
}

async function fixtures(stack) {
  const member = await fixtureMember(stack), f = stack.fixture;
  // Uploads/policy edits revoke sessions. Batch trusted source setup before
  // logging in; no stale token is repaired or silently retried by MCP.
  const source = await f.sources.upload(await member.context(), upload());
  const adminSource = await f.sources.upload(await f.context(), upload());
  const fullSources = {};
  const dataset = (id, sourceId) => ({ definition: { DataSet: { DataSetId: id, Name: id } },
    sources: [{ kind: 'source', id: sourceId, ownerId: member.identity.userId }] });
  for (const world of ['denied', 'missing']) {
    const full = await f.sources.upload(await member.context(), {
      ...upload(), base64: Buffer.from('region,amount,secret_amount\neast,10,100\nwest,20,200\neast,30,300\n').toString('base64'),
    });
    fullSources[world] = full.id;
    await f.metadata.put(await f.context(), { kind: 'dataset', id: `cls-${world}` }, dataset(`cls-${world}`, full.id), 0);
  }
  const missing = await f.sources.upload(await member.context(), {
    ...upload(), base64: Buffer.from('region,amount\neast,10\nwest,20\neast,30\n').toString('base64'),
  });
  stack.tokens.admin = (await f.login()).token;
  // A real second member owns private resources, so empty lists cannot make
  // the visibility assertions pass accidentally.
  good(await stack.request('/api/datasets/admin-private/prep', 'PUT', {
    name: 'Admin private sales', pipeline: { version: 1, input: adminSource.id, steps: [] }, expectedVersion: 0,
  }));
  good(await stack.request('/api/v1/analyses', 'POST', analysis('admin-private', 'admin-private')), 201);
  const privateKey = { kind: 'analysis', id: 'admin-private' }, admin = await f.context();
  const privateAsset = await f.metadata.get(admin, privateKey);
  await f.metadata.put(admin, privateKey, { ...privateAsset.body,
    grants: [{ principal: { type: 'user', id: admin.userId }, role: 'co-owner' }],
  }, privateAsset.version);

  await member.login();
  for (const id of ['weekly-sales', 'refresh-sales']) {
    good(await member.request(`/api/datasets/${id}/prep`, 'PUT', {
      name: id, pipeline: { version: 1, input: source.id, steps: [] }, expectedVersion: 0,
    }));
  }
  good(await member.request('/api/datasets/refresh-sales/execution', 'PUT', { mode: 'BLAZE', intervalMinutes: null, expectedVersion: 1 }));
  good(await member.request('/api/v1/analyses', 'POST', analysis('weekly-baseline', 'weekly-sales')), 201);
  const baseline = good(await member.request('/api/v1/analyses/weekly-baseline/publish', 'POST', {}), 201);

  // Current publication is v2. A newer draft has different math, making both
  // the returned number and reported version meaningful assertions.
  const metric = { name: 'Weekly sales', expression: 'sum({amount})', defaultAggregation: 'SUM',
    format: { style: 'number', decimalPlaces: 2 }, description: 'Governed weekly sales', synonyms: [] };
  good(await member.request('/api/v1/metrics', 'POST', { id: 'weekly-sales',
    dataset: { kind: 'prepared-dataset', id: 'weekly-sales', ownerId: member.identity.userId }, definition: metric,
  }), 201);
  const published = good(await member.request('/api/v1/metrics/weekly-sales/publish', 'POST', {}, { 'If-Match': '"1"' }));
  assert.equal(published.publishedVersion, 2);
  const edited = good(await member.request('/api/v1/metrics/weekly-sales', 'PUT', {
    definition: { ...metric, expression: 'sum({amount}) * 10' },
  }, { 'If-Match': '"2"' }));
  assert.equal(edited.version, 3); assert.equal(edited.publishedVersion, 2);

  // Freeze identical valid visuals before the two source schemas diverge.
  // Then deny the field in one world and remove it in the other. Queries reach
  // HostedDashboards' security-aware planner, never prep/draft validation.
  const probes = {};
  for (const world of ['denied', 'missing']) {
    const id = `cls-${world}`;
    good(await member.request('/api/v1/analyses', 'POST', analysis(id, id, 'dataset', [kpi('allowed', 'amount'), kpi('probe', 'secret_amount')])), 201);
    const dashboard = good(await member.request(`/api/v1/analyses/${id}/publish`, 'POST', {}), 201);
    probes[world] = { id: dashboard.DashboardId, version: dashboard.Version, sourceId: world === 'denied' ? fullSources.denied : missing.id };
  }
  await f.sources.bind(await member.context(), fullSources.denied, { expectedVersion: 1,
    policy: { rowLevel: false, rowRules: [], protectedColumns: ['secret_amount'], columnGrants: [] },
  });
  await f.metadata.put(await f.context(), { kind: 'dataset', id: 'cls-missing' }, dataset('cls-missing', missing.id), 1);
  await member.login(); stack.tokens.admin = (await f.login()).token;
  return { member, probes, baseline, publishedVersion: published.publishedVersion };
}

await runJourney('j10-ai-agent-mcp', 'AI Agent', async j => {
  const stack = await startHostedStack({ entitlements: { computeAttempts: 1 } }); j.cleanup(stack.stop);
  const { member, probes, baseline, publishedVersion } = await fixtures(stack);
  let client, toolNames, draft, dashboardsBefore;
  const calls = [];
  const call = async (name, args = {}) => {
    calls.push(name);
    const result = await client.callTool({ name, arguments: args });
    assert.ok(result.structuredContent, `${name}: structured MCP result required`);
    assert.deepEqual(JSON.parse(result.content.find(c => c.type === 'text').text), result.structuredContent);
    return { status: result._meta?.status, body: result.structuredContent, isError: result.isError === true };
  };
  const success = async (name, args, status = 200) => {
    const result = await call(name, args); assert.equal(result.isError, false, JSON.stringify(result.body)); return good(result, status);
  };

  await j.step('connect-member-mcp', null, async () => {
    // Identity evidence comes from the real session API; MCP has no session tool.
    const session = good(await member.request('/api/session'));
    assert.equal(session.role, 'author_ai'); assert.equal(session.tenantId, stack.fixture.tenant.tenantId);
    assert.notEqual(member.identity.userId, stack.fixture.identity.userId);
    assert.equal(good(await stack.request('/api/session')).role, 'administrator');
    const connection = await connectHostedMcp(stack, member.token); j.cleanup(connection.stop); client = connection.client;
    toolNames = (await client.listTools()).tools.map(t => t.name);
    for (const name of ['list_datasets', 'list_analyses', 'list_dashboards', 'create_analysis', 'run_dataset_query', 'query_dashboard_visual', 'refresh_dataset']) assert.ok(toolNames.includes(name), name);
    assert.deepEqual(toolNames.filter(name => /metric|generat|audit|history/.test(name)), [], 'Revisit the recorded gaps when MCP gains these tools');
    return { transport: 'SDK Client + InMemoryTransport → real createMcpServer → hosted HTTP on localhost, Host opensight.test',
      role: session.role, workspace: session.tenantId, member: member.identity.userId, tools: toolNames, browserDriven: false };
  });
  await j.step('member-scoped-visibility', null, async () => {
    const datasets = await success('list_datasets'), analyses = await success('list_analyses');
    dashboardsBefore = await success('list_dashboards');
    assert.equal(datasets.nextCursor, null); assert.equal(analyses.nextCursor, null); assert.equal(dashboardsBefore.nextCursor, null);
    assert.deepEqual(datasets.items.map(d => d.id).sort(), ['refresh-sales', 'weekly-sales']);
    assert.ok(analyses.items.some(a => a.id === 'weekly-baseline'));
    assert.ok(dashboardsBefore.items.some(d => d.id === baseline.DashboardId));
    assert.ok(!analyses.items.some(a => a.id === 'admin-private'));
    assert.ok(good(await stack.request('/api/v1/datasets')).items.some(d => d.id === 'admin-private'));
    assert.ok(good(await stack.request('/api/v1/analyses')).items.some(a => a.id === 'admin-private'));
    for (const name of ['describe_dataset', 'describe_analysis']) {
      const denied = await call(name, { id: 'admin-private' });
      assert.equal(denied.isError, true); assert.equal(denied.status, 404);
    }
    for (const probe of Object.values(probes)) {
      const schema = await success('describe_source', { id: probe.sourceId });
      assert.deepEqual(schema.columns.map(c => c.name), ['region', 'amount']);
    }
    return 'Own datasets, existing analyses and published dashboards are listed; the administrator’s private dataset/analysis are absent and direct probes return 404. Denied/missing source schemas both expose only region and amount.';
  });
  await j.step('delegated-weekly-sales-draft', null, async () => {
    const body = analysis('agent-weekly-sales-draft', 'weekly-sales', 'prepared-dataset', [{ barChartVisual: {
      visualId: 'regional-sales', chartConfiguration: { fieldWells: { barChartAggregatedFieldWells: {
        category: [{ categoricalDimensionField: { fieldId: 'region', column: { dataSetIdentifier: 'sales', columnName: 'region' } } }],
        values: [{ numericalMeasureField: { fieldId: 'sales', column: { dataSetIdentifier: 'sales', columnName: '__metric_weekly-sales' }, aggregationFunction: { simpleNumericalAggregation: 'SUM' } } }],
      } } },
    } }]);
    body.name = 'Weekly sales by region — human review';
    draft = await success('create_analysis', { body, idempotencyKey: randomUUID() }, 201);
    assert.equal(draft.AnalysisId, body.analysisId); assert.deepEqual(draft.Errors, []);
    assert.deepEqual(await success('describe_analysis', { id: draft.AnalysisId }), draft);
    assert.deepEqual(await success('list_dashboards'), dashboardsBefore);
    return { task: 'Rebuild the weekly sales view with the new region split.', analysisId: draft.AnalysisId, published: false,
      metricReferenceSuppliedByHuman: '__metric_weekly-sales', detail: 'MCP created and read back the regional bar-chart draft; the published dashboard list is unchanged.' };
  });
  await j.step('governed-metric-published-version', null, async () => {
    const result = await success('run_dataset_query', { id: 'weekly-sales', query: {
      dimensions: [{ fieldId: 'region', columnName: 'region' }],
      measures: [{ fieldId: 'sales', columnName: '__metric_weekly-sales', aggregation: 'SUM' }], filters: [],
    } });
    assert.deepEqual([...result.rows].sort((a, b) => a.region.localeCompare(b.region)), [{ region: 'east', sales: 40 }, { region: 'west', sales: 20 }]);
    assert.equal(result.metrics.length, 1);
    const metric = result.metrics[0]; assert.equal(metric.id, 'weekly-sales'); assert.equal(metric.name, 'Weekly sales');
    assert.equal(metric.version, publishedVersion); assert.equal(metric.expression, 'sum({amount})');
    return { rows: result.rows, metric, newerUnpublishedVersion: 3, detail: 'Reserved __metric_<id> resolves to published v2, not the newer v3 draft with tenfold values.' };
  });
  j.gap('metric-discovery-name-version-selection',
    'The agent discovers governed metrics and selects a metric directly by name and version over MCP.',
    'MCP has no metric discovery/version-selection tool. run_dataset_query accepts the human-supplied __metric_weekly-sales ID and reports current published v2; it cannot select a named historical version.');
  await j.step('cls-denied-equals-missing', null, async () => {
    const failures = {};
    for (const [world, { id, version }] of Object.entries(probes)) {
      const allowed = await success('query_dashboard_visual', { id, version, visualId: 'allowed', body: {} });
      assert.deepEqual(allowed.rows, [{ value: 60 }]);
      const result = await call('query_dashboard_visual', { id, version, visualId: 'probe', body: {} });
      assert.equal(result.isError, true); assert.equal(result.status, 422);
      assert.equal(result.body.errorCode, 'UNRESOLVED_BINDING'); assert.equal(typeof result.body.path, 'string');
      assert.equal(result.body.message, `${result.body.path}: unknown column: secret_amount`);
      assert.equal('rows' in result.body, false);
      failures[world] = { status: result.status, body: result.body };
    }
    assert.deepEqual(failures.denied, failures.missing, 'Compare status and full body without normalization');
    return { field: 'secret_amount', ...failures, detail: 'Both allowed controls return 60; the frozen probe visuals reach the security-aware dashboard planner and return identical errors.' };
  });
  j.gap('pii-field-name-stop',
    'A personal-looking field name stops the MCP task with AI_FIELD_NAME_PII before provider egress.',
    'AI_FIELD_NAME_PII is enforced only on generative routes (o-generative/ai-guard); no MCP tool reaches them. No provider call or simulated PII stop is counted.');
  await j.step('compute-quota-stops-refresh', null, async () => {
    const first = await success('refresh_dataset', { id: 'refresh-sales', idempotencyKey: randomUUID() });
    assert.equal(first.refreshed, true); assert.equal(first.mode, 'BLAZE'); assert.equal(first.state, 'ready');
    const second = await call('refresh_dataset', { id: 'refresh-sales', idempotencyKey: randomUUID() });
    assert.equal(second.isError, true); assert.equal(second.status, 429); assert.equal(second.body.errorCode, 'USAGE_LIMIT_EXCEEDED');
    return { entitlement: { computeAttempts: 1 }, first, second, detail: 'Distinct idempotency keys exercise two real refresh attempts; the second stops at the compute quota. This is not an AI-spend-cap assertion.' };
  });
  j.gap('ai-spend-cap-binding',
    'The workspace AI spend cap binds agent work through MCP.',
    'MCP exposes no AI/generative call, so aiSpendCapCents does not bind this task. The real reachable stop is computeAttempts: 1: first BLAZE refresh succeeds, second returns 429 USAGE_LIMIT_EXCEEDED.');
  await j.step('human-reviews-unpublished-draft', null, async () => {
    // The delegating human uses their own member session directly, not the
    // agent client or the separate administrator's source authority.
    const reviewed = good(await member.request(`/api/v1/analyses/${draft.AnalysisId}`));
    assert.deepEqual(reviewed, draft); assert.deepEqual(reviewed.Errors, []);
    const dashboards = good(await member.request('/api/v1/dashboards'));
    assert.deepEqual(dashboards, dashboardsBefore);
    for (const dashboard of dashboards.items) {
      assert.notEqual(good(await member.request(`/api/v1/dashboards/${dashboard.id}`)).SourceAnalysisId, draft.AnalysisId);
    }
    const audit = await member.request('/api/host/audit');
    assert.equal(audit.status, 403); assert.equal(audit.body.errorCode, 'OPERATOR_REQUIRED');
    assert.ok(!calls.includes('publish_analysis'));
    return { analysisId: reviewed.AnalysisId, name: reviewed.Name, published: false,
      detail: 'Human API read matches the MCP draft exactly; no published dashboard references it and the agent never called publish_analysis.' };
  });
  j.gap('audit-member-identity',
    'The human can inspect workspace action history showing the delegating member identity on every MCP action.',
    'The audit read endpoint is operator-only /api/host/audit (human member read: 403 OPERATOR_REQUIRED); MCP has no workspace action-history tool. Session identity is verified, but an attributable trail for every agent action cannot be reviewed through MCP.');
});
