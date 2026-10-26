// Integrity check for the marketing site (issues #93, #106, #134).
// Usage: node site/check.mjs  (exit 0 = pass)
// Verifies: every local asset referenced from index.html exists, no external
// requests beyond allowlisted links, required sections and AEO artifacts present.
// Offline only: allowlisting does not verify external availability or demo/.
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
const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1]);
const local = refs.filter(r => !/^(https?:|mailto:|#)/.test(r) && !DEPLOY_TIME.has(r));
check(local.length > 0, 'no local references found (unexpected)');
for (const r of local) {
  check(existsSync(resolve(root, r)), `missing local asset: ${r}`);
}
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
const anchors = refs.filter(r => r.startsWith('#'));
for (const r of anchors) {
  check(ids.has(r.slice(1)), `missing internal anchor target: ${r}`);
}

// 3. External links are only the allowlisted ones: the GitHub repo/docs and
// the hosted product app (issue #106).
const APP_ORIGIN = 'https://app.getopensight.org';
const external = refs.filter(r => /^https?:/.test(r));
for (const r of external) {
  let url;
  try { url = new URL(r); } catch { /* Report malformed links with the other failures. */ }
  check(
    url && !url.username && !url.password && !/\s/.test(r) && (
      (url.origin === 'https://github.com' && (
        url.pathname === '/tomesposito/opensight' ||
        url.pathname.startsWith('/tomesposito/opensight/')
      )) || url.origin === APP_ORIGIN
    ),
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
check(html.includes('href="https://app.getopensight.org"'), 'missing Open the app CTA');

// 8. Crawler discovery. Missing files should produce named check failures.
const readArtifact = name => {
  const path = resolve(root, name);
  check(existsSync(path), `missing ${name}`);
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
};
const robots = readArtifact('robots.txt');
const groups = robots.split(/\r?\n\s*\r?\n/);
for (const agent of ['*', 'meta-webindexer']) {
  check(groups.some(group => {
    const lines = group.split(/\r?\n/).map(line => line.trim());
    return lines.includes(`User-agent: ${agent}`) && lines.includes('Allow: /');
  }), `robots.txt must explicitly allow ${agent}`);
}
check(!/^Disallow:\s*\S+/m.test(robots), 'robots.txt must not disallow crawling');
check(/^Sitemap: https:\/\/getopensight\.org\/sitemap\.xml\s*$/m.test(robots),
  'robots.txt must name the absolute sitemap URL');

const sitemap = readArtifact('sitemap.xml');
check(sitemap.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">') &&
  sitemap.includes('</urlset>'), 'sitemap.xml must use the sitemap namespace and urlset');
const locations = [...sitemap.matchAll(/<url>\s*<loc>([^<]+)<\/loc>\s*<\/url>/g)].map(m => m[1]);
const publicUrls = ['https://getopensight.org/', 'https://getopensight.org/demo/', `${APP_ORIGIN}/`];
check(locations.length === publicUrls.length, 'sitemap.xml must list exactly three public entry points');
for (const url of publicUrls) {
  check(locations.includes(url), `sitemap.xml missing public entry point: ${url}`);
}

// 9. Social cards reuse the existing title, description and local hero poster.
const meta = [...html.matchAll(/<meta\b[^>]*>/g)].map(m =>
  Object.fromEntries([...m[0].matchAll(/([\w:-]+)="([^"]*)"/g)].map(a => [a[1], a[2]])));
const content = (attribute, key) => {
  const tags = meta.filter(tag => tag[attribute] === key);
  check(tags.length === 1 && Boolean(tags[0].content?.trim()),
    `expected one non-empty meta ${attribute}="${key}"`);
  return tags[0]?.content;
};
const title = html.match(/<title>([^<]+)<\/title>/)?.[1];
const description = content('name', 'description');
const poster = 'https://getopensight.org/assets/hero-poster.jpg';
for (const [key, expected] of Object.entries({
  'og:title': title, 'og:description': description, 'og:type': 'website',
  'og:url': publicUrls[0], 'og:image': poster,
})) {
  check(content('property', key) === expected, `incorrect ${key} content`);
}
for (const [key, expected] of Object.entries({
  'twitter:card': 'summary_large_image', 'twitter:title': title,
  'twitter:description': description, 'twitter:image': poster,
})) {
  check(content('name', key) === expected, `incorrect ${key} content`);
}

// 10. Approved copy is exact, is the first H2, and immediately follows the hero.
const question = 'Looking for an open-source alternative to QuickSight?';
const answer = "If your team already runs on AWS and you want BI with nothing to operate, QuickSight is the simpler choice — it's managed and billed per user. If you want to own your BI — self-host it, avoid per-seat pricing, and keep your dashboards in the same definition format — OpenSight is the better fit. OpenSight is Apache-2.0, reads and writes QuickSight analysis and dashboard definitions, and runs anywhere, no AWS account required.";
check(html.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/)?.[1] === question,
  'the approved question must be the first H2');
const sections = [...html.matchAll(/<section\b[^>]*>[\s\S]*?<\/section>/g)].map(m => m[0]);
check(sections[0]?.startsWith('<section class="hero">') &&
  sections[1]?.startsWith('<section id="quicksight-alternative"') &&
  sections[1]?.includes(`<h2>${question}</h2>`),
  'the question-led section must immediately follow the hero');
check(sections[1]?.match(/<p\b[^>]*>([\s\S]*?)<\/p>/)?.[1] === answer,
  'the question-led body must match the approved text exactly');
const footer = html.match(/<footer\b[^>]*>[\s\S]*?<\/footer>/)?.[0];
check(footer?.includes('<p>Last updated October 2026</p>'), 'missing footer freshness line');

if (failures.length) {
  console.error(`site/check.mjs FAILED (${failures.length}):`);
  for (const f of failures) console.error(' -', f);
  process.exit(1);
}
console.log(`site/check.mjs OK: ${local.length} local refs, ${anchors.length} internal anchors, ${external.length} allowlisted external links, AEO artifacts and approved copy verified (offline; demo/ is deploy-time)`);
