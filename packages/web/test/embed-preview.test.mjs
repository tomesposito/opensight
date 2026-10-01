import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EmbedFrame, defaultEmbedBrand, embedAsset } from '../build/test/EmbedFrame.js';
import { atlasBrand, previewAssets } from '../build/test/embed-preview-fixtures.js';

for (const [state, title] of [['loading', 'Loading dashboard'], ['empty', 'No visuals in this dashboard'], ['error', 'Data access was denied'], ['expired', 'Embed URL expired']]) {
  test(`H5 ${state} preview preserves notices and permission semantics across branding`, () => {
    for (const appearance of [defaultEmbedBrand, atlasBrand]) {
      const html = renderToStaticMarkup(createElement(EmbedFrame, { state, appearance, assets: previewAssets }, 'SHOULD NEVER RENDER PROTECTED CONTENT'));
      assert.ok(html.includes(title)); assert.ok(html.includes(appearance.productName)); assert.ok(html.includes(appearance.iframeTitle));
      assert.ok(html.includes('OpenSight · Apache-2.0')); assert.ok(html.includes('Data access permissions apply'));
      assert.ok(html.includes(state === 'error' ? 'role="alert"' : 'role="status"'));
      assert.doesNotMatch(html, /SHOULD NEVER|<button|<input|<a |<script|https?:/);
      assert.equal(html.includes('<img '), appearance === atlasBrand);
      assert.ok(html.includes(appearance === atlasBrand ? 'embed-teal embed-sans embed-compact' : 'embed-navy embed-system embed-comfortable'));
    }
  });
}
test('H5 shared frame escapes untrusted text and refuses external, SVG and forged asset strings', () => {
  const attacks = ['javascript:alert(1)', 'https://evil.example/logo.png', 'data:image/svg+xml,<svg onload=alert(1)>', 'data:image/png;base64,AAAA" onerror="alert(1)', 'data:image/png;base64,' + 'a'.repeat(90001)];
  for (const value of attacks) assert.equal(embedAsset('logo', { logo: value }), undefined);
  assert.equal(embedAsset('constructor', {}), undefined);
  const html = renderToStaticMarkup(createElement(EmbedFrame, { state: 'ready', appearance: { ...atlasBrand, productName: '<script>alert(1)</script>', iframeTitle: '" onload="alert(1)' }, title: '<img src=x onerror=alert(1)>' }));
  assert.doesNotMatch(html, /<script|<img| onload="/); assert.match(html, /&lt;script&gt;/);
});
