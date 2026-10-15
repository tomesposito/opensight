import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from 'js-yaml';
import { execute, env, json } from './helpers.mjs';
import { parse } from '../dist/parse.js';

test('positional IDs and camelCase flags produce the same SDK input; globals work anywhere', () => {
  assert.deepEqual(parse(['--format', 'yaml', 'dataset', 'describe', 'sales']), parse(['dataset', 'describe', '--id=sales', '--format=yaml']));
  const input = parse(['asset', 'copy', 'source', '--kind', 'analyses', '--newId', 'copy', '--folderId', 'null', '--name=Renamed']);
  assert.deepEqual(input.path, { kind: 'analyses', id: 'source' });
  assert.deepEqual(input.body, { newId: 'copy', folderId: null, name: 'Renamed' });
});

test('body fields preserve numbers, arrays, strings and nullable values', async () => {
  const output = await execute(['dataset', 'update', 'sales', '--name', 'Sales', '--pipeline', '{"version":1,"steps":[]}', '--expectedVersion', '0']);
  assert.equal(output.code, 0, output.stderr);
  assert.deepEqual(JSON.parse(output.calls[0].init.body), { name: 'Sales', pipeline: { version: 1, steps: [] }, expectedVersion: 0 });
  const search = await execute(['asset', 'search', '--query', 'Sales', '--kinds', '["analyses","datasets"]']);
  assert.equal(search.code, 0, search.stderr);
  assert.deepEqual(JSON.parse(search.calls[0].init.body), { query: 'Sales', kinds: ['analyses', 'datasets'] });
});

test('structured parameterized dataset query is forwarded intact', async () => {
  const query = { dimensions: [], measures: [{ fieldId: 'total', columnName: 'amount', aggregation: 'SUM' }], filters: [{ columnName: 'region', parameterName: 'Region' }], parameterDeclarations: [{ name: 'Region', type: 'string', multiple: false }], parameterBindings: { Region: ["east' OR 1=1 --"] } };
  const output = await execute(['dataset', 'query', 'sales', '--query', JSON.stringify(query)]);
  assert.equal(output.code, 0, output.stderr);
  assert.deepEqual(JSON.parse(output.calls[0].init.body), query);
});

const badArgs = [
  ['login'], ['dataset', 'sql'], ['dataset', 'describe'], ['dataset', 'describe', 'one', 'two'],
  ['dataset', 'describe', 'one', '--id', 'two'], ['dataset', 'list', '--limit', '1', '--limit', '2'],
  ['dataset', 'list', '--limit'], ['dataset', 'list', '--limit', 'oops'], ['dataset', 'list', '--limit', '0'],
  ['dataset', 'list', '--limit', '1001'], ['dataset', 'list', '--limit', '1.5'],
  ['dataset', 'list', '--cursor', 'unsafe\r\nHeader: value'],
  ['dataset', 'describe', '..'], ['dataset', 'describe', 'one/../../other'],
  ['dashboard', 'describe-version', 'one', '--version', '-1'],
  ['analysis', 'delete', 'one'], ['analysis', 'delete', 'one', '--ifMatch', '3'],
  ['dataset', 'list', '--token', 'should-never-be-echoed'],
  ['dataset', 'list', '--format', 'xml'], ['dataset', 'list', '-x'],
  ['folder', 'rename', 'one', '--ifMatch', '"1"', '--body', '{"name":"a"}', '--name', 'b'],
  ['folder', 'rename', 'one', '--ifMatch', '"1"', '--body', '{'],
  ['asset', 'search', '--name', 'Sales'], ['asset', 'search', '--body', '{}'],
  ['dataset', 'query', 'one', '--sql', 'SELECT * FROM private_table'],
  ['dataset', 'query', 'one', '--query', 'SELECT * FROM private_table'],
  ['dataset', 'query', 'one', '--query', '{"dimensions":[],"measures":[{"fieldId":"a","columnName":"a","aggregation":"SUM"}],"filters":[],"sql":"SELECT 1"}'],
  ['dataset', 'query', 'one', '--query', '{"dimensions":[],"measures":[{"fieldId":"a","columnName":"a","aggregation":"SUM"}],"filters":[{"columnName":"x","sql":"SELECT 1"}]}'],
];
test('invalid arguments, per-command credentials and SQL bypass attempts fail before any exchange or request', async () => {
  for (const argv of badArgs) {
    const output = await execute(argv);
    assert.equal(output.code, 1, JSON.stringify(argv));
    assert.equal(output.stdout, '');
    assert.equal(JSON.parse(output.stderr).errorCode, 'CLI_ARGUMENT_INVALID');
    assert.equal(output.calls.length + output.exchanges.length, 0);
    assert.ok(!output.stderr.includes('should-never-be-echoed'));
  }
});

test('JSON default and YAML preserve API values including ambiguous strings and empty containers', async () => {
  const result = { items: [{ id: 'sales', name: 'yes', note: '2026-10-15', nested: ['null', 'a: b', 'line\nbreak', true, 3, null, {}, []], '\u001b[31m': 'value' }], nextCursor: 'opaque:cursor' };
  for (const format of ['json', 'yaml']) {
    const output = await execute(['dataset', 'list', '--format', format], { fetch: async () => json(result) });
    assert.equal(output.code, 0, output.stderr);
    assert.equal(output.stderr, '');
    assert.deepEqual(format === 'json' ? JSON.parse(output.stdout) : load(output.stdout), result);
    assert.ok(!output.stdout.includes('\u001b'));
  }
});

test('handwritten table lists and descriptions include useful fields and pagination', async () => {
  const list = await execute(['dataset', 'list', '--format', 'table'], { fetch: async () => json({ items: [{ id: 'sales', name: 'Quarterly\nSales', version: 2, execution: { mode: 'BLAZE' } }], nextCursor: 'page-2' }) });
  assert.equal(list.code, 0, list.stderr);
  for (const text of ['ID', 'Name', 'Version', 'sales', 'Quarterly\\nSales', 'BLAZE', 'nextCursor: page-2']) assert.ok(list.stdout.includes(text));
  const empty = await execute(['dataset', 'list', '--format', 'table']);
  assert.match(empty.stdout, /no items/);
  const describe = await execute(['folder', 'describe', 'folder', '--format', 'table'], { fetch: async () => json({ Id: 'folder', Name: 'Reports', Version: 3 }) });
  assert.equal(describe.code, 0, describe.stderr);
  assert.match(describe.stdout, /Reports/);
  const mutation = await execute(['dataset', 'refresh', 'sales', '--format', 'table']);
  assert.equal(mutation.code, 1);
  assert.equal(JSON.parse(mutation.stderr).errorCode, 'CLI_FORMAT_UNSUPPORTED');
  assert.equal(mutation.calls.length + mutation.exchanges.length, 0, 'unsupported format must never execute a mutation');
});

test('API errors retain errorCode, details, status and Retry-After on stderr in every format', async () => {
  for (const format of ['json', 'yaml', 'table']) {
    const output = await execute(['dataset', 'list', '--format', format], { fetch: async () => json({ errorCode: 'RATE_LIMIT_EXCEEDED', message: 'Retry later', detail: { limit: 2 } }, 429, { 'Retry-After': '7' }) });
    assert.equal(output.code, 1);
    assert.equal(output.stdout, '');
    assert.deepEqual(JSON.parse(output.stderr), { errorCode: 'RATE_LIMIT_EXCEEDED', message: 'Retry later', detail: { limit: 2 }, status: 429, retryAfter: 7 });
  }
});

test('versioned API bodies stay unchanged while the SDK ETag remains available for edits', async () => {
  const response = { AnalysisId: 'analysis', Name: 'Draft', Definition: {}, Errors: [] };
  const read = await execute(['analysis', 'describe', 'analysis'], { fetch: async () => json(response, 200, { ETag: '"7"' }) });
  assert.equal(read.code, 0);
  assert.deepEqual(JSON.parse(read.stdout), response);
  assert.deepEqual(JSON.parse(read.stderr), { etag: '"7"' });
  const deleted = await execute(['analysis', 'delete', 'analysis', '--ifMatch', JSON.parse(read.stderr).etag]);
  assert.equal(deleted.code, 0);
  assert.equal(deleted.calls[0].init.headers['If-Match'], '"7"');
});

test('malformed successful API responses fail closed', async () => {
  for (const content of ['not JSON', 'null', '[]']) {
    const output = await execute(['dataset', 'list'], { fetch: async () => new Response(content) });
    assert.equal(output.code, 1);
    assert.equal(output.stdout, '');
    assert.equal(JSON.parse(output.stderr).errorCode, 'CLI_RESPONSE_INVALID');
  }
});

test('environment auth exchanges only at the explicit endpoint, then sends only access credential to SDK', async () => {
  const output = await execute(['dataset', 'list'], { env: { ...env, OPENSIGHT_API_URL: 'https://opensight.example/api/v1/' } });
  assert.equal(output.code, 0, output.stderr);
  assert.equal(output.exchanges.length, 1);
  const { init } = output.exchanges[0];
  assert.equal(init.redirect, 'error');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(init.body)), { grant_type: 'refresh_token', refresh_token: env.OPENSIGHT_TOKEN });
  assert.equal(output.calls[0].init.headers.Authorization, 'Bearer synthetic-access-credential');
  assert.equal(output.calls[0].url, 'https://opensight.example/api/v1/datasets');
  assert.ok(!(output.stdout + output.stderr).includes('synthetic-'));
});

test('missing configuration names env variables and never sends refresh tokens to API', async () => {
  for (const [key, code] of [['OPENSIGHT_TOKEN', 'CLI_CONFIGURATION_INVALID'], ['OPENSIGHT_API_URL', 'CLI_CONFIGURATION_INVALID'], ['OPENSIGHT_TOKEN_URL', 'CLI_TOKEN_EXCHANGE_REQUIRED']]) {
    const missing = { ...env }; delete missing[key];
    const output = await execute(['dataset', 'list'], { env: missing });
    assert.equal(output.code, 1);
    assert.equal(output.stdout, '');
    assert.equal(JSON.parse(output.stderr).errorCode, code);
    assert.ok(output.stderr.includes(key));
    assert.equal(output.calls.length + output.exchanges.length, 0);
  }
});

test('invalid endpoint configuration and failed exchanges cannot expose credentials', async () => {
  for (const variable of ['OPENSIGHT_API_URL', 'OPENSIGHT_TOKEN_URL']) for (const url of ['broken', 'https://user:password@example.test/api', 'http://external.example/api', 'https://opensight.example/api?token=secret', 'https://opensight.example/api#secret']) {
    const output = await execute(['dataset', 'list'], { env: { ...env, [variable]: url } });
    assert.equal(output.code, 1);
    assert.equal(output.calls.length + output.exchanges.length, 0);
    assert.ok(!output.stderr.includes(url));
  }
  for (const exchange of [
    async () => json({ message: env.OPENSIGHT_TOKEN }, 401),
    async () => { throw Error(env.OPENSIGHT_TOKEN); },
    async () => json({ access_token: 'echo-secret', token_type: 'Basic', expires_in: 100 }),
    async () => json({ access_token: 'echo-secret', token_type: 'Bearer', expires_in: -1 }),
    async () => json({ access_token: 'echo-secret', token_type: 'Bearer', expires_in: 100, refresh_token: '' }),
  ]) {
    const output = await execute(['dataset', 'list'], { exchange });
    assert.equal(output.code, 1);
    assert.equal(JSON.parse(output.stderr).errorCode, 'AUTHENTICATION_FAILED');
    assert.equal(output.calls.length, 0);
    assert.ok(!output.stderr.includes('synthetic-') && !output.stderr.includes('echo-secret'));
  }
});

test('reflected refresh, rotated and access tokens are suppressed in data, errors, escaped JSON and exports', async () => {
  for (const secret of [env.OPENSIGHT_TOKEN, 'synthetic-access-credential', 'synthetic-rotated-credential']) {
    for (const fetch of [
      async () => json({ items: [{ [secret]: 'reflected' }], nextCursor: null }),
      async () => json({ errorCode: 'DENIED', message: secret }, 403),
      async () => new Response(`{"items":["${secret.replace(/./g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)}"]}`, { headers: { 'Content-Type': 'application/json' } }),
      async () => { throw Error(secret); },
    ]) {
      const output = await execute(['dataset', 'list'], { fetch });
      assert.equal(output.code, 1);
      assert.equal(output.stdout, '');
      assert.ok(!output.stderr.includes(secret));
    }
    const output = await execute(['dashboard', 'create-export', 'd1', '--body', '{"format":"csv"}'], { fetch: async () => new Response(secret, { headers: { 'Content-Type': 'text/csv' } }) });
    assert.equal(output.code, 1);
    assert.equal(output.stdout, '');
  }
});
