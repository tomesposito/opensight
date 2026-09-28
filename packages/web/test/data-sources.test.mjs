import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DataSources } from '../build/test/DataSources.js';
import { createApiClient } from '../build/test/api-client.js';
import { connectors } from '@opensight/query-engine/browser';
test('static gallery shows every connector with honest availability and disables upload', () => {
  const html = renderToStaticMarkup(createElement(DataSources));
  for (const connector of connectors) assert.ok(html.includes(connector.name), connector.name);
  assert.ok(html.includes('Needs hosted API / not configured'));
  assert.ok(html.includes('Not yet implemented'));
  assert.match(html, /type="file"[^>]*disabled/); assert.match(html, /type="submit" disabled/);
  assert.doesNotMatch(html, /Upload staged|Connected successfully|type="password"/);
});
test('hosted gallery exposes real upload form and no fabricated row counts', () => {
  const html = renderToStaticMarkup(createElement(DataSources, { client: { uploadFile: async () => { throw new Error('not called'); }, validateConnector: async () => { throw new Error('not called'); } } }));
  assert.match(html, /Ready for file upload/); assert.doesNotMatch(html, /type="file"[^>]*disabled/); assert.doesNotMatch(html, /Upload staged/);
});
test('connector client sends only config and bytes through existing authenticated transport', async () => {
  const calls = [];
  const client = createApiClient('/api', async (url, options) => { calls.push([url, options]); return new Response(JSON.stringify({ state: 'not_configured' }), { status: 200 }); });
  await client.validateConnector('mysql', { hostEnv: 'MYSQL_HOST' });
  await client.uploadFile({ config: { format: 'csv' }, base64: 'YQ==' });
  assert.equal(calls[0][0], '/api/api/connectors/mysql/connect');
  assert.deepEqual(JSON.parse(calls[0][1].body), { config: { hostEnv: 'MYSQL_HOST' } });
  assert.equal(calls[1][0], '/api/api/uploads'); assert.equal(calls[1][1].credentials, 'same-origin');
});
