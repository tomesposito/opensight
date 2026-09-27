import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OrganizationNotice } from '../build/test/OrganizationNotice.js';

test('static organization mode discloses hosted requirements and offers no simulated sharing or signing', () => {
  const html = renderToStaticMarkup(createElement(OrganizationNotice));
  for (const text of ['Folders', 'Asset sharing', 'Embedding', 'Needs hosted API', 'public sample data', 'does not create folders, share assets or generate signed embed URLs', 'permitted rows and columns', 'SSO hooks are integration stubs', 'server environment']) assert.ok(html.includes(text), text);
  assert.equal((html.match(/<button disabled=""/g) ?? []).length, 3);
  assert.doesNotMatch(html, /<form|<input|<select|<a |successfully|shared with|signed URL ready/i);
});
