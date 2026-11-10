import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Issue #237: the sitemap lists placement pages only. /demo/ is a bare app
// shell and https://app.getopensight.org/ is a login shell on another host,
// so neither is a sitemap entry; the demo artifact serves noindex instead.
const root = dirname(fileURLToPath(import.meta.url));
const sitemap = readFileSync(resolve(root, 'sitemap.xml'), 'utf8');
const locations = [...sitemap.matchAll(/<url>\s*<loc>([^<]+)<\/loc>\s*<\/url>/g)].map(m => m[1]);

test('sitemap does not list the /demo/ app shell', () => {
  assert.ok(!locations.includes('https://getopensight.org/demo/'));
});

test('sitemap does not list the cross-host app subdomain', () => {
  assert.ok(!locations.includes('https://app.getopensight.org/'));
  assert.ok(locations.every(url => url.startsWith('https://getopensight.org/')),
    'every sitemap entry must be on getopensight.org');
});

test('sitemap still lists the marketing pages', () => {
  for (const url of ['https://getopensight.org/', 'https://getopensight.org/pricing/',
    'https://getopensight.org/docs/']) {
    assert.ok(locations.includes(url), `sitemap missing ${url}`);
  }
});

test('the demo build injects the noindex, follow robots meta', () => {
  const builder = readFileSync(resolve(root, '../packages/web/scripts/build-demo.mjs'), 'utf8');
  assert.ok(builder.includes('<meta name="robots" content="noindex, follow" />'));
});

test('the shared app shell source carries no robots meta', () => {
  // The noindex belongs to the deploy-time demo artifact only; the local and
  // hosted apps build from this same index.html and are not changed by #237.
  const shell = readFileSync(resolve(root, '../packages/web/index.html'), 'utf8');
  assert.ok(!/name="robots"/.test(shell));
});
