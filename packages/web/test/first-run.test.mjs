import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FirstRun } from '../build/test/FirstRun.js';

test('first-run explains the product, existing auth configuration and two honest paths', () => {
  const html = renderToStaticMarkup(createElement(FirstRun, { issue: 'not-configured', checking: false, onRetry() {}, onDemo() {} }));
  for (const text of ['QuickSight-compatible BI', 'dashboards', 'analysis authoring', 'data preparation', 'connectors', 'embedding',
    'Authentication is not configured', 'SECURITY_NOT_CONFIGURED', 'Explore sample data', 'Retry connection',
    'Public, bundled samples only', 'does not create a hosted session', 'no built-in browser login form',
    'OPENSIGHT_MODE=hosted', 'OPENSIGHT_METADATA_DATABASE', 'OPENSIGHT_PUBLIC_ORIGIN', 'OPENSIGHT_AUTH_ISSUER',
    'OPENSIGHT_AUTH_AUDIENCE', 'OPENSIGHT_AUTH_KEY_ID', 'OPENSIGHT_AUTH_SIGNING_KEY', 'OPENSIGHT_AUTH_ENCRYPTION_KEY',
    'OPENSIGHT_OPERATOR_KEY', 'OPENSIGHT_SESSION_SECONDS', 'OPENSIGHT_INVITATION_SECONDS', 'OPENSIGHT_SMTP_HOST',
    'OPENSIGHT_SMTP_FROM', 'TOTP', 'SecurityOptions.authenticate', 'visual fidelity not measured']) assert.ok(html.includes(text), text);
  for (const name of ['first-run', 'h2-tenant-sessions', 'security-namespaces', 'hosted-architecture']) {
    assert.ok(html.includes(`/docs/${name}.md`), name);
  }
  assert.doesNotMatch(html, /Definition explorer|Hosted session unavailable|<input|<form/);
});

test('startup guidance distinguishes missing authentication, rejected sessions, outages and loading', () => {
  for (const [issue, expected] of [[undefined, 'Checking your workspace'], ['not-configured', 'Authentication is not configured'],
    ['sign-in', 'A verified session is required'], ['unavailable', 'Unable to connect to your workspace']]) {
    const html = renderToStaticMarkup(createElement(FirstRun, { issue, checking: !issue, onRetry() {}, onDemo() {} }));
    assert.ok(html.includes(expected));
    assert.ok(html.includes('Explore sample data'));
    assert.equal(html.includes('SECURITY_NOT_CONFIGURED'), issue === 'not-configured');
    assert.equal(html.includes('disabled=""'), !issue);
    assert.match(html, /role="status" aria-live="polite"/);
  }
});
