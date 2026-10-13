// Integrity check for the marketing site (issue #93).
// Usage: node site/check.mjs  (exit 0 = pass)
// Verifies: every local asset referenced from index.html exists, no external
// requests beyond the allowlisted GitHub links, required sections present.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); };

// 1. Required sections.
for (const id of ['features', 'compatibility', 'open-source', 'get-started']) {
  check(html.includes(`id="${id}"`), `missing section #${id}`);
}
check(html.includes('class="hero"'), 'missing hero section');
check(html.includes('<footer'), 'missing footer');

// 2. Local references resolve.
// Exception: demo/ is populated at deploy time (CI builds the single-file
// offline demo into it); it is intentionally absent from the repo.
const DEPLOY_TIME = new Set(['demo/']);
const refs = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map(m => m[1]);
const local = refs.filter(r => !/^(https?:|mailto:|#)/.test(r) && !DEPLOY_TIME.has(r));
check(local.length > 0, 'no local references found (unexpected)');
for (const r of local) {
  check(existsSync(resolve(root, r)), `missing local asset: ${r}`);
}

// 3. External links are only the allowlisted GitHub repo/docs ones.
const external = refs.filter(r => /^https?:/.test(r));
for (const r of external) {
  check(
    r.startsWith('https://github.com/tomesposito/opensight'),
    `non-allowlisted external URL: ${r}`
  );
}

// 4. No external asset loads (scripts, stylesheets, images, video sources,
//    posters must all be local) — the site makes zero third-party requests.
const loads = [...html.matchAll(/<(?:script|link|img|video|source)[^>]*?(?:src|href|poster)="([^"]+)"/g)].map(m => m[1]);
for (const r of loads) {
  check(!/^https?:/.test(r), `external asset load: ${r}`);
}

// 5. Hero video sources + poster present.
for (const f of ['assets/hero.mp4', 'assets/hero.webm', 'assets/hero-poster.jpg']) {
  check(existsSync(resolve(root, f)), `missing hero asset: ${f}`);
}

// 6. License honesty: the site must say Apache-2.0 (the repo's license),
//    never MIT.
check(!/MIT license/i.test(html), 'site must not claim an MIT license');
check(html.includes('Apache-2.0'), 'site must name the Apache-2.0 license');

// 7. CTA targets.
check(html.includes('href="demo/"'), 'missing demo/ CTA');
check(html.includes('href="https://github.com/tomesposito/opensight"'), 'missing GitHub CTA');

if (failures.length) {
  console.error(`site/check.mjs FAILED (${failures.length}):`);
  for (const f of failures) console.error(' -', f);
  process.exit(1);
}
console.log(`site/check.mjs OK: ${local.length} local refs, ${external.length} allowlisted external links`);
