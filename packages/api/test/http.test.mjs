import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { createApiServer } from '@opensight/api';

const fixtures = fileURLToPath(new URL('../../../fixtures/', import.meta.url));
const realPath = join(fixtures, 'real-bundle-sample/TotalDeathByCountry.sanitized.qs');
const ids = { analysis: '2f99f271-1f84-4a57-9843-31646734d5c9', dashboard: 'e0772d4e-bd69-444e-a421-cb3f165dbad8' };
const route = (kind, id) => `/${kind === 'analysis' ? 'analyses' : 'dashboards'}/${id}/definition`;
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const native = (kind, id = 'example') => ({
  [kind === 'analysis' ? 'AnalysisId' : 'DashboardId']: id,
  Definition: { DataSetIdentifierDeclarations: [] },
});
async function temporary(t) {
  const root = await mkdtemp(join(tmpdir(), 'opensight-api-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function put(root, name, body) {
  const path = join(root, name);
  await writeFile(path, JSON.stringify(body));
  return path;
}
async function start(t, dataRoot) {
  const server = await createApiServer({ dataRoot });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
  });
  const address = server.address();
  return path => fetch(`http://127.0.0.1:${address.port}${path}`);
}
function withoutRequestId(body) {
  const { RequestId, ...rest } = body;
  assert.match(RequestId, /^[a-f0-9-]{36}$/u);
  return rest;
}

for (const kind of ['analysis', 'dashboard']) {
  test(`real .qs ${kind} has the complete expected definition wire body`, async t => {
    const get = await start(t, realPath);
    const response = await get(route(kind, ids[kind]));
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^application\/json/u);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json();
    const expected = await json(new URL(`fixtures/real-${kind}.response.json`, import.meta.url));
    assert.deepEqual(withoutRequestId(body), expected);
    assert.equal(Object.hasOwn(body, 'Status'), false);
    assert.equal(Object.hasOwn(body, 'resourceType'), false);
    assert.equal(Object.hasOwn(body, 'ResourceType'), false);
    assert.equal(Object.hasOwn(body, '$metadata'), false);
    const options = body.Definition.Options;
    assert.equal(options.QBusinessInsightsStatus, 'DISABLED');
    assert.deepEqual(options.CustomActionDefaults, { highlightOperation: { Trigger: 'DATA_POINT_CLICK' } });
    const pie = body.Definition.Sheets[0].Visuals[0].PieChartVisual;
    assert.equal(pie.ChartConfiguration.FieldWells.PieChartAggregatedFieldWells.Values[0]
      .NumericalMeasureField.AggregationFunction.SimpleNumericalAggregation, 'SUM');
    if (kind === 'dashboard') {
      assert.deepEqual(body.DashboardPublishOptions.ExportToCSVOption, { AvailabilityStatus: 'ENABLED' });
      assert.equal(Object.hasOwn(body.Definition, 'QueryExecutionOptions'), false);
    } else {
      assert.deepEqual(body.Definition.QueryExecutionOptions, { QueryExecutionMode: 'AUTO' });
    }
  });
}

test('recursive fixture root serves synthetic renderable sales and both real assets', async t => {
  const get = await start(t, fixtures);
  const original = await json(join(fixtures, 'renderable-sales/analysis.json'));
  const { ResourceType, ...expected } = original;
  const response = await get(route('analysis', original.AnalysisId));
  assert.equal(response.status, 200);
  assert.deepEqual(withoutRequestId(await response.json()), expected);
  for (const kind of ['analysis', 'dashboard']) assert.equal((await get(route(kind, ids[kind]))).status, 200);
});

for (const kind of ['analysis', 'dashboard']) {
  test(`${kind} API fixture preserves optional fields, unknown features and map keys`, async t => {
    const root = await temporary(t);
    const source = {
      ...native(kind, 'same-id'), Name: 'Fixture', ResourceStatus: 'UPDATE_SUCCESSFUL', ThemeArn: 'arn:example:theme',
      Errors: [{ Type: 'FUTURE_ERROR', Message: 'Retained', ViolatedEntities: [{ Path: 'Definition.Sheets' }] }],
      FutureEnvelope: { mixedCase: false, Map: { countryId: 0 } },
    };
    source.Definition.FutureOptions = JSON.parse('{"name":"literal","__proto__":{"visualId":"unchanged"},"constructor":null}');
    source.Definition.Sheets = [{ SheetId: 'sheet', Visuals: [{ FutureVisual: { VisualId: 'v', futureOption: [1, null, false] } }] }];
    source.Definition.ParameterDeclarations = [{ FutureParameterDeclaration: { Name: 'parameter', nestedMap: { someKey: 'value' } } }];
    if (kind === 'dashboard') source.DashboardPublishOptions = { FuturePublishOption: { Enabled: true } };
    const file = await put(root, 'arbitrary-file-name.json', source);
    const get = await start(t, file);
    const response = await get(route(kind, 'same-id'));
    assert.equal(response.status, 200);
    assert.deepEqual(withoutRequestId(await response.json()), source);
    assert.equal((await get(route(kind === 'analysis' ? 'dashboard' : 'analysis', 'same-id'))).status, 404);
  });
}

test('missing optional fields stay absent; SDK fields are removed and RequestId is fresh', async t => {
  const root = await temporary(t);
  const source = native('analysis');
  await put(root, 'fixture.json', { ...source, ResourceType: 'Analysis', Status: 201, $metadata: { httpStatusCode: 201 }, RequestId: 'old-request' });
  const get = await start(t, root);
  const first = await (await get(route('analysis', 'example'))).json();
  const second = await (await get(route('analysis', 'example'))).json();
  assert.deepEqual(withoutRequestId(first), source);
  assert.deepEqual(withoutRequestId(second), source);
  assert.notEqual(first.RequestId, second.RequestId);
});

test('unknown archive subtrees and unobserved variants survive without recursive recasing', async t => {
  const root = await temporary(t);
  const members = unzipSync(await readFile(realPath));
  const path = `analysis/${ids.analysis}.json`;
  const source = JSON.parse(new TextDecoder().decode(members[path]));
  const unknown = JSON.parse('{"name":"kept","visualId":"kept","qbusinessInsightsStatus":false,"Map":{"countryId":0},"__proto__":{"name":"kept"}}');
  source.futureEnvelope = unknown;
  source.definition.futureRoot = unknown;
  source.definition.options.futureOption = unknown;
  source.definition.calculatedFields = [{ dataSetIdentifier: 'us_simplified', name: 'future', expression: '{deaths}', future: unknown }];
  source.definition.parameterDeclarations = [{ futureParameterDeclaration: unknown }];
  source.definition.filterGroups = [{ filterGroupId: 'future', crossDataset: 'SINGLE_DATASET',
    scopeConfiguration: { allSheets: {} }, filters: [{ futureFilter: unknown }], future: unknown,
  }];
  const pie = source.definition.sheets[0].visuals[0].pieChartVisual;
  pie.futureVisualOption = unknown;
  pie.actions = [unknown];
  pie.chartConfiguration.fieldWells.pieChartAggregatedFieldWells.values[0].numericalMeasureField.column.futureColumn = unknown;
  source.definition.sheets[0].visuals.push({ futureChartVisual: { visualId: 'future', body: unknown } });
  members[path] = strToU8(JSON.stringify(source));
  await writeFile(join(root, 'unknown.qs'), zipSync(members));
  const get = await start(t, root);
  const response = await get(route('analysis', ids.analysis));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.futureEnvelope, unknown);
  assert.deepEqual(body.validationStrategy, source.validationStrategy);
  assert.deepEqual(body.Definition.futureRoot, unknown);
  assert.deepEqual(body.Definition.Options.futureOption, unknown);
  for (const [apiKey, bundleKey] of [['CalculatedFields', 'calculatedFields'], ['ParameterDeclarations', 'parameterDeclarations'], ['FilterGroups', 'filterGroups']]) {
    assert.deepEqual(body.Definition[apiKey], source.definition[bundleKey]);
  }
  const mappedPie = body.Definition.Sheets[0].Visuals[0].PieChartVisual;
  assert.deepEqual(mappedPie.futureVisualOption, unknown);
  assert.deepEqual(mappedPie.Actions, [unknown]);
  assert.deepEqual(mappedPie.ChartConfiguration.FieldWells.PieChartAggregatedFieldWells.Values[0].NumericalMeasureField.Column.futureColumn, unknown);
  assert.deepEqual(body.Definition.Sheets[0].Visuals[1], source.definition.sheets[0].visuals[1]);
});

test('standalone camelCase archive members use the same adapter as ZIP assets', async t => {
  const root = await temporary(t);
  const members = unzipSync(await readFile(realPath));
  await writeFile(join(root, 'member.json'), members[`dashboard/${ids.dashboard}.json`]);
  const get = await start(t, root);
  assert.deepEqual(withoutRequestId(await (await get(route('dashboard', ids.dashboard))).json()),
    await json(new URL('fixtures/real-dashboard.response.json', import.meta.url)));
});

test('analysis and dashboard ID namespaces are independent, including special object keys', async t => {
  const root = await temporary(t);
  await put(root, 'analysis.json', native('analysis', '__proto__'));
  await put(root, 'dashboard.json', native('dashboard', '__proto__'));
  const get = await start(t, root);
  for (const kind of ['analysis', 'dashboard']) assert.equal((await get(route(kind, '__proto__'))).status, 200);
  assert.equal((await get(route('analysis', 'constructor'))).status, 404);
});

test('definition data is a startup snapshot and percent-encoded valid IDs resolve', async t => {
  const root = await temporary(t);
  const file = await put(root, 'asset.json', native('analysis', 'a-b'));
  const get = await start(t, root);
  await writeFile(file, 'now invalid');
  assert.deepEqual(withoutRequestId(await (await get(route('analysis', '%61%2Db'))).json()), native('analysis', 'a-b'));
});

const failures = [
  ['/analyses/missing/definition', 404, 'ResourceNotFoundException'],
  ['/dashboards/missing/definition', 404, 'ResourceNotFoundException'],
  ['/analyses/example', 404, 'ResourceNotFoundException'],
  ['/analyses/example/definition/extra', 404, 'ResourceNotFoundException'],
  ['/analyses//definition', 404, 'ResourceNotFoundException'],
  ['/analyses/%ZZ/definition', 400, 'InvalidParameterValueException'],
  ['/analyses/%C0%AF/definition', 400, 'InvalidParameterValueException'],
  ['/analyses/%2e%2e%2fsecret/definition', 400, 'InvalidParameterValueException'],
  ['/analyses/a%5Cb/definition', 400, 'InvalidParameterValueException'],
  ['/analyses/%00/definition', 400, 'InvalidParameterValueException'],
  ['/analyses/a%20b/definition', 400, 'InvalidParameterValueException'],
  [`/analyses/${'a'.repeat(513)}/definition`, 400, 'InvalidParameterValueException'],
  ['/dashboards/example/definition?version-number=2', 400, 'InvalidParameterValueException'],
  ['/dashboards/example/definition?alias-name=latest', 400, 'InvalidParameterValueException'],
  ['/analyses/example/definition?unknown=value', 400, 'InvalidParameterValueException'],
  ['/analyses/example/definition??version-number=2', 400, 'InvalidParameterValueException'],
];
test('HTTP routing, missing definitions, invalid IDs and unsupported selectors have explicit errors', async t => {
  const root = await temporary(t);
  const get = await start(t, root);
  for (const [path, status, type] of failures) {
    const response = await get(path);
    assert.equal(response.status, status, path);
    assert.match(response.headers.get('content-type'), /^application\/json/u);
    const body = await response.json();
    assert.equal(body.Type, type, path);
    assert.equal(typeof body.Message, 'string');
    assert.deepEqual(Object.keys(body).sort(), ['Message', 'RequestId', 'Type']);
    withoutRequestId(body);
    assert.equal(JSON.stringify(body).includes(root), false);
  }
});

test('non-GET methods receive 405 and Allow: GET', async t => {
  const root = await temporary(t);
  await put(root, 'asset.json', native('analysis'));
  const server = await createApiServer({ dataRoot: root });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.close(); server.closeAllConnections(); });
  const url = `http://127.0.0.1:${server.address().port}/analyses/example/definition`;
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD']) {
    const response = await fetch(url, { method });
    assert.equal(response.status, 405, method);
    assert.equal(response.headers.get('allow'), 'GET');
    if (method === 'HEAD') assert.equal(await response.text(), '');
    else assert.equal((await response.json()).Type, 'MethodNotAllowed');
  }
});

test('recursive discovery skips symlinks and unrelated JSON documents', async t => {
  const root = await temporary(t);
  const outside = await temporary(t);
  await put(outside, 'secret.json', native('analysis', 'secret'));
  await symlink(outside, join(root, 'outside'));
  await put(root, 'summary.json', { summary: 'not a definition' });
  const get = await start(t, root);
  assert.equal((await get(route('analysis', 'secret'))).status, 404);
  await assert.rejects(createApiServer({ dataRoot: join(root, 'outside') }), /symbolic link/u);
});

test('duplicate IDs fail startup rather than choose a source arbitrarily', async t => {
  const root = await temporary(t);
  await put(root, 'a.json', native('analysis'));
  await put(root, 'b.json', native('analysis'));
  await assert.rejects(createApiServer({ dataRoot: root }), /Duplicate analysis ID: example/u);
});

test('archive/API key collisions fail startup without losing either value', async t => {
  const root = await temporary(t);
  for (const pair of [['name', 'Name'], ['definition', 'Definition']]) {
    const source = { resourceType: 'analysis', analysisId: 'collision', name: 'Archive', definition: { dataSetIdentifierDeclarations: [] } };
    source[pair[1]] = { future: 'must not be overwritten' };
    const file = await put(root, 'collision.json', source);
    await assert.rejects(createApiServer({ dataRoot: file }), /property collision/u);
  }
});

test('invalid or ambiguous definition documents fail before a server is returned', async t => {
  const root = await temporary(t);
  const invalid = [
    [{ AnalysisId: 'example' }, /Definition object/u],
    [{ ...native('analysis'), DashboardId: 'other' }, /exactly one/u],
    [{ ...native('analysis'), ResourceType: 'Dashboard' }, /does not match/u],
    [native('analysis', '../bad'), /Invalid resource ID/u],
    [{ AnalysisId: 'example', Definition: {} }, /DataSetIdentifierDeclarations/u],
    [{ AnalysisId: 'example', Definition: { DataSetIdentifierDeclarations: [null] } }, /DataSetIdentifierDeclarations/u],
    [{ summary: true }, /no analysis or dashboard/u],
  ];
  for (const [source, expected] of invalid) {
    const file = await put(root, 'invalid.json', source);
    await assert.rejects(createApiServer({ dataRoot: file }), expected);
  }
});

test('missing roots, corrupt JSON, invalid UTF-8 and corrupt ZIPs fail startup', async t => {
  const root = await temporary(t);
  await assert.rejects(createApiServer({ dataRoot: join(root, 'missing') }), /ENOENT/u);
  for (const [name, data] of [['bad.json', '{'], ['utf8.json', Buffer.from([0xff])], ['bad.qs', 'not a zip']]) {
    const file = join(root, name);
    await writeFile(file, data);
    await assert.rejects(createApiServer({ dataRoot: file }), /Unable to load/u);
  }
});

test('serialization failures return JSON/500 and leave the server usable', async t => {
  const root = await temporary(t);
  const depth = 20000;
  await writeFile(join(root, 'deep.json'), '{"AnalysisId":"deep","Definition":{"DataSetIdentifierDeclarations":[]},"Future":'
    + '{"nested":'.repeat(depth) + 'null' + '}'.repeat(depth) + '}');
  await put(root, 'normal.json', native('analysis'));
  const get = await start(t, root);
  const response = await get(route('analysis', 'deep'));
  assert.equal(response.status, 500);
  assert.deepEqual(withoutRequestId(await response.json()), {
    Type: 'InternalFailureException', Message: 'Unable to serialize definition',
  });
  assert.equal((await get(route('analysis', 'example'))).status, 200);
});
