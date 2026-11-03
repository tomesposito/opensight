// Integrity check for the marketing site (issues #93, #106, #134, #176, #183, #184, #185).
// Usage: node site/check.mjs  (exit 0 = pass)
// Verifies: every local asset referenced from index.html exists, no external
// requests beyond allowlisted links, required sections and AEO artifacts present.
// Offline only: allowlisting does not verify external availability or demo/.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { canonicalUrl, manifest, renderDocs } from './build-docs.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); };

// 1. Required sections.
for (const id of ['features', 'compatibility', 'open-source', 'get-started', 'request-access']) {
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
  // A cache-busting query/fragment still names the same local file.
  check(existsSync(resolve(root, r.split(/[?#]/)[0].replace(/^\//, ''))), `missing local asset: ${r}`);
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
      )) || url.origin === APP_ORIGIN ||
      // The canonical link names the site's own homepage (issue #183).
      (url.origin === 'https://getopensight.org' && url.pathname === '/')
    ),
    `non-allowlisted external URL: ${r}`
  );
}

// 4. No external asset loads (scripts, stylesheets, images, video sources,
//    posters must all be local) — the site makes zero third-party requests.
const loads = [...html.matchAll(/<(?:script|link|img|video|source)[^>]*?(?:src|href|poster)="([^"]+)"/g)]
  // A canonical link is metadata, not an asset load (issue #183).
  .filter(m => !m[0].includes('rel="canonical"'))
  .map(m => m[1]);
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
const publicUrls = ['https://getopensight.org/', 'https://getopensight.org/pricing/',
  'https://getopensight.org/demo/', `${APP_ORIGIN}/`,
  canonicalUrl(''), ...manifest.map(page => canonicalUrl(page.slug))];
check(locations.length === publicUrls.length, `sitemap.xml must list exactly ${publicUrls.length} public entry points`);
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
const shareImage = 'https://getopensight.org/assets/og-image.jpg';
for (const [key, expected] of Object.entries({
  'og:title': title, 'og:description': description, 'og:type': 'website',
  'og:url': publicUrls[0], 'og:image': shareImage,
})) {
  check(content('property', key) === expected, `incorrect ${key} content`);
}
for (const [key, expected] of Object.entries({
  'twitter:card': 'summary_large_image', 'twitter:title': title,
  'twitter:description': description, 'twitter:image': shareImage,
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

// 11. D-79's approved access-request copy, visible labels and entry points.
const access = sections.find(section => section.startsWith('<section id="request-access"'));
check(sections.at(-1) === access && sections.at(-2)?.startsWith('<section id="get-started"'),
  'request access must follow Get started and precede the footer');
check(access?.includes('<h2>Want it hosted? Request access.</h2>'), 'incorrect request-access heading');
check(access?.match(/<p\b[^>]*>([\s\S]*?)<\/p>/)?.[1] === "OpenSight is free and open source, and you can run it yourself today. If you'd rather we ran it for you, hosted workspaces are opening in small batches. Request access and we'll set up your workspace by hand and send you an invitation.",
  'request-access body must match the approved text exactly');
for (const [id, copy] of Object.entries({
  'access-name': 'Name', 'access-email': 'Work email', 'access-organization': 'Organization',
  'access-note': 'What do you want to use OpenSight for?',
})) check(access?.includes(`<label for="${id}">${copy}</label>`), `incorrect access-request label: ${id}`);
for (const [id, copy] of Object.entries({
  'access-success': 'Thanks — your request is in. We set up hosted workspaces by hand, so expect an invitation by email when yours is ready.',
  'access-error': "That didn't go through. Check your connection and try again.",
})) check(access?.match(new RegExp(`<p id="${id}"[^>]*>([^<]+)</p>`))?.[1] === copy, `incorrect approved message: ${id}`);
check(access?.match(/<button\b[^>]*type="submit"[^>]*>([^<]+)<\/button>/)?.[1] === 'Request access', 'incorrect request-access submit copy');
check(html.match(/<div class="nav-cta">([\s\S]*?)<\/div>/)?.[1].includes('href="#request-access">Request access</a>'), 'missing nav Request access link');
check(sections[0]?.includes('href="#request-access">Request hosted access</a>'), 'missing hero Request hosted access CTA');

// 12. Canonical, share-image dimensions and structured data (issue #183).
const canonicals = [...html.matchAll(/<link rel="canonical" href="([^"]+)">/g)].map(m => m[1]);
check(canonicals.length === 1 && canonicals[0] === publicUrls[0],
  'expected exactly one canonical link naming the homepage');
// og-image.jpg on disk is 2400x1260 (verified with `file`), not the 1200x630
// the issue text assumed — the tags declare the asset's true size.
check(content('property', 'og:image:width') === '2400', 'incorrect og:image:width content');
check(content('property', 'og:image:height') === '1260', 'incorrect og:image:height content');
check(content('property', 'og:image:alt') === title, 'incorrect og:image:alt content');
const ldRaw = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
check(Boolean(ldRaw), 'missing application/ld+json structured data');
let ld = null;
try { ld = ldRaw ? JSON.parse(ldRaw) : null; } catch { /* Reported below. */ }
check(ld !== null, 'application/ld+json must parse as JSON');
if (ld) {
  check(ld['@context'] === 'https://schema.org', 'JSON-LD @context must be schema.org');
  check(ld['@type'] === 'SoftwareApplication', 'JSON-LD @type must be SoftwareApplication');
  check(ld.name === 'OpenSight', 'JSON-LD name must be OpenSight');
  check(ld.url === publicUrls[0], 'JSON-LD url must be the homepage');
  check(ld.applicationCategory === 'BusinessApplication', 'JSON-LD applicationCategory');
  check(ld.operatingSystem === 'Any', 'JSON-LD operatingSystem');
  check(ld.license === 'https://www.apache.org/licenses/LICENSE-2.0', 'JSON-LD license');
  check(ld.offers?.['@type'] === 'Offer' && ld.offers?.price === '0' &&
    ld.offers?.priceCurrency === 'USD', 'JSON-LD offers must be a free USD Offer');
  check(ld.codeRepository === 'https://github.com/tomesposito/opensight', 'JSON-LD codeRepository');
  check(Array.isArray(ld.sameAs) && ld.sameAs.includes('https://github.com/tomesposito/opensight'),
    'JSON-LD sameAs must include the GitHub repo');
}

// 13. Docs are committed, indexable, current and entirely local to load (#185).
const docsPages = [{ slug: '' }, ...manifest];
for (const { slug } of docsPages) {
  const name = `docs/${slug ? `${slug}/` : ''}index.html`;
  const page = readArtifact(name);
  const url = canonicalUrl(slug);
  const canonical = [...page.matchAll(/<link rel="canonical" href="([^"]+)">/g)];
  check(canonical.length === 1 && canonical[0][1] === url, `${name}: incorrect canonical URL: ${url}`);
  check(!/<meta\b[^>]*(?:noindex|nofollow)/i.test(page), `${name}: docs must be indexable`);
  check(!/<(?:script|iframe|object|embed|style)\b/i.test(page), `${name}: scripts and embedded content are not allowed`);
  check(page.includes(`href="${slug ? '../' : ''}docs.css"`), `${name}: missing relative docs.css`);
  for (const tag of page.matchAll(/<(?:link|img|video|audio|source|input|image)\b[^>]*>/gi)) {
    if (/\brel="canonical"/.test(tag[0])) continue;
    for (const attr of tag[0].matchAll(/\b(?:src|href|poster|srcset)="([^"]+)"/gi)) {
      check(!/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(attr[1]), `${name}: external asset load: ${attr[1]}`);
    }
  }
  for (const match of page.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    const ref = match[1];
    if (/^(?:https?:|#)/.test(ref) || ref === '/demo/') continue;
    const path = ref.split(/[?#]/)[0];
    const target = path.startsWith('/') ? resolve(root, path.slice(1)) : resolve(root, dirname(name), path);
    check(existsSync(target), `${name}: missing local reference: ${ref}`);
  }
}
const docsCss = readArtifact('docs/docs.css');
check(!/@import|url\s*\(/i.test(docsCss), 'docs/docs.css: asset loads and imports are not allowed');
try {
  for (const [path, fresh] of renderDocs()) {
    const name = path.slice('site/'.length);
    check(existsSync(resolve(root, name)) && readFileSync(resolve(root, name), 'utf8') === fresh,
      `${name}: stale generated docs; run node site/build-docs.mjs`);
  }
} catch (error) {
  check(false, `docs generation failed: ${error.message}`);
}

// 14. Pricing page (issue #184): the copy Tom approved on 2026-11-03 is exact,
// the tier table carries the decided quotas, vendor sources are linked, and
// the home nav links Pricing next to Request access.
const pricingUrl = 'https://getopensight.org/pricing/';
const pricing = readArtifact('pricing/index.html');
const stripTags = text => text.replace(/<[^>]+>/g, '');
check(pricing.match(/<title>([^<]+)<\/title>/)?.[1] === 'Pricing — OpenSight',
  'pricing: incorrect page title');
check(pricing.match(/<h1>([^<]+)<\/h1>/)?.[1] === 'Pricing', 'pricing: H1 must be Pricing');
const pricingCanonicals = [...pricing.matchAll(/<link rel="canonical" href="([^"]+)">/g)].map(m => m[1]);
check(pricingCanonicals.length === 1 && pricingCanonicals[0] === pricingUrl,
  'pricing: expected exactly one canonical link naming the pricing page');
check(pricing.includes('Apache-2.0'), 'pricing: page must name the Apache-2.0 license');
check(!/MIT license/i.test(pricing), 'pricing: page must not claim an MIT license');
const pricingParas = [...pricing.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map(m => stripTags(m[1]));
for (const copy of [
  'OpenSight is free. Run it yourself and it costs nothing: the code is Apache-2.0, it is the same product we host, and no feature sits behind a paywall.',
  'Hosted OpenSight is paying us to run it for you — hosting, backups, updates, support, and an SLA. The tiers below differ in quotas, not in features.',
  'The free tier has no time limit. The quotas above are its limit, not a clock.',
  'Hit a quota and that usage stops until the next month or a higher tier. There is no overage bill running in the background.',
  'Take a team of 20: 4 people who build dashboards and 16 who view them. That team fits the Regular tier above, at 20 users.',
  'Tableau (Standard): 4 Creators at $75 is $300 a month. 16 Viewers at $15 is $240 a month. That is $540 a month, $6,480 a year, billed annually.',
  'Power BI (Pro): $14 per person, so 20 people is $280 a month, $3,360 a year, paid yearly. One check first: Pro is included in Microsoft 365 E5, so if your team already has E5, you may already be paying for it.',
  'OpenSight hosted (Regular): $99 a month, $1,188 a year. The price does not change when a viewer starts building, because there are no seat roles to price.',
  'OpenSight self-hosted: $0. You run it on your own machine and pay for that machine.',
  "Vendor prices checked 2 November 2026 on Tableau's and Microsoft's published pricing pages; links to both pages will sit under this section on the page itself.",
  'Hosted workspaces are opening in small batches. Request access and we set your workspace up by hand and send you an invitation.',
]) check(pricingParas.includes(copy), `pricing: missing or altered approved copy: ${copy.slice(0, 60)}…`);
check(pricing.includes('<h2>What a 20-person team costs elsewhere</h2>'),
  'pricing: missing approved comparison heading');
const tierHeaders = [...pricing.matchAll(/<th scope="col">([\s\S]*?)<\/th>/g)].map(m => stripTags(m[1]));
check(JSON.stringify(tierHeaders) === JSON.stringify(
  ['Quota', 'Free', 'Light — $29/mo', 'Regular — $99/mo', 'Heavy — $399/mo']),
  `pricing: tier table headers differ from the decided tiers: ${tierHeaders.join(' | ')}`);
const tierBody = pricing.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? '';
const tierRows = [...tierBody.matchAll(/<tr>([\s\S]*?)<\/tr>/g)]
  .map(row => [...row[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/g)].map(cell => stripTags(cell[1])));
const expectedTierRows = [
  ['Users', '3', '5', '20', '75'],
  ['Storage', '5 GB', '10 GB', '100 GB', '500 GB'],
  ['API calls', '10k', '30k', '300k', '2M'],
  ['Queries', '500', '1.5k', '15k', '100k'],
  ['Natural-language queries', '10', '50', '500', '3k'],
  ['Emails', '100', '500', '5k', '25k'],
  ['Egress', '5 GB', '20 GB', '150 GB', '800 GB'],
];
check(JSON.stringify(tierRows) === JSON.stringify(expectedTierRows),
  'pricing: tier table quotas differ from the decided quotas');
check(pricing.includes('<caption>Per tenant, per month</caption>'),
  'pricing: tier table must be captioned per tenant, per month');
for (const link of [
  '<a href="https://www.tableau.com/pricing/cloud">Tableau pricing</a>',
  '<a href="https://www.microsoft.com/power-platform/products/power-bi/pricing">Microsoft Power BI pricing</a>',
]) check(pricing.includes(link), `pricing: missing vendor source link: ${link}`);
check(pricing.includes('<a class="btn btn-primary btn-lg" href="../#request-access">Request hosted access</a>'),
  'pricing: missing Request hosted access button to the home request-access form');
for (const match of pricing.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
  const ref = match[1];
  if (/^(?:https?:|#)/.test(ref) || ref === '../demo/') continue;
  const path = ref.split(/[?#]/)[0];
  const target = path.startsWith('/') ? resolve(root, path.slice(1)) : resolve(root, 'pricing', path);
  check(existsSync(target), `pricing: missing local reference: ${ref}`);
}
const homeNavCta = html.match(/<div class="nav-cta">([\s\S]*?)<\/div>/)?.[1] ?? '';
check(homeNavCta.indexOf('href="pricing/">Pricing</a>') !== -1 &&
  homeNavCta.indexOf('href="pricing/">Pricing</a>') < homeNavCta.indexOf('href="#request-access">Request access</a>'),
  'home nav must link Pricing next to Request access');

if (failures.length) {
  console.error(`site/check.mjs FAILED (${failures.length}):`);
  for (const f of failures) console.error(' -', f);
  process.exit(1);
}
console.log(`site/check.mjs OK: ${local.length} local refs, ${anchors.length} internal anchors, ${external.length} allowlisted external links, ${docsPages.length} fresh docs pages, AEO artifacts and approved copy verified (offline; demo/ is deploy-time)`);
