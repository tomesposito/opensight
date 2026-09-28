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

import { OEntry } from '../build/test/OEntry.js';
import { emptyDraft } from '../build/test/authoring.js';
test('entire O bar is hidden for non-AI and unresolved roles on builder and dashboard surfaces', () => {
  for (const role of [...ROLES, undefined]) for (const builder of [true, false]) {
    const access = { mode: 'hosted', session: role ? { id: 'u', namespaceId: 'n', name: 'User', role } : undefined };
    const html = renderToStaticMarkup(createElement(AccessProvider, { access }, createElement(OEntry, { draft: emptyDraft(), ...(builder ? { dispatch() {}, renderBar: bar => createElement('nav', {}, 'Toolbar', bar) } : {}) })));
    assert.equal(html.includes('Ask a question'), hasCapability(role, 'ai'));
    if (builder) assert.match(html, /Toolbar/);
    if (!hasCapability(role, 'ai')) assert.doesNotMatch(html, /o-bar|o-question|Generative mode|deterministic/);
  }
});
