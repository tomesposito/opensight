// Integrity check for the marketing site (issues #93, #106, #134, #176, #183, #184, #185, #186, #187, #210, #237, #238).
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
  'https://getopensight.org/legal/terms/', 'https://getopensight.org/legal/privacy/',
  'https://getopensight.org/alternatives/quicksight/',
  'https://getopensight.org/alternatives/tableau/',
  'https://getopensight.org/alternatives/power-bi/',
  'https://getopensight.org/vs/metabase/',
  'https://getopensight.org/vs/superset/',
  canonicalUrl(''), ...manifest.map(page => canonicalUrl(page.slug))];
check(locations.length === publicUrls.length, `sitemap.xml must list exactly ${publicUrls.length} public entry points`);
for (const url of publicUrls) {
  check(locations.includes(url), `sitemap.xml missing public entry point: ${url}`);
}
// Issue #237: the app shells are not placement pages. /demo/ is a bare app
// shell and the app subdomain is a login shell on another host, so neither
// belongs in this sitemap; the demo artifact itself serves noindex instead.
check(!locations.includes('https://getopensight.org/demo/'),
  'sitemap.xml must not list the /demo/ app shell (#237)');
check(!locations.includes(`${APP_ORIGIN}/`),
  'sitemap.xml must not list the cross-host app subdomain (#237)');
const demoBuilder = readFileSync(resolve(root, '../packages/web/scripts/build-demo.mjs'), 'utf8');
check(demoBuilder.includes('<meta name="robots" content="noindex, follow" />'),
  'the demo build must inject the noindex, follow robots meta into the demo artifact (#237)');

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
check(pricing.match(/<title>([^<]+)<\/title>/)?.[1] === 'OpenSight pricing: free to self-host, hosted from $29/mo',
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
  'Hosted OpenSight is paying us to run it for you — hosting, backups, updates, and support. The tiers below differ in quotas, not in features.',
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

// 15. QuickSight alternatives page + migration guide (issue #186): the copy
// Tom approved on 2026-11-03 is exact, the page links the migration guide,
// the home QuickSight section links the page, and the guide's key lines
// survive into the generated docs page (freshness itself is section 13).
const altUrl = 'https://getopensight.org/alternatives/quicksight/';
const alt = readArtifact('alternatives/quicksight/index.html');
check(alt.match(/<title>([^<]+)<\/title>/)?.[1] === 'A QuickSight alternative you can own — OpenSight',
  'alternatives/quicksight: incorrect page title');
check(alt.match(/<h1>([^<]+)<\/h1>/)?.[1] === 'A QuickSight alternative you can own',
  'alternatives/quicksight: H1 must be the approved page title');
const altCanonicals = [...alt.matchAll(/<link rel="canonical" href="([^"]+)">/g)].map(m => m[1]);
check(altCanonicals.length === 1 && altCanonicals[0] === altUrl,
  'alternatives/quicksight: expected exactly one canonical link naming the page');
check(alt.includes('Apache-2.0'), 'alternatives/quicksight: page must name the Apache-2.0 license');
check(!/MIT license/i.test(alt), 'alternatives/quicksight: page must not claim an MIT license');
const altParas = [...alt.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map(m => stripTags(m[1]));
for (const copy of [
  'QuickSight charges per user. Every author, every reader, every month.',
  "OpenSight charges nothing for the software. It is Apache-2.0, all of it, with no open-core split. You run it on your own machines, and your dashboards stay in QuickSight's definition format, so leaving QuickSight does not mean rebuilding everything in a new tool's format, and leaving OpenSight later does not either.",
  'Export a bundle from QuickSight and import the .qs file in OpenSight. Sheets become tabs. Bar, line, pie, KPI, table and pivot visuals land in the editor. A bundle you import and export again without touching it comes back structurally unchanged, including properties OpenSight does not understand yet.',
  'Datasets are the manual step. An imported dataset points at a data source OpenSight has never seen, so it stays unresolved until you remap it to a local dataset, one visual at a time or a whole sheet at once. The step-by-step version, including what does not convert, is the migration guide.',
  'If your team already runs on AWS and you want BI with nothing to operate, QuickSight is the simpler choice. It is managed, and it is billed per user. Nobody on your team patches it, backs it up, or upgrades it.',
  'OpenSight asks you to run software. For some teams that trade is wrong, and no licence saving fixes it.',
  'Self-hosted: $0 for the software. You pay for the machine it runs on.',
  'If you would rather not run it, hosted workspaces are opening in small batches and are set up by hand.',
]) check(altParas.includes(copy), `alternatives/quicksight: missing or altered approved copy: ${copy.slice(0, 60)}…`);
for (const heading of ['Your QuickSight work comes with you', 'Where QuickSight is the better choice', 'What running it costs']) {
  check(alt.includes(`<h2>${heading}</h2>`), `alternatives/quicksight: missing approved heading: ${heading}`);
}
check(alt.includes('<a href="/docs/migrating-from-quicksight/">migration guide</a>'),
  'alternatives/quicksight: missing migration guide link');
check(alt.includes('<a class="btn btn-primary btn-lg" href="../../#request-access">Request hosted access</a>'),
  'alternatives/quicksight: missing Request hosted access button to the home request-access form');
for (const match of alt.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
  const ref = match[1];
  if (/^(?:https?:|#)/.test(ref) || ref === '../../demo/') continue;
  const path = ref.split(/[?#]/)[0];
  const target = path.startsWith('/') ? resolve(root, path.slice(1)) : resolve(root, 'alternatives/quicksight', path);
  check(existsSync(target), `alternatives/quicksight: missing local reference: ${ref}`);
}
const qsSection = sections.find(section => section.startsWith('<section id="quicksight-alternative"'));
check(qsSection?.includes('<a href="alternatives/quicksight/">A QuickSight alternative you can own</a>'),
  'home QuickSight section must link the alternatives page');
const guide = readArtifact('docs/migrating-from-quicksight/index.html');
const guideText = stripTags(guide);
for (const copy of [
  'Moving from QuickSight to OpenSight',
  'A QuickSight bundle carries four kinds of thing: analyses, dashboards, datasets and data sources.',
  'That list is your migration plan.',
  'An untouched import exports back with structural JSON equality: unknown properties, original casing inside opaque JSON, member order and layouts all survive.',
  'Imported dataset declarations stay unresolved on purpose.',
  'One more limit, stated plainly: bundles edited in OpenSight carry an opensightRoundTrip extension that preserves the original resource. OpenSight makes no claim that AWS accepts that extension back on re-import.',
  'Do not count dashboards. Count the two numbers in front of you: the datasets you need to recreate connections for, and the unsupported items in the import report.',
]) check(guideText.includes(copy), `migration guide: missing or altered approved copy: ${copy.slice(0, 60)}…`);

// 16. Competitor alternatives + versus pages (issue #187): the copy Tom
// approved on 2026-11-03 (issue comment 6599573360, approval 6603196634) is
// exact, every page cites its vendor source, closes with both approved
// buttons, cross-links the other three pages, and the home footer links all
// four. No page body links /pricing (approved placement).
const competitorPages = [
  {
    dir: 'alternatives/tableau', url: 'https://getopensight.org/alternatives/tableau/',
    title: 'Tableau charges for every seat. OpenSight charges for none.',
    pageTitle: 'Tableau alternative with no per-seat pricing — OpenSight',
    headings: ['What a 20-person team pays Tableau', 'Your Tableau workbooks do not come with you', 'Where Tableau is the better choice'],
    copy: [
      'Tableau prices people by role. On the Standard edition a Creator is $75 per user per month, an Explorer is $42, and a Viewer is $15, billed annually. Every deployment needs at least one Creator.',
      'OpenSight has no seats to price. The software is Apache-2.0 and costs $0, whether one person uses it or two hundred do.',
      'Take 20 people: 4 who build dashboards and 16 who view them.',
      '4 Creators at $75 is $300 a month. 16 Viewers at $15 is $240 a month. Together that is $540 a month, $6,480 a year, billed annually. If some of those viewers need to edit rather than just view, they move to Explorer at $42 and the bill climbs again.',
      'The same team on self-hosted OpenSight pays $0 for the software. The cost is the machine it runs on.',
      "Vendor prices checked 3 November 2026 on Tableau's published pricing page.",
      'This page will not pretend otherwise: OpenSight does not import Tableau workbooks. Its compatibility is with QuickSight — it reads and writes QuickSight analysis and dashboard definitions. A team leaving Tableau rebuilds its dashboards in OpenSight. What it gets for that work is a tool it owns outright, in a definition format it can take elsewhere later.',
      "If your analysts already work in Tableau Desktop and Tableau Prep Builder, and your team knows the tool, staying is a real option. Tableau's desktop authoring and data prep are deeper than what OpenSight offers today, and retraining a team costs more than a licence line suggests.",
      'OpenSight fits the team that has decided the per-seat bill itself is the problem, and is willing to rebuild once to end it.',
    ],
    sources: ['<a href="https://www.tableau.com/pricing/cloud">Tableau pricing</a>'],
    cross: ['../power-bi/', '../../vs/metabase/', '../../vs/superset/'],
  },
  {
    dir: 'alternatives/power-bi', url: 'https://getopensight.org/alternatives/power-bi/',
    title: 'First, check whether you already pay for Power BI',
    pageTitle: 'Power BI alternative with no per-user pricing — OpenSight',
    headings: ['What Power BI costs when you do pay for it', 'The real difference is the surrounding stack', 'What does not convert'],
    copy: [
      'Power BI Pro is included in Microsoft 365 E5. If your company already buys E5, you may already be paying for Power BI, and $0 extra is a hard price to argue with. Check that before you read the rest of this page.',
      'Pro is $14 per user per month, paid yearly. Premium Per User is $24. Twenty people on Pro is $280 a month, $3,360 a year.',
      'OpenSight self-hosted is $0 for the software, for any number of users. There is no per-user line to multiply.',
      "Vendor prices checked 3 November 2026 on Microsoft's published Power BI pricing page.",
      "Power BI sits inside Microsoft's stack: the service is part of Microsoft Fabric, and its natural home is a company already living in Microsoft 365. If that is your company, Power BI's fit is a genuine advantage, not a lock-in trick.",
      "OpenSight runs anywhere, with no Microsoft account and no AWS account required. Its dashboards live in QuickSight's definition format, so the work stays readable by another tool later. Pick it when the BI layer is the thing you want to own, outside any one vendor's stack.",
      'Power BI reports do not import into OpenSight. Leaving Power BI means rebuilding reports. The saving starts after that rebuild, not before it.',
    ],
    sources: ['<a href="https://www.microsoft.com/power-platform/products/power-bi/pricing">Microsoft Power BI pricing</a>'],
    cross: ['../tableau/', '../../vs/metabase/', '../../vs/superset/'],
  },
  {
    dir: 'vs/metabase', url: 'https://getopensight.org/vs/metabase/',
    title: 'OpenSight vs Metabase: both free to self-host. That is where the similarity ends.',
    pageTitle: 'OpenSight vs Metabase: QuickSight-compatible, Apache-2.0',
    headings: ['The licences differ, and so does the paid line', 'Where Metabase is the better choice', 'Where OpenSight is the better choice'],
    copy: [
      "Metabase's Open Source edition is free, self-hosted, with unlimited users. So is OpenSight. If price of the open edition is your only question, both answers are $0, and this page is about the questions after that one.",
      "Metabase's open edition is AGPL v3. OpenSight is Apache-2.0, all of it, with no commercial edition holding features back.",
      'That last part matters at the permissions line. In Metabase, row and column permissions, SSO and white-label embedding are Pro features. Pro is $575 a month including 10 users, then $12 per user after that — a 20-person team pays $575 plus 10 × $12, which is $695 a month. Even Metabase Cloud Starter, at $100 a month including 5 users and $6 per user after that ($190 a month for 20 people), does not include those permissions.',
      'In OpenSight, row and column security is in the open product. It is documented on the permissions page of this site, from the code as shipped.',
      "Metabase figures checked 3 November 2026 on Metabase's published pricing page.",
      'Metabase has been the first BI tool a lot of teams reach for since 2014, and its visual question builder is the gentler start for people who do not write SQL. If nobody on your team works in SQL and nobody is coming from QuickSight, Metabase is probably the easier first month.',
      "If your dashboards need to stay in QuickSight's definition format — because you came from QuickSight, or because you want the exit open — that is OpenSight's ground. It reads and writes QuickSight analysis and dashboard definitions. Metabase keeps your work in Metabase.",
      'The same applies if AGPL terms do not work for your company and Apache-2.0 does.',
    ],
    sources: ['<a href="https://www.metabase.com/pricing/">Metabase pricing</a>'],
    cross: ['../../alternatives/tableau/', '../../alternatives/power-bi/', '../superset/'],
  },
  {
    dir: 'vs/superset', url: 'https://getopensight.org/vs/superset/',
    title: 'OpenSight vs Apache Superset: same licence, different job',
    pageTitle: 'OpenSight vs Apache Superset: same licence, different job',
    headings: ['Superset is built for SQL teams, and it shows', "OpenSight's ground is a format, not a chart count"],
    copy: [
      'Apache Superset is Apache-2.0, like OpenSight. Self-hosted, it costs $0, like OpenSight. Nobody wins this comparison on licence or sticker price, so it comes down to what your team does all day.',
      "Superset's centre of gravity is SQL Lab, its browser SQL editor, with a no-code chart builder and 40+ visualization types around it. For a team of analysts who live in SQL and want the widest chart library they can self-host, Superset is the stronger tool today.",
      'Running it is a commitment. A production Superset deployment is several processes — the web app, a Celery worker and scheduler, Redis and a Postgres metadata database. Teams that would rather not run that buy Preset, the managed Superset service: free for up to 5 users, then $20 per user per month billed annually on Professional, with embedded dashboard viewer licences at $500 a month for 50 viewers.',
      "Superset and Preset facts checked 3 November 2026 on Apache Superset and Preset's published pages.",
      "OpenSight exists for the QuickSight-shaped problem. It reads and writes QuickSight analysis and dashboard definitions, so a team leaving QuickSight keeps its work in the same format, and a team adopting OpenSight can leave the same way. Superset has no QuickSight compatibility; your dashboards live in Superset's own format.",
      "If QuickSight is nowhere in your world, that ground is worth nothing to you, and the choice should be made on the tools themselves — where Superset's SQL depth may well win it.",
    ],
    sources: ['<a href="https://superset.apache.org/">Apache Superset</a>', '<a href="https://preset.io/pricing">Preset pricing</a>'],
    cross: ['../../alternatives/tableau/', '../../alternatives/power-bi/', '../metabase/'],
  },
];
const closingCopy = 'Try the live demo, or request hosted access — hosted workspaces are opening in small batches and are set up by hand.';
for (const page of competitorPages) {
  const name = `${page.dir}/index.html`;
  const body = readArtifact(name);
  check(body.match(/<title>([^<]+)<\/title>/)?.[1] === page.pageTitle,
    `${name}: incorrect page title`);
  check(body.match(/<h1>([^<]+)<\/h1>/)?.[1] === page.title, `${name}: H1 must be the approved page title`);
  const pageCanonicals = [...body.matchAll(/<link rel="canonical" href="([^"]+)">/g)].map(m => m[1]);
  check(pageCanonicals.length === 1 && pageCanonicals[0] === page.url,
    `${name}: expected exactly one canonical link naming the page`);
  check(body.includes('Apache-2.0'), `${name}: page must name the Apache-2.0 license`);
  check(!/MIT license/i.test(body), `${name}: page must not claim an MIT license`);
  const paras = [...body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map(m => stripTags(m[1]));
  for (const copy of [...page.copy, closingCopy]) {
    check(paras.includes(copy), `${name}: missing or altered approved copy: ${copy.slice(0, 60)}…`);
  }
  for (const heading of page.headings) {
    check(body.includes(`<h2>${heading}</h2>`), `${name}: missing approved heading: ${heading}`);
  }
  for (const link of page.sources) check(body.includes(link), `${name}: missing vendor source link: ${link}`);
  check(body.includes('<a class="btn btn-primary btn-lg" href="../../demo/">Try the live demo</a>'),
    `${name}: missing Try the live demo button`);
  check(body.includes('<a class="btn btn-primary btn-lg" href="../../#request-access">Request hosted access</a>'),
    `${name}: missing Request hosted access button to the home request-access form`);
  for (const href of page.cross) {
    check(body.includes(`<a href="${href}">`), `${name}: missing cross-link to ${href}`);
  }
  check(!/href="(?:\.\.\/)+pricing\/"|href="\/pricing\/"/.test(body.match(/<main[\s\S]*?<\/main>/)?.[0] ?? ''), `${name}: page body must not link /pricing (approved placement)`);
  for (const match of body.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    const ref = match[1];
    if (/^(?:https?:|#)/.test(ref) || ref === '../../demo/') continue;
    const path = ref.split(/[?#]/)[0];
    const target = path.startsWith('/') ? resolve(root, path.slice(1)) : resolve(root, page.dir, path);
    check(existsSync(target), `${name}: missing local reference: ${ref}`);
  }
}
check(footer?.includes('<a href="/alternatives/tableau/">Tableau alternative</a>'), 'home footer must link the Tableau page');
check(footer?.includes('<a href="/alternatives/power-bi/">Power BI alternative</a>'), 'home footer must link the Power BI page');
check(footer?.includes('<a href="/vs/metabase/">OpenSight vs Metabase</a>'), 'home footer must link the Metabase page');
check(footer?.includes('<a href="/vs/superset/">OpenSight vs Apache Superset</a>'), 'home footer must link the Superset page');

// 17. Legal pages (issue #210): the approved Terms of Service and Privacy
// Policy publish verbatim at /legal/, stamped with the publication date;
// every standard footer links both pages; the signup page (which carries no
// footer) links them from its terms line; and the SLA promise Tom removed
// on 2026-11-06 stays out of site copy and the open-economics doc.
const legalPages = [
  {
    dir: 'legal/terms', url: 'https://getopensight.org/legal/terms/',
    title: 'Terms of Service — OpenSight', h1: 'Terms of Service',
    copy: [
      'These terms govern the hosted OpenSight service at app.getopensight.org',
      'Light $29/month, Regular $99/month, Heavy $399/month, per workspace.',
      'These terms do not include a service-level agreement or uptime guarantee in version 1.0.',
      'Governing law: the laws of the State of Illinois, without regard to its conflict-of-law rules.',
    ],
  },
  {
    dir: 'legal/privacy', url: 'https://getopensight.org/legal/privacy/',
    title: 'Privacy Policy — OpenSight', h1: 'Privacy Policy',
    copy: [
      'We do not sell personal information, and we do not share workspace content with third parties for their own purposes.',
      'not row data, except where a question cannot be answered without a sample the product explicitly includes) are sent to our AI provider, currently AWS Bedrock',
      'Technical logs are kept for 90 days and then deleted or anonymized.',
    ],
  },
];
for (const page of legalPages) {
  const name = `${page.dir}/index.html`;
  const body = readArtifact(name);
  check(body.match(/<title>([^<]+)<\/title>/)?.[1] === page.title, `${name}: incorrect page title`);
  check(body.match(/<h1>([^<]+)<\/h1>/)?.[1] === page.h1, `${name}: H1 must be ${page.h1}`);
  const pageCanonicals = [...body.matchAll(/<link rel="canonical" href="([^"]+)">/g)].map(m => m[1]);
  check(pageCanonicals.length === 1 && pageCanonicals[0] === page.url,
    `${name}: expected exactly one canonical link naming the page`);
  check(body.includes('<p class="legal-meta">Last updated: November 6, 2026</p>'),
    `${name}: publication date must be stamped with the merge date`);
  check(body.includes('<p class="legal-meta">Version: 1.0</p>'), `${name}: missing version line`);
  const pageText = stripTags(body);
  for (const copy of page.copy) {
    check(pageText.includes(copy), `${name}: missing or altered approved copy: ${copy.slice(0, 60)}…`);
  }
  for (const match of body.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    const ref = match[1];
    if (/^(?:https?:|mailto:|#)/.test(ref) || ref === '../../demo/') continue;
    const path = ref.split(/[?#]/)[0];
    const target = path.startsWith('/') ? resolve(root, path.slice(1)) : resolve(root, page.dir, path);
    check(existsSync(target), `${name}: missing local reference: ${ref}`);
  }
}
const footerPages = ['index.html', 'pricing/index.html',
  'alternatives/quicksight/index.html', 'alternatives/tableau/index.html',
  'alternatives/power-bi/index.html', 'vs/metabase/index.html', 'vs/superset/index.html',
  'legal/terms/index.html', 'legal/privacy/index.html',
  'docs/index.html', ...manifest.map(page => `docs/${page.slug}/index.html`)];
for (const name of footerPages) {
  const pageFooter = readArtifact(name).match(/<footer\b[^>]*>[\s\S]*?<\/footer>/)?.[0];
  check(pageFooter?.includes('<a href="/legal/terms/">Terms</a>'), `${name}: footer must link the Terms page`);
  check(pageFooter?.includes('<a href="/legal/privacy/">Privacy</a>'), `${name}: footer must link the Privacy page`);
}
const signup = readArtifact('signup/index.html');
check(signup.includes('<a href="/legal/terms/">terms</a>'), 'signup: terms line must link the Terms page');
check(signup.includes('<a href="/legal/privacy/">privacy policy</a>'), 'signup: terms line must link the Privacy page');
check(!pricing.includes('SLA'), 'pricing: the SLA promise must not return (removed 2026-11-06)');
const economics = readArtifact('docs/open-economics/index.html');
check(!economics.includes('SLA'), 'docs/open-economics: the SLA promise must not return (removed 2026-11-06)');
check(economics.includes('Paid tiers buy higher usage quotas and support.'),
  'docs/open-economics: paid-tiers sentence must match the SLA-free source doc');

// 18. Marketing meta batch (issue #238): the titles and meta descriptions
// Tom approved on 2026-11-09 are exact on all 11 audited pages. Title tags
// are search copy and no longer mirror the H1s on the competitor pages;
// the generated docs pages carry their approved values as metaTitle /
// metaDescription overrides in build-docs.mjs, so no docs description is
// an auto-truncated excerpt ending mid-sentence.
const metaBatch = [
  ['index.html', 'OpenSight — the open-source BI platform',
    'OpenSight is an open-source BI tool: connect data, prepare datasets, build analyses and dashboards, and ask questions in natural language. Self-hosted.'],
  ['pricing/index.html', 'OpenSight pricing: free to self-host, hosted from $29/mo',
    'OpenSight is free: run it yourself and it costs nothing. Hosted tiers — Free, Light $29/mo, Regular $99/mo, Heavy $399/mo — differ in quotas, not features.'],
  ['alternatives/quicksight/index.html', 'A QuickSight alternative you can own — OpenSight',
    "QuickSight charges per user. OpenSight charges nothing: Apache-2.0, no open-core split, self-hosted, and dashboards stay in QuickSight's definition format."],
  ['alternatives/tableau/index.html', 'Tableau alternative with no per-seat pricing — OpenSight',
    'Tableau charges per seat: Creator $75, Explorer $42, Viewer $15 per user/month, billed annually. OpenSight is Apache-2.0 and costs $0 for any number of users.'],
  ['alternatives/power-bi/index.html', 'Power BI alternative with no per-user pricing — OpenSight',
    'Power BI Pro is $14 per user/month, paid yearly, and included in Microsoft 365 E5. OpenSight is Apache-2.0, self-hosted, and $0 for any number of users.'],
  ['vs/metabase/index.html', 'OpenSight vs Metabase: QuickSight-compatible, Apache-2.0',
    'Metabase and OpenSight are both free to self-host. The licences differ — AGPL v3 vs Apache-2.0 — and row and column security is open in OpenSight, not Pro-only.'],
  ['vs/superset/index.html', 'OpenSight vs Apache Superset: same licence, different job',
    'Apache Superset and OpenSight are both Apache-2.0 and free to self-host. Superset is built for SQL teams; OpenSight reads and writes QuickSight definitions.'],
  ['docs/index.html', 'Documentation — OpenSight docs',
    'Install and run OpenSight, connect data, configure embedding, and understand permissions and row-level security. Plus getting started and migration guides.'],
  ['docs/migrating-from-quicksight/index.html', 'Moving from QuickSight to OpenSight — OpenSight docs',
    'A QuickSight bundle carries four kinds of thing: analyses, dashboards, datasets and data sources. OpenSight imports the bundle file directly. Here is the move.'],
  ['docs/permissions/index.html', 'Permissions and row-level security — OpenSight docs',
    'Access to an OpenSight analysis or dashboard and access to its data are separate permissions. Sharing a definition lets someone open the asset, not the data.'],
  ['docs/open-economics/index.html', 'Open economics: features never paywalled — OpenSight docs',
    'OpenSight is Apache-2.0. The hosted service charges for running it, not unlocking it: SSO, row-level security and core governance are never paywalled.'],
];
for (const [name, expectedTitle, expectedDescription] of metaBatch) {
  const page = readArtifact(name);
  check(page.match(/<title>([^<]+)<\/title>/)?.[1] === expectedTitle,
    `${name}: title must match the approved #238 value exactly`);
  check(page.match(/<meta name="description" content="([^"]*)">/)?.[1] === expectedDescription,
    `${name}: meta description must match the approved #238 value exactly`);
}

if (failures.length) {
  console.error(`site/check.mjs FAILED (${failures.length}):`);
  for (const f of failures) console.error(' -', f);
  process.exit(1);
}
console.log(`site/check.mjs OK: ${local.length} local refs, ${anchors.length} internal anchors, ${external.length} allowlisted external links, ${docsPages.length} fresh docs pages, AEO artifacts and approved copy verified (offline; demo/ is deploy-time)`);
