// MCP-level journey: real protocol, hosted API and Postgres; no browser or provider.
import { randomBytes, randomUUID } from 'node:crypto';
import { assert, connectHostedMcp, runJourney, startHostedStack } from './harness.mjs';
import { decode32 } from '../../../api/test/hosted-helpers.mjs';
import { appendOperatorAudit, OPERATOR_ACTOR } from '../../../api/dist/operator-audit.js';
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
  // A source whose schema carries a personal-looking (email-shaped) column
  // name, for the field-name PII stop step. Uploaded in the pre-login batch;
  // the prep dataset is created inside the step, after the visibility step
  // has asserted the member's exact dataset list.
  const piiSource = await f.sources.upload(await member.context(), {
    ...upload(), base64: Buffer.from('region,amount,jane.doe@example.com\neast,10,a\nwest,20,b\neast,30,c\n').toString('base64'),
  });
  const aiSource = await f.sources.upload(await member.context(), {
    ...upload(), base64: Buffer.from('region,revenue\neast,17\nwest,23\neast,31\n').toString('base64'),
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
  good(await member.request('/api/datasets/ai-sales/prep', 'PUT', {
    name: 'ai-sales', pipeline: { version: 1, input: aiSource.id, steps: [] }, expectedVersion: 0,
  }));
  good(await member.request('/api/datasets/refresh-sales/execution', 'PUT', { mode: 'BLAZE', intervalMinutes: null, expectedVersion: 1 }));
  good(await member.request('/api/v1/analyses', 'POST', analysis('weekly-baseline', 'weekly-sales')), 201);
  const baseline = good(await member.request('/api/v1/analyses/weekly-baseline/publish', 'POST', {}), 201);

  // Two publications have different math; a newer draft must never execute.
  // Both returned values and reported versions distinguish all three definitions.
  const metric = { name: 'Weekly sales', expression: 'sum({amount})', defaultAggregation: 'SUM',
    format: { style: 'number', decimalPlaces: 2 }, description: 'Governed weekly sales', synonyms: [] };
  good(await member.request('/api/v1/metrics', 'POST', { id: 'weekly-sales',
    dataset: { kind: 'prepared-dataset', id: 'weekly-sales', ownerId: member.identity.userId }, definition: metric,
  }), 201);
  const firstPublication = good(await member.request('/api/v1/metrics/weekly-sales/publish', 'POST', {}, { 'If-Match': '"1"' }));
  assert.equal(firstPublication.publishedVersion, 2);
  good(await member.request('/api/v1/metrics/weekly-sales', 'PUT', {
    definition: { ...metric, expression: 'sum({amount}) * 2' },
  }, { 'If-Match': '"2"' }));
  const published = good(await member.request('/api/v1/metrics/weekly-sales/publish', 'POST', {}, { 'If-Match': '"3"' }));
  assert.equal(published.publishedVersion, 4);
  const edited = good(await member.request('/api/v1/metrics/weekly-sales', 'PUT', {
    definition: { ...metric, expression: 'sum({amount}) * 10' },
  }, { 'If-Match': '"4"' }));
  assert.equal(edited.version, 5); assert.equal(edited.publishedVersion, 4);

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
  await f.db.transaction(async c => {
    await appendOperatorAudit(c, { actor: 'other-member', tenantId: 'journey-other-tenant', action: 'journey.foreign-audit' });
    await appendOperatorAudit(c, { action: 'journey.operator-audit' });
  });
  return { member, probes, baseline, publishedVersion: published.publishedVersion, piiSourceId: piiSource.id };
}

await runJourney('j10-ai-agent-mcp', 'AI Agent', async j => {
  const stack = await startHostedStack({ aiStub: true, entitlements: { computeAttempts: 1, aiSpendCapCents: 12, aiCostCentsPerMillionTokens: 1_000_000 } }); j.cleanup(stack.stop);
  const { member, probes, baseline, publishedVersion, piiSourceId } = await fixtures(stack);
  let client, toolNames, draft, dashboardsBefore;
  const calls = [], receipts = [];
  let historyBefore;
  const call = async (name, args = {}) => {
    calls.push(name);
    const result = await client.callTool({ name, arguments: args });
    assert.ok(result.structuredContent, `${name}: structured MCP result required`);
    assert.deepEqual(JSON.parse(result.content.find(c => c.type === 'text').text), result.structuredContent);
    const status = result._meta?.status;
    if (name !== 'list_workspace_action_history') receipts.push({ action: name, status, subject: args.id ?? null });
    return { status, body: result.structuredContent, isError: result.isError === true };
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
    for (const name of ['list_datasets', 'list_analyses', 'list_dashboards', 'create_analysis', 'run_dataset_query', 'query_dashboard_visual', 'refresh_dataset', 'list_metrics', 'describe_metric', 'list_metric_versions', 'ask_question', 'list_workspace_action_history']) assert.ok(toolNames.includes(name), name);
    assert.equal(toolNames.length, 60);
    assert.deepEqual(toolNames.filter(name => /metric/.test(name)).sort(), ['describe_metric', 'list_metric_versions', 'list_metrics']);
    assert.deepEqual(toolNames.filter(name => /audit|history/.test(name)), ['list_workspace_action_history']);
    historyBefore = good(await member.request('/api/v1/workspace/action-history', 'GET', undefined, { Limit: '200' }));
    assert.equal(historyBefore.nextCursor, null);
    return { transport: (process.env.OPENSIGHT_J10_MCP_TRANSPORT ?? 'http') === 'http' ? 'SDK Streamable HTTP → hosted /api/mcp with dynamic registration, consent and PKCE on localhost' : 'SDK Client + InMemoryTransport → real createMcpServer → hosted HTTP on localhost',
      role: session.role, workspace: session.tenantId, member: member.identity.userId, tools: toolNames, browserDriven: false };
  });
  await j.step('member-scoped-visibility', null, async () => {
    const datasets = await success('list_datasets'), analyses = await success('list_analyses');
    dashboardsBefore = await success('list_dashboards');
    assert.equal(datasets.nextCursor, null); assert.equal(analyses.nextCursor, null); assert.equal(dashboardsBefore.nextCursor, null);
    assert.deepEqual(datasets.items.map(d => d.id).sort(), ['ai-sales', 'refresh-sales', 'weekly-sales']);
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
    assert.deepEqual([...result.rows].sort((a, b) => a.region.localeCompare(b.region)), [{ region: 'east', sales: 80 }, { region: 'west', sales: 40 }]);
    assert.equal(result.metrics.length, 1);
    const metric = result.metrics[0]; assert.equal(metric.id, 'weekly-sales'); assert.equal(metric.name, 'Weekly sales');
    assert.equal(metric.version, publishedVersion); assert.equal(metric.expression, 'sum({amount}) * 2');
    return { rows: result.rows, metric, newerUnpublishedVersion: 5, detail: 'Reserved __metric_<id> resolves to published v4, not the newer v5 draft with tenfold values.' };
  });
  await j.step('metric-discovery-name-version-selection', null, async () => {
    const catalog = await success('list_metrics');
    const metric = catalog.items.find(m => m.definition.name === 'Weekly sales');
    assert.ok(metric); assert.equal(metric.id, 'weekly-sales'); assert.equal(metric.publishedVersion, 4);
    const described = await success('describe_metric', { id: metric.id });
    assert.equal(described.id, metric.id); assert.equal(described.publishedVersion, 4);
    assert.equal(described.published.version, 4); assert.equal(described.published.expression, 'sum({amount}) * 2');
    const versions = await success('list_metric_versions', { id: metric.id });
    assert.equal(versions.nextCursor, null);
    assert.deepEqual(versions.items.filter(v => v.state === 'published').map(v => v.version), [2, 4]);
    const query = version => ({ dimensions: [{ fieldId: 'region', columnName: 'region' }],
      measures: [{ fieldId: 'sales', columnName: `__metric_${metric.id}@v${version}`, aggregation: 'SUM' }], filters: [] });
    const historical = await success('run_dataset_query', { id: metric.dataset.id, query: query(2) });
    assert.deepEqual([...historical.rows].sort((a, b) => a.region.localeCompare(b.region)), [{ region: 'east', sales: 40 }, { region: 'west', sales: 20 }]);
    assert.equal(historical.metrics.length, 1); assert.equal(historical.metrics[0].id, metric.id);
    assert.equal(historical.metrics[0].version, 2); assert.equal(historical.metrics[0].expression, 'sum({amount})');
    const rejected = [];
    for (const version of [5, 99]) {
      const result = await call('run_dataset_query', { id: metric.dataset.id, query: query(version) });
      assert.equal(result.isError, true); assert.equal(result.status, 422);
      assert.equal(result.body.errorCode, 'METRIC_VERSION_NOT_PUBLISHED'); assert.equal(result.body.path, '$.metrics');
      assert.equal('rows' in result.body, false); rejected.push({ version, errorCode: result.body.errorCode });
    }
    return { id: metric.id, publishedVersions: [2, 4], historical, rejected,
      detail: 'MCP discovers Weekly sales by name, describes its current publication, lists history and executes published v2. Draft v5 and missing v99 fail closed.' };
  });
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
  await j.step('pii-field-name-stop', null, async () => {
    good(await member.request('/api/datasets/pii-sales/prep', 'PUT', {
      name: 'pii-sales', pipeline: { version: 1, input: piiSourceId, steps: [] }, expectedVersion: 0,
    }));
    const stops = {};
    // The dataset's permitted schema carries the personal-looking name, so
    // even a benign query over other fields stops before execution — the
    // same semantics as the generative routes' field-list guard.
    const benign = await call('run_dataset_query', { id: 'pii-sales', query: {
      dimensions: [{ fieldId: 'region', columnName: 'region' }],
      measures: [{ fieldId: 'sales', columnName: 'amount', aggregation: 'SUM' }], filters: [] } });
    assert.equal(benign.isError, true); assert.equal(benign.status, 400);
    assert.equal(benign.body.errorCode, 'AI_FIELD_NAME_PII'); assert.equal('rows' in benign.body, false);
    assert.equal(JSON.stringify(benign.body).includes('jane.doe'), false);
    stops.schemaCarried = benign.body.errorCode;
    // A caller-supplied personal-looking name on a clean dataset stops too.
    const direct = await call('run_dataset_query', { id: 'weekly-sales', query: {
      dimensions: [{ fieldId: 'owner', columnName: 'jane.doe@example.com' }],
      measures: [{ fieldId: 'sales', columnName: 'amount', aggregation: 'SUM' }], filters: [] } });
    assert.equal(direct.isError, true); assert.equal(direct.status, 400);
    assert.equal(direct.body.errorCode, 'AI_FIELD_NAME_PII'); assert.equal('rows' in direct.body, false);
    stops.callerSupplied = direct.body.errorCode;
    // Analysis authoring carrying the name is refused and stores nothing.
    const draftStop = await call('create_analysis', { body: analysis('agent-pii-draft', 'weekly-sales', 'prepared-dataset',
      [kpi('owner', 'jane.doe@example.com')]), idempotencyKey: randomUUID() });
    assert.equal(draftStop.isError, true); assert.equal(draftStop.status, 400);
    assert.equal(draftStop.body.errorCode, 'AI_FIELD_NAME_PII');
    stops.analysisCreate = draftStop.body.errorCode;
    const missing = await call('describe_analysis', { id: 'agent-pii-draft' });
    assert.equal(missing.isError, true); assert.equal(missing.status, 404);
    return { field: 'jane.doe@example.com (email-shaped column name)', stops,
      detail: 'run_dataset_query stops on the dataset schema and on a caller-supplied name; create_analysis stops and stores nothing. The error never echoes the name and no rows are returned.' };
  });
  await j.step('compute-quota-stops-refresh', null, async () => {
    const first = await success('refresh_dataset', { id: 'refresh-sales', idempotencyKey: randomUUID() });
    assert.equal(first.refreshed, true); assert.equal(first.mode, 'BLAZE'); assert.equal(first.state, 'ready');
    const second = await call('refresh_dataset', { id: 'refresh-sales', idempotencyKey: randomUUID() });
    assert.equal(second.isError, true); assert.equal(second.status, 429); assert.equal(second.body.errorCode, 'USAGE_LIMIT_EXCEEDED');
    return { entitlement: { computeAttempts: 1 }, first, second, detail: 'Distinct idempotency keys exercise two real refresh attempts; the second stops at the compute quota. This is not an AI-spend-cap assertion.' };
  });
  await j.step('ai-spend-cap-binding', null, async () => {
    const body = { question: 'sum revenue by region', datasetId: 'ai-sales' };
    const answer = await success('ask_question', { body });
    assert.deepEqual(Object.keys(answer).sort(), ['errors', 'interpretations', 'question']);
    assert.equal(answer.question, body.question); assert.deepEqual(answer.errors, []);
    const interpretation = answer.interpretations[0];
    assert.deepEqual(interpretation.grounding.fieldsUsed, ['revenue', 'region']);
    assert.deepEqual(interpretation.filters, []);
    const executed = await success('run_dataset_query', { id: body.datasetId, query: {
      dimensions: interpretation.dimensions.map(columnName => ({ fieldId: columnName, columnName })),
      measures: [{ fieldId: 'total', columnName: interpretation.measure, aggregation: interpretation.aggregation }], filters: [],
    } });
    assert.deepEqual([...executed.rows].sort((a, b) => a.region.localeCompare(b.region)), [{ region: 'east', total: 48 }, { region: 'west', total: 23 }]);
    const denied = await call('ask_question', { body });
    assert.equal(denied.isError, true); assert.equal(denied.status, 429);
    assert.equal(denied.body.errorCode, 'AI_SPEND_CAP_EXCEEDED'); assert.equal('rows' in denied.body, false);
    assert.equal('interpretations' in denied.body, false);
    assert.equal(denied.body.detail.spendCents, 12); assert.equal(denied.body.detail.capCents, 12);
    const credits = good(await member.request('/api/o/status')).credits;
    assert.equal(credits.used, 1); assert.equal(credits.remaining, 9);
    return { answer, rows: executed.rows, denied, credits,
      entitlement: { aiSpendCapCents: 12, aiCostCentsPerMillionTokens: 1_000_000 },
      detail: 'The managed test completion reports 12 tokens and records exactly 12 cents. A separate MCP query executes its interpretation against the member-owned ai-sales fixture. The next ask is denied by the workspace spend cap before provider transport.' };
  });
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
  await j.step('audit-member-identity', null, async () => {
    const history = await success('list_workspace_action_history', { limit: 200 });
    assert.equal(history.nextCursor, null); assert.ok(history.items.length > historyBefore.items.length);
    const tenantId = stack.fixture.tenant.tenantId, actor = member.identity.userId;
    // This is the whole workspace trail. Fixture/admin calls retain their real
    // actors; only the agent's actions must name the delegating member.
    const expectedActors = new Set([actor, stack.fixture.identity.userId, OPERATOR_ACTOR]);
    for (const entry of history.items) {
      assert.equal(entry.tenantId, tenantId); assert.ok(expectedActors.has(entry.actor), entry.actor);
      assert.ok(!['journey.foreign-audit', 'journey.operator-audit', 'list_workspace_action_history'].includes(entry.action));
    }
    const before = new Set(historyBefore.items.map(e => e.eventId));
    const memberEntries = history.items.filter(e => !before.has(e.eventId) && e.actor === actor);
    const used = new Set(), matched = [];
    for (const receipt of receipts) {
      const entry = memberEntries.find(e => !used.has(e.eventId) && e.action === receipt.action
        && e.subject === receipt.subject && e.detail.status === receipt.status);
      assert.ok(entry, `Missing distinct audit event: ${JSON.stringify(receipt)}`);
      assert.equal(entry.actor, actor); assert.equal(entry.tenantId, tenantId);
      assert.deepEqual(Object.keys(entry.detail).sort(), ['method', 'operationId', 'outcome', 'status']);
      assert.equal(entry.detail.operationId, receipt.action);
      assert.equal(entry.detail.outcome, receipt.status < 400 ? 'success' : receipt.status < 500 ? 'denied' : 'failed');
      used.add(entry.eventId); matched.push(entry);
    }
    assert.equal(matched.length, receipts.length);
    assert.ok(matched.some(e => e.action === 'create_analysis' && e.detail.status === 201), draft.AnalysisId);
    assert.ok(matched.some(e => e.action === 'run_dataset_query' && e.subject === 'weekly-sales' && e.detail.status === 200));
    for (const status of [200, 429]) assert.ok(matched.some(e => e.action === 'ask_question' && e.detail.status === status));
    const human = good(await member.request('/api/v1/workspace/action-history', 'GET', undefined, { Limit: '200' }));
    assert.deepEqual(human, history, 'MCP and direct human HTTP read the identical trail; reads add no entries');
    const operator = await member.request('/api/host/audit');
    assert.equal(operator.status, 403); assert.equal(operator.body.errorCode, 'OPERATOR_REQUIRED');
    return { tenantId, actor, analysisId: draft.AnalysisId, attributedMcpActions: matched.length,
      actions: matched.map(e => ({ eventId: e.eventId, action: e.action, subject: e.subject, status: e.detail.status, actor: e.actor, tenantId: e.tenantId })),
      detail: 'Every MCP action has a distinct event with the delegating member identity, including draft creation, queries and successful/denied asks. All returned entries belong to this tenant; legitimate administrator/operator setup entries keep their own actors. The human reads the same history, while operator audit remains forbidden.' };
  });
});
