import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildDocs, canonicalUrl, description, escapeHtml, manifest, renderDocs, renderMarkdown, repoRoot, rewriteLink } from './build-docs.mjs';

test('docs headings, paragraphs and inline formatting preserve text and make unique anchors', () => {
  const result = renderMarkdown('# Hello & `world`\n\nA **bold** and *italic*\nparagraph with __strong__ and _emphasis_.\n\n## Repeat\n## Repeat\n## Repeat-1');
  assert.equal(result.title, 'Hello & world');
  assert.equal(result.summary, 'A bold and italic paragraph with strong and emphasis.');
  assert.equal(result.html, '<h1 id="hello--world">Hello &amp; <code>world</code></h1>\n<p>A <strong>bold</strong> and <em>italic</em>\nparagraph with <strong>strong</strong> and <em>emphasis</em>.</p>\n<h2 id="repeat">Repeat</h2>\n<h2 id="repeat-1">Repeat</h2>\n<h2 id="repeat-1-1">Repeat-1</h2>');
  assert.equal(renderMarkdown('ENV_VAR_NAME and \\*literal\\*').html, '<p>ENV_VAR_NAME and *literal*</p>');
  assert.equal(renderMarkdown('## C#\n\n## Closed ###').html, '<h2 id="c">C#</h2>\n<h2 id="closed">Closed</h2>');
});

test('docs lists support nesting, mixed markers, ordered starts and continued paragraphs', () => {
  const markdown = '3. First\n   continued\n   - Child\n     1. Grandchild\n   - Second child\n4. Next\n\nAfter.';
  assert.equal(renderMarkdown(markdown).html, '<ol start="3">\n<li>First\ncontinued\n<ul>\n<li>Child\n<ol>\n<li>Grandchild</li>\n</ol></li>\n<li>Second child</li>\n</ul></li>\n<li>Next</li>\n</ol>\n<p>After.</p>');
  assert.equal(renderMarkdown('- First\n\n  Second paragraph\n\n- Next').html,
    '<ul>\n<li><p>First</p>\n<p>Second paragraph</p></li>\n<li><p>Next</p></li>\n</ul>');
  assert.equal(renderMarkdown('- One\n+ Two\n* Three').html, '<ul>\n<li>One</li>\n<li>Two</li>\n<li>Three</li>\n</ul>');
});

test('docs fenced and inline code are escaped, literal and independent of Markdown', () => {
  const result = renderMarkdown('```html\n<script>"&"</script>\n**literal**\n```\n\nUse `` `x` < y ``.');
  assert.equal(result.html, '<pre><code class="language-html">&lt;script&gt;&quot;&amp;&quot;&lt;/script&gt;\n**literal**\n</code></pre>\n<p>Use <code>`x` &lt; y</code>.</p>');
  assert.match(renderMarkdown('- Example\n  ~~~sh\n  echo ok\n  ~~~').html, /<li>Example\n<pre><code class="language-sh">echo ok\n<\/code><\/pre><\/li>/);
  assert.throws(() => renderMarkdown('```\nunfinished'), /Unclosed/);
});

test('docs tables preserve inline code pipes, escaped pipes, alignment and empty cells', () => {
  const result = renderMarkdown('| Name | Value |\n| :--- | ---: |\n| **Flag** | `a|b` |\n| A\\|B | <x> |\n| Empty | |');
  assert.match(result.html, /<thead><tr><th scope="col" class="align-left">Name<\/th><th scope="col" class="align-right">Value<\/th><\/tr><\/thead>/);
  assert.match(result.html, /<td class="align-left"><strong>Flag<\/strong><\/td><td class="align-right"><code>a\|b<\/code><\/td>/);
  assert.match(result.html, /A\|B<\/td><td class="align-right">&lt;x&gt;<\/td>/);
  assert.match(result.html, /Empty<\/td><td class="align-right"><\/td>/);
  assert.match(renderMarkdown('A | B\n--- | :---:\nx | y').html, /class="align-center">y<\/td>/);
});

test('docs blockquotes and horizontal rules keep their block structure', () => {
  assert.equal(renderMarkdown('> A **note**.\n>\n> - One\n> - Two\n\n---\n\nAfter').html,
    '<blockquote>\n<p>A <strong>note</strong>.</p>\n<ul>\n<li>One</li>\n<li>Two</li>\n</ul>\n</blockquote>\n<hr>\n<p>After</p>');
  for (const rule of ['***', '* * *', '___']) assert.equal(renderMarkdown(rule).html, '<hr>');
});

test('docs links rewrite manifest and repository targets while preserving anchors and HTTP URLs', () => {
  const cases = [
    ['embed-sessions.md#issuance-contracts', '/docs/embedding-sessions/#issuance-contracts'],
    ['./permissions.md', '/docs/permissions/'],
    ['../docs/connector-gallery.md', '/docs/connectors/'],
    ['../README.md#run-it', 'https://github.com/tomesposito/opensight/blob/master/README.md#run-it'],
    ['security-namespaces.md#row-policies', 'https://github.com/tomesposito/opensight/blob/master/docs/security-namespaces.md#row-policies'],
    ['../packages/api/src/server.ts', 'https://github.com/tomesposito/opensight/blob/master/packages/api/src/server.ts'],
    ['/docs/first-run.md', '/docs/getting-started/'],
    ['#configuration', '#configuration'],
    ['https://example.com/a_(b)?x=1&y=2#part', 'https://example.com/a_(b)?x=1&y=2#part'],
    ['http://127.0.0.1:5173', 'http://127.0.0.1:5173'],
  ];
  for (const [href, expected] of cases) assert.equal(rewriteLink(href, 'docs/embedding-config.md'), expected);
  assert.equal(renderMarkdown('[**Next**](embed-sessions.md#data-and-authoring-authorization)').html,
    '<p><a href="/docs/embedding-sessions/#data-and-authoring-authorization"><strong>Next</strong></a></p>');
  assert.match(renderMarkdown('[External](https://example.com/a_(b)?x=1&y=2)').html, /href="https:\/\/example.com\/a_\(b\)\?x=1&amp;y=2"/);
});

test('docs HTML and attribute injection is escaped and active URL schemes are rejected', () => {
  const result = renderMarkdown('# <img src=x onerror="alert(1)">\n\n<script>alert(1)</script> & \'quotes\'\n\n[x](https://example.com/"onclick="x)');
  assert.ok(!result.html.includes('<script>') && !result.html.includes('<img'));
  assert.match(result.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &#39;quotes&#39;/);
  assert.match(result.html, /href="https:\/\/example.com\/&quot;onclick=&quot;x"/);
  for (const href of ['javascript:alert(1)', 'data:text/html,x', '//example.com/x', '../../outside.md']) {
    assert.throws(() => rewriteLink(href, 'docs/first-run.md'), /Unsupported|escapes repository/);
  }
});

test('docs descriptions use plain first paragraphs and truncate at a word boundary', () => {
  const summary = renderMarkdown('# Title\n\nA [link](first-run.md) and **bold** with `code`.\n\nLater paragraph.').summary;
  assert.equal(summary, 'A link and bold with code.');
  assert.equal(description(summary), summary);
  const long = 'A reasonably long description with several words. '.repeat(6);
  const shortened = description(long);
  assert.ok(shortened.length <= 160 && shortened.endsWith('…'));
  assert.ok(long.startsWith(shortened.slice(0, -1) + ' '));
});

test('docs current sources render complete HTML5 pages and an index with all titles and summaries', () => {
  const pages = renderDocs();
  assert.equal(pages.size, manifest.length + 1);
  const index = pages.get('site/docs/index.html');
  for (const entry of manifest) {
    const page = pages.get(`site/docs/${entry.slug}/index.html`);
    const doc = renderMarkdown(readFileSync(resolve(repoRoot, entry.source), 'utf8'), entry.source);
    assert.ok(page.startsWith('<!DOCTYPE html>\n<html lang="en">'));
    assert.ok(page.includes(`<link rel="canonical" href="${canonicalUrl(entry.slug)}">`));
    assert.match(page, /<link rel="stylesheet" href="\.\.\/docs.css">/);
    assert.match(page, /<article>[\s\S]*<\/article>/);
    assert.match(page, /<footer class="footer">/);
    assert.ok(!/<script\b|<meta[^>]*noindex/i.test(page));
    assert.ok(index.includes(escapeHtml(doc.summary)));
    assert.ok(index.includes(`<h2><a href="/docs/${entry.slug}/">${escapeHtml(doc.title)}</a></h2>`));
    assert.ok(page.includes(`<title>${escapeHtml(doc.title)} — OpenSight docs</title>`));
    for (const other of manifest) assert.ok(page.includes(`href="/docs/${other.slug}/"`));
  }
  assert.match(index, /href="docs.css"/);
  // Actual sources contain multiline inline-code spans as well as numbered setup steps.
  assert.match(pages.get('site/docs/getting-started/index.html'), /<ol>/);
  assert.match(pages.get('site/docs/embedding-sessions/index.html'), /<table>/);
});

test('docs generation is byte-identical on repeat runs and reacts to source edits', t => {
  const root = mkdtempSync(join(tmpdir(), 'opensight-docs-build-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'site'), { recursive: true });
  mkdirSync(join(root, 'docs'));
  cpSync(resolve(repoRoot, 'site/index.html'), join(root, 'site/index.html'));
  for (const { source } of manifest) cpSync(resolve(repoRoot, source), join(root, source));
  assert.equal(buildDocs(root), manifest.length + 1);
  const first = new Map([...renderDocs(root)].map(([path]) => [path, readFileSync(join(root, path), 'utf8')]));
  assert.equal(buildDocs(root), manifest.length + 1);
  for (const [path, expected] of first) assert.equal(readFileSync(join(root, path), 'utf8'), expected);
  writeFileSync(join(root, 'docs/permissions.md'), '# Changed title\n\nChanged first paragraph.\n');
  buildDocs(root);
  assert.match(readFileSync(join(root, 'site/docs/permissions/index.html'), 'utf8'), /<title>Changed title — OpenSight docs<\/title>/);
  assert.match(readFileSync(join(root, 'site/docs/index.html'), 'utf8'), /Changed first paragraph/);
});

test('docs committed HTML exactly matches fresh rendering of current sources and site chrome', () => {
  const pages = renderDocs();
  for (const [path, expected] of pages) {
    assert.equal(readFileSync(resolve(repoRoot, path), 'utf8'), expected, `${path} is stale; run node site/build-docs.mjs`);
  }
  const committed = readdirSync(resolve(repoRoot, 'site/docs'), { recursive: true })
    .filter(path => path.endsWith('.html')).map(path => `site/docs/${path}`).sort();
  assert.deepEqual(committed, [...pages.keys()].sort(), 'Remove obsolete generated pages when changing the manifest');
});

test('site integrity checks catch missing docs, sitemap/canonical drift and external assets', t => {
  const root = mkdtempSync(join(tmpdir(), 'opensight-docs-check-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'site'), { recursive: true });
  mkdirSync(join(root, 'docs'));
  for (const { source } of manifest) cpSync(resolve(repoRoot, source), join(root, source));
  for (const name of ['index.html', 'check.mjs', 'build-docs.mjs', 'sitemap.xml', 'robots.txt', 'styles.css', 'app.js']) {
    cpSync(resolve(repoRoot, 'site', name), join(root, 'site', name));
  }
  cpSync(resolve(repoRoot, 'site/docs'), join(root, 'site/docs'), { recursive: true });
  cpSync(resolve(repoRoot, 'site/pricing'), join(root, 'site/pricing'), { recursive: true });
  cpSync(resolve(repoRoot, 'site/alternatives'), join(root, 'site/alternatives'), { recursive: true });
  cpSync(resolve(repoRoot, 'site/vs'), join(root, 'site/vs'), { recursive: true });
  // The existing homepage check only checks asset existence: no media copies needed.
  mkdirSync(join(root, 'site/assets'));
  const home = readFileSync(join(root, 'site/index.html'), 'utf8');
  for (const match of home.matchAll(/(?:src|href|poster)="(assets\/[^"?#]+)(?:[?#][^"]*)?"/g)) {
    writeFileSync(join(root, 'site', match[1]), '');
  }
  const run = () => spawnSync(process.execPath, [join(root, 'site/check.mjs')], { encoding: 'utf8' });
  const baseline = run();
  assert.equal(baseline.status, 0, baseline.stderr);
  const cases = [
    ['docs/permissions/index.html', () => null, /missing docs\/permissions\/index.html/],
    ['sitemap.xml', text => text.replace(/\s*<url>\s*<loc>https:\/\/getopensight.org\/docs\/permissions\/<\/loc>\s*<\/url>/, ''), /missing public entry point: https:\/\/getopensight.org\/docs\/permissions\//],
    ['docs/permissions/index.html', text => text.replace('rel="canonical"', 'rel="alternate"'), /incorrect canonical URL/],
    ['docs/permissions/index.html', text => text.replace('</head>', '<link rel="stylesheet" href="//example.com/style.css"></head>'), /external asset load/],
    ['docs/permissions/index.html', text => text.replace('</head>', '<meta name="robots" content="noindex"></head>'), /docs must be indexable/],
    ['docs/permissions/index.html', text => text.replace('</body>', '<script>alert(1)</script></body>'), /scripts and embedded content/],
    ['docs/docs.css', text => text + '\n@import "https://example.com/font.css";', /asset loads and imports/],
    ['docs/docs.css', text => text + '\nbody { background: url(//example.com/image.png); }', /asset loads and imports/],
    ['docs/permissions/index.html', text => text.replace('Access to an OpenSight', 'Obsolete text about OpenSight'), /stale generated docs/],
    ['pricing/index.html', text => text.replace('$99 a month, $1,188 a year', '$99 a month'), /missing or altered approved copy/],
    ['alternatives/quicksight/index.html', text => text.replace('no licence saving fixes it', 'no license saving fixes it'), /missing or altered approved copy/],
    ['vs/metabase/index.html', text => text.replace('both free to self-host', 'both free'), /incorrect page title/],
    ['alternatives/tableau/index.html', text => text.replace('costs $0, whether one person uses it', 'costs nothing, whether one person uses it'), /missing or altered approved copy/],
  ];
  for (const [name, change, expected] of cases) {
    const path = join(root, 'site', name), before = readFileSync(path, 'utf8');
    const after = change(before);
    if (after === null) rmSync(path);
    else writeFileSync(path, after);
    const result = run();
    assert.equal(result.status, 1, `${name}: ${result.stdout}`);
    assert.match(result.stderr, expected);
    writeFileSync(path, before);
  }
});

test('open economics rule stays published and no published page paywalls core governance (issue #165)', () => {
  const entry = manifest.find(page => page.slug === 'open-economics');
  assert.ok(entry, 'the open-economics rule must stay in the published docs manifest');
  const rule = readFileSync(resolve(repoRoot, entry.source), 'utf8').toLowerCase();
  for (const feature of ['single sign-on', 'row-level security', 'audit log', 'basic embedding']) {
    assert.ok(rule.includes(feature), `the open-economics rule must name ${feature}`);
  }
  assert.ok(rule.includes('never paywalled'), 'the open-economics rule must say never paywalled');

  // Published surfaces only: the marketing homepage plus every manifest doc
  // source. Decision records under docs/idd/ are history, not published copy.
  const features = 'single sign-on|\\bsso\\b|\\bsaml\\b|row-level security|audit log|embedding';
  const paywall = 'paid tier|paid plan|paid tiers|enterprise tier|enterprise plan|premium tier';
  const gated = new RegExp(`(${features})[^.\\n]{0,80}(${paywall})|(${paywall})[^.\\n]{0,80}(${features})`, 'i');
  const published = [resolve(repoRoot, 'site/index.html'),
    ...manifest.map(page => resolve(repoRoot, page.source))];
  for (const path of published) {
    assert.ok(!gated.test(readFileSync(path, 'utf8')),
      `${path} must not describe a core governance feature as a paid or enterprise tier feature`);
  }
});
