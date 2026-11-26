import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { OMigration } from '../build/test/OMigration.js';
import { OEntry } from '../build/test/OEntry.js';
import { emptyDraft } from '../build/test/authoring.js';
import { importBundle } from '../build/test/bundle-authoring.js';
const draft = () => importBundle({ members: [{ path: 'analysis/source.json', resource: { resourceType: 'analysis', analysisId: 'source', name: 'Synthetic', definition: {
  dataSetIdentifierDeclarations: [{ identifier: 'data', dataSetArn: 'urn:synthetic:data' }], sheets: [{ sheetId: 's', visuals: [{ insightVisual: { visualId: 'v', insightConfiguration: { computations: [{ anomaly: { computationId: 'a' } }] } } }] }] } } }] });
test('D-97 in-product Ask O offers commands and fingerprinted proposals without applying an authoring change', async () => {
  const d = draft(), before = structuredClone(d), actions = [];
  const html = renderToStaticMarkup(createElement(OEntry, { draft: d, dispatch: a => actions.push(a) }));
  assert.match(html, /QuickSight migration guide/); assert.match(html, /visual:anomaly/); assert.match(html, /Confirmation required/);
  assert.match(html, /converted differently/); assert.match(html, /No AI credits/); assert.match(html, /migration-extractor/);
  let tree; await act(async () => { tree = create(createElement(OMigration, { draft: d })); });
  await act(async () => tree.root.findAllByType('select')[0].props.onChange({ target: { value: 'powershell' } }));
  assert.match(tree.root.findByType('pre').children.join(''), /\$env:AWS_ACCOUNT_ID/);
  await act(async () => tree.root.findAllByType('select')[1].props.onChange({ target: { value: 'environment' } }));
  assert.doesNotMatch(tree.root.findByType('pre').children.join(''), /AWS_PROFILE|sso login/);
  assert.equal(tree.root.findAllByType('button').length, 0, 'guidance has no apply control');
  assert.deepEqual(d, before); assert.deepEqual(actions, []);
  await act(async () => tree.unmount());
});
test('D-97 pre-import guidance is available without a dataset or hosted AI provider', () => {
  const html = renderToStaticMarkup(createElement(OMigration, { draft: emptyDraft() }));
  assert.match(html, /SSO profile/); assert.match(html, /3 List and 4 Describe/);
  assert.doesNotMatch(html, /Migration remediation checklist/);
});

import { AccessProvider } from '../build/test/access.js';
import { interpretMigration } from '@opensight/o-interpreter';
import { serializeImportReport } from '@opensight/bundle-parser/browser';
import { createApiClient } from '../build/test/api-client.js';
test('D-97 hosted guide continues an MCP import through governed Ask O and discards late answers after a member switch', async () => {
  const calls = [], guidance = interpretMigration({ phase: 'after-import', report: serializeImportReport(draft().bundle.report) });
  let resolve;
  const aiClient = { migrationGuidance: async id => { calls.push(id); return new Promise(r => { resolve = r; }); } };
  const node = id => createElement(AccessProvider, { access: { mode: 'hosted', session: { id, namespaceId: 'one', role: 'author_ai' }, aiClient } }, createElement(OMigration, { draft: emptyDraft() }));
  let tree; await act(async () => { tree = create(node('member-one')); });
  await act(async () => tree.root.findByType('input').props.onChange({ target: { value: 'mcp-import' } }));
  await act(async () => { void tree.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  assert.deepEqual(calls, ['mcp-import']);
  await act(async () => resolve({ migration: guidance }));
  assert.ok(tree.root.findAll(n => n.props['aria-label'] === 'Migration remediation checklist').length);
  await act(async () => { void tree.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  await act(async () => tree.update(node('member-two')));
  await act(async () => resolve({ migration: guidance }));
  assert.equal(tree.root.findAll(n => n.props['aria-label'] === 'Migration remediation checklist').length, 0);
  await act(async () => tree.unmount());
});
test('D-97 web client sends only the import identity to the existing governed Ask O operation', async () => {
  const calls = [];
  const client = createApiClient('https://opensight.example', async (url, init) => {
    calls.push({ url, init }); return new Response(JSON.stringify({ migration: { applied: false } }), { headers: { 'Content-Type': 'application/json' } });
  });
  await client.migrationGuidance('import-one');
  assert.match(String(calls[0].url), /\/api\/v1\/ai\/ask$/);
  assert.deepEqual(JSON.parse(calls[0].init.body), { question: 'Review this QuickSight import', migration: { phase: 'after-import', importId: 'import-one' } });
});
