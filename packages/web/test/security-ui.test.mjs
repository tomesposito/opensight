import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SecurityNotice } from '../build/test/SecurityNotice.js';

test('static security screens disclose public samples and hosted requirements without usable policy controls', () => {
  const html = renderToStaticMarkup(createElement(SecurityNotice));
  for (const text of ['Row-level security', 'Column-level security', 'Namespaces', 'Needs hosted API', 'does not authenticate users or enforce data access policies', 'bundled sample data is public', 'No rules, grants or namespaces are created here']) assert.ok(html.includes(text), text);
  assert.equal((html.match(/<button disabled=""/g) ?? []).length, 3);
  assert.doesNotMatch(html, /<form|<input|<select|<a |onSubmit|successfully|policy saved/i);
});
