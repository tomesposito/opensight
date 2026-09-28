import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { allowed, AccessProvider } from '../build/test/access.js';
import { Author } from '../build/test/Author.js';
import { ROLES, hasCapability } from '@opensight/query-engine/browser';

test('hosted UI capabilities match all server roles and unresolved sessions fail closed', () => {
  for (const role of [...ROLES, undefined, 'admin']) {
    const access = { mode: 'hosted', session: role ? { id: 'u', namespaceId: 'n', name: 'User', role } : undefined };
    for (const capability of ['admin', 'build', 'ai']) assert.equal(allowed(access, capability), hasCapability(role, capability));
    if (!allowed(access, 'build')) {
      const html = renderToStaticMarkup(createElement(AccessProvider, { access }, createElement(Author)));
      assert.match(html, /SECURITY_BUILD_REQUIRED/); assert.doesNotMatch(html, /analysis-title|Ask a question/);
    }
  }
});
