import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OEntry } from '../build/test/OEntry.js';
import { BuildForMe } from '../build/test/BuildForMe.js';
import { emptyDraft } from '../build/test/authoring.js';
for (const hosted of [false, true]) test(`generative mode stays disabled with ${hosted ? 'a data API' : 'offline fixtures'}`, () => {
  const client = hosted ? { queryDataset() { assert.fail('Rendering a stub must never call an API'); } } : undefined;
  const html = renderToStaticMarkup(createElement(OEntry, { draft: emptyDraft(), dispatch() {}, client }));
  assert.match(html, /Local deterministic interpreter · No AI/);
  assert.match(html, /role="switch"[^>]*disabled=""/);
  assert.doesNotMatch(html, / checked=""/);
  assert.match(html, /Needs hosted API and API key via server env \(not configured\)/);
  assert.match(html, /Generative mode is not implemented/);
  assert.doesNotMatch(html, /type="password"|Built by AI/);
});
test('calculation generation discloses deterministic templates and the same disabled mode', () => {
  const html = renderToStaticMarkup(createElement(BuildForMe, { fields: [], onInsert() {} }));
  assert.match(html, /Local deterministic templates · No AI/);
  assert.match(html, /role="switch"[^>]*disabled=""/);
  assert.match(html, /Needs hosted API/);
});
