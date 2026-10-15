import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const bin = fileURLToPath(new URL('../dist/opensight.js', import.meta.url));
function invoke(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], { env: { PATH: process.env.PATH, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

test('built executable shows help and exits nonzero with structured missing-token diagnostics', async () => {
  const help = await invoke(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /dataset:/);
  assert.match(help.stdout, /add-visual/);
  assert.equal(help.stderr, '');
  const missing = await invoke(['dataset', 'list']);
  assert.equal(missing.code, 1);
  assert.equal(missing.stdout, '');
  assert.equal(JSON.parse(missing.stderr).errorCode, 'CLI_CONFIGURATION_INVALID');
  assert.match(missing.stderr, /OPENSIGHT_TOKEN/);
});

test('built executable exchanges against a loopback stub and dispatches through the real SDK HTTP transport', async t => {
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push({ path: request.url, method: request.method, headers: request.headers, body: Buffer.concat(chunks).toString() });
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/token') response.end(JSON.stringify({ access_token: 'process-fixture-access', token_type: 'Bearer', expires_in: 300 }));
    else if (request.url === '/api/v1/datasets') response.end(JSON.stringify({ items: [{ id: 'sales', name: 'Sales', version: 2 }], nextCursor: 'second-page' }));
    else { response.statusCode = 404; response.end(JSON.stringify({ errorCode: 'NOT_FOUND', message: 'Fixture missing' })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const env = { OPENSIGHT_API_URL: `${base}/api`, OPENSIGHT_TOKEN_URL: `${base}/token`, OPENSIGHT_TOKEN: 'process-fixture-refresh' };
  const result = await invoke(['dataset', 'list', '--limit', '7', '--cursor', 'first-page'], env);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), { items: [{ id: 'sales', name: 'Sales', version: 2 }], nextCursor: 'second-page' });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].method, 'POST');
  assert.equal(new URLSearchParams(requests[0].body).get('refresh_token'), env.OPENSIGHT_TOKEN);
  assert.equal(requests[1].headers.authorization, 'Bearer process-fixture-access');
  assert.equal(requests[1].headers.limit, '7');
  assert.equal(requests[1].headers.cursor, 'first-page');
  const failed = await invoke(['dataset', 'describe', 'absent', '--format', 'yaml'], env);
  assert.equal(failed.code, 1);
  assert.equal(failed.stdout, '');
  assert.equal(JSON.parse(failed.stderr).errorCode, 'NOT_FOUND');
});
