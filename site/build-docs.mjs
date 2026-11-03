// Dependency-free, deliberately bounded Markdown renderer for the public docs.
// Raw HTML is always text. No network, timestamps, scripts or generated CSS.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const manifest = [
  { source: 'docs/first-run.md', slug: 'getting-started', title: 'Getting started' },
  { source: 'docs/connector-gallery.md', slug: 'connectors', title: 'Data sources and connectors' },
  { source: 'docs/embedding-config.md', slug: 'embedding', title: 'Embedding configuration' },
  { source: 'docs/embed-sessions.md', slug: 'embedding-sessions', title: 'Embedded sessions' },
  { source: 'docs/permissions.md', slug: 'permissions', title: 'Permissions and row-level security' },
];
export const docsPath = slug => `/docs/${slug ? `${slug}/` : ''}`;
export const canonicalUrl = slug => `https://getopensight.org${docsPath(slug)}`;
const github = 'https://github.com/tomesposito/opensight';

export function escapeHtml(value) {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

export function rewriteLink(href, source) {
  if (/^https?:\/\//i.test(href) || href.startsWith('#')) return href;
  // Reject active schemes and protocol-relative URLs instead of emitting them.
  if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('//') || /[\s\\]/.test(href)) {
    throw new Error(`Unsupported documentation link in ${source}: ${href}`);
  }
  const [, path, suffix] = href.match(/^([^?#]*)(.*)$/);
  const target = path.startsWith('/')
    ? posix.normalize(path.slice(1))
    : posix.normalize(posix.join(posix.dirname(source), path));
  if (target === '..' || target.startsWith('../')) throw new Error(`Link escapes repository: ${href}`);
  const page = manifest.find(entry => entry.source === target);
  return `${page ? docsPath(page.slug) : `${github}/blob/master/${target}`}${suffix}`;
}

// Find a balanced closing bracket, allowing nested parentheses in link targets.
function closing(text, start, open, close) {
  let depth = 1;
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === '\\') { i++; continue; }
    if (text[i] === open) depth++;
    if (text[i] === close && --depth === 0) return i;
  }
  return -1;
}

function inline(text, source, plain = false) {
  const literal = value => plain ? value : escapeHtml(value);
  let output = '';
  for (let i = 0; i < text.length;) {
    const rest = text.slice(i);
    const escaped = rest.match(/^\\([\\`*_[\]{}()#+.!|>~-])/);
    if (escaped) { output += literal(escaped[1]); i += 2; continue; }
    const ticks = rest.match(/^`+/)?.[0];
    if (ticks) {
      const end = text.indexOf(ticks, i + ticks.length);
      if (end !== -1) {
        let code = text.slice(i + ticks.length, end).replace(/\n/g, ' ');
        if (/^ .* $/.test(code) && /[^ ]/.test(code)) code = code.slice(1, -1);
        output += plain ? code : `<code>${escapeHtml(code)}</code>`;
        i = end + ticks.length;
        continue;
      }
    }
    if (text[i] === '[') {
      const labelEnd = closing(text, i, '[', ']');
      if (labelEnd !== -1 && text[labelEnd + 1] === '(') {
        const end = closing(text, labelEnd + 1, '(', ')');
        if (end !== -1) {
          const label = inline(text.slice(i + 1, labelEnd), source, plain);
          const href = rewriteLink(text.slice(labelEnd + 2, end), source);
          output += plain ? label : `<a href="${escapeHtml(href)}">${label}</a>`;
          i = end + 1;
          continue;
        }
      }
    }
    const emphasis = rest.match(/^(\*\*|__|\*|_)(?=\S)/)?.[0];
    if (emphasis && !(emphasis.includes('_') && /[\p{L}\p{N}]/u.test(text[i - 1] ?? ''))) {
      const end = text.indexOf(emphasis, i + emphasis.length);
      if (end > i + emphasis.length && !/\s/.test(text[end - 1])) {
        const content = inline(text.slice(i + emphasis.length, end), source, plain);
        const tag = emphasis.length === 2 ? 'strong' : 'em';
        output += plain ? content : `<${tag}>${content}</${tag}>`;
        i = end + emphasis.length;
        continue;
      }
    }
    output += literal(text[i++]);
  }
  return output;
}

const heading = line => {
  const match = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*$/);
  if (match) match[2] = match[2].replace(/\s+#+$/, '');
  return match;
};
const fence = line => line.match(/^ {0,3}(`{3,}|~{3,})([^\s]*)\s*$/);
const rule = line => /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(line);
const listItem = line => {
  const match = line.match(/^( *)([-+*]|\d+[.)])( +)(.*)$/);
  return match && { indent: match[1].length, ordered: /^\d/.test(match[2]),
    start: Number.parseInt(match[2], 10), width: match[1].length + match[2].length + match[3].length,
    content: match[4] };
};

// Pipes inside code spans and escaped pipes are content, not cell boundaries.
function cells(line) {
  const row = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  const result = [];
  let cell = '', ticks = '';
  for (let i = 0; i < row.length; i++) {
    if (row[i] === '\\' && i + 1 < row.length) { cell += row[i] + row[++i]; continue; }
    if (row[i] === '`') {
      const run = row.slice(i).match(/^`+/)[0];
      if (!ticks) ticks = run;
      else if (ticks === run) ticks = '';
      cell += run; i += run.length - 1; continue;
    }
    if (row[i] === '|' && !ticks) { result.push(cell.trim()); cell = ''; }
    else cell += row[i];
  }
  result.push(cell.trim());
  return result;
}

function parseBlocks(lines) {
  const blocks = [];
  const tableAt = i => i + 1 < lines.length && lines[i].includes('|') &&
    cells(lines[i + 1]).every(cell => /^:?-{3,}:?$/.test(cell)) &&
    cells(lines[i]).length === cells(lines[i + 1]).length;
  const startsBlock = i => heading(lines[i]) || fence(lines[i]) || rule(lines[i]) ||
    listItem(lines[i]) || /^ {0,3}>/.test(lines[i]) || tableAt(i);
  for (let i = 0; i < lines.length;) {
    if (!lines[i].trim()) { i++; continue; }
    const h = heading(lines[i]), f = fence(lines[i]);
    if (f) {
      const content = [];
      const end = new RegExp(`^ {0,3}${f[1][0]}{${f[1].length},}\\s*$`);
      i++;
      while (i < lines.length && !end.test(lines[i])) content.push(lines[i++]);
      if (i === lines.length) throw new Error('Unclosed Markdown code fence');
      i++;
      blocks.push({ type: 'code', language: f[2], text: content.join('\n') });
    } else if (h) {
      blocks.push({ type: 'heading', level: h[1].length, text: h[2] }); i++;
    } else if (rule(lines[i])) {
      blocks.push({ type: 'rule' }); i++;
    } else if (/^ {0,3}>/.test(lines[i])) {
      const content = [];
      while (i < lines.length && /^ {0,3}>/.test(lines[i])) content.push(lines[i++].replace(/^ {0,3}> ?/, ''));
      blocks.push({ type: 'quote', blocks: parseBlocks(content) });
    } else if (listItem(lines[i])) {
      const first = listItem(lines[i]), items = [];
      let loose = false;
      while (i < lines.length) {
        const item = listItem(lines[i]);
        if (!item || item.indent !== first.indent || item.ordered !== first.ordered) break;
        const content = [item.content];
        i++;
        while (i < lines.length) {
          if (!lines[i].trim()) {
            let next = i + 1;
            while (next < lines.length && !lines[next].trim()) next++;
            const following = next < lines.length ? listItem(lines[next]) : null;
            if (following?.indent === first.indent && following.ordered === first.ordered) {
              loose = true; i = next; break;
            }
            if (next < lines.length && lines[next].startsWith(' '.repeat(item.width))) {
              content.push(''); i++; loose = true; continue;
            }
            break;
          }
          if (lines[i].startsWith(' '.repeat(item.width))) content.push(lines[i++].slice(item.width));
          else if (!startsBlock(i)) content.push(lines[i++]); // Lazy paragraph continuation.
          else break;
        }
        items.push(parseBlocks(content));
      }
      blocks.push({ type: 'list', ordered: first.ordered, start: first.start, loose, items });
    } else if (tableAt(i)) {
      const headers = cells(lines[i]), rows = [];
      const align = cells(lines[i + 1]).map(cell => cell.startsWith(':')
        ? (cell.endsWith(':') ? 'center' : 'left') : (cell.endsWith(':') ? 'right' : ''));
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes('|') && !startsBlock(i)) {
        const row = cells(lines[i++]);
        rows.push(headers.map((_, column) => row[column] ?? ''));
      }
      blocks.push({ type: 'table', headers, align, rows });
    } else {
      const content = [lines[i++].trim()];
      while (i < lines.length && lines[i].trim() && !startsBlock(i)) content.push(lines[i++].trim());
      blocks.push({ type: 'paragraph', text: content.join('\n') });
    }
  }
  return blocks;
}

export function renderMarkdown(markdown, source = 'docs/first-run.md') {
  const blocks = parseBlocks(markdown.replace(/\r\n?/g, '\n').split('\n'));
  const ids = new Set();
  const render = (nodes, tight = false) => nodes.map(block => {
    switch (block.type) {
      case 'heading': {
        const base = inline(block.text, source, true).toLowerCase().replace(/[^\p{L}\p{N}_\-\s]/gu, '').replace(/\s/g, '-');
        let id = base, suffix = 0;
        while (ids.has(id)) id = `${base}-${++suffix}`;
        ids.add(id);
        return `<h${block.level} id="${escapeHtml(id)}">${inline(block.text, source)}</h${block.level}>`;
      }
      case 'paragraph': return tight ? inline(block.text, source) : `<p>${inline(block.text, source)}</p>`;
      case 'code': return `<pre><code${block.language ? ` class="language-${escapeHtml(block.language)}"` : ''}>${escapeHtml(block.text)}\n</code></pre>`;
      case 'rule': return '<hr>';
      case 'quote': return `<blockquote>\n${render(block.blocks)}\n</blockquote>`;
      case 'list': {
        const tag = block.ordered ? 'ol' : 'ul';
        const start = block.ordered && block.start !== 1 ? ` start="${block.start}"` : '';
        return `<${tag}${start}>\n${block.items.map(item => `<li>${render(item, !block.loose)}</li>`).join('\n')}\n</${tag}>`;
      }
      case 'table': {
        const row = (values, tag) => `<tr>${values.map((value, i) => `<${tag}${tag === 'th' ? ' scope="col"' : ''}${block.align[i] ? ` class="align-${block.align[i]}"` : ''}>${inline(value, source)}</${tag}>`).join('')}</tr>`;
        return `<div class="table-scroll" role="region" aria-label="Table" tabindex="0">\n<table>\n<thead>${row(block.headers, 'th')}</thead>\n<tbody>\n${block.rows.map(values => row(values, 'td')).join('\n')}\n</tbody>\n</table>\n</div>`;
      }
      default: throw new Error(`Unknown Markdown block: ${block.type}`);
    }
  }).join('\n');
  const title = blocks.find(block => block.type === 'heading' && block.level === 1)?.text;
  const firstParagraph = blocks.find(block => block.type === 'paragraph')?.text ?? '';
  return {
    html: render(blocks),
    title: title ? inline(title, source, true) : '',
    summary: inline(firstParagraph, source, true).replace(/\s+/g, ' ').trim(),
  };
}

export function description(summary) {
  if (summary.length <= 160) return summary;
  const clipped = summary.slice(0, 157);
  const boundary = clipped.lastIndexOf(' ');
  return `${clipped.slice(0, boundary > 100 ? boundary : 157).replace(/[,;:]$/, '')}…`;
}

function pageHtml({ title, summary, slug = '', article, footer, brand }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — OpenSight docs</title>
<meta name="description" content="${escapeHtml(description(summary))}">
<link rel="canonical" href="${canonicalUrl(slug)}">
<link rel="stylesheet" href="${slug ? '../' : ''}docs.css">
</head>
<body>
<a class="skip-link" href="#content">Skip to content</a>
<header class="topnav">
  <div class="wrap nav-inner">
    ${brand}
    <nav class="nav-links" aria-label="Main">
      <a href="/">Home</a>
      <a href="/docs/" aria-current="${slug ? 'true' : 'page'}">Docs</a>
      <a href="${github}">GitHub</a>
    </nav>
  </div>
</header>
<div class="wrap docs-layout">
  <nav class="docs-nav" aria-label="Documentation">
    <a class="docs-home" href="/docs/"${slug ? '' : ' aria-current="page"'}>Documentation</a>
    <ul>
${manifest.map(entry => `      <li><a href="${docsPath(entry.slug)}"${entry.slug === slug ? ' aria-current="page"' : ''}>${escapeHtml(entry.title)}</a></li>`).join('\n')}
    </ul>
  </nav>
  <main id="content">
    <article>
${article}
    </article>
  </main>
</div>
${footer}
</body>
</html>
`;
}

// Pure generation from repository inputs; tests compare these bytes without writing.
export function renderDocs(root = repoRoot) {
  const home = readFileSync(resolve(root, 'site/index.html'), 'utf8');
  const brand = home.match(/<a class="brand"[\s\S]*?<\/a>/)?.[0]?.replace('href="#top"', 'href="/"');
  const footer = home.match(/<footer\b[\s\S]*?<\/footer>/)?.[0]
    ?.replaceAll('href="demo/"', 'href="/demo/"')
    .replaceAll(`href="${github}/tree/master/docs"`, 'href="/docs/"');
  if (!brand || !footer) throw new Error('Missing marketing site brand or footer');
  const pages = manifest.map(entry => {
    const rendered = renderMarkdown(readFileSync(resolve(root, entry.source), 'utf8'), entry.source);
    if (!rendered.title || !rendered.summary) throw new Error(`Missing H1 or first paragraph: ${entry.source}`);
    return { ...entry, ...rendered };
  });
  const output = new Map(pages.map(page => [`site/docs/${page.slug}/index.html`, pageHtml({
    ...page, article: page.html, footer, brand,
  })]));
  output.set('site/docs/index.html', pageHtml({
    title: 'Documentation', summary: 'Install and run OpenSight, connect data, configure embedding, and understand permissions and row-level security.',
    article: `<h1 id="documentation">Documentation</h1>\n<ul class="docs-index">\n${pages.map(page => `  <li><h2><a href="${docsPath(page.slug)}">${escapeHtml(page.title)}</a></h2><p>${escapeHtml(page.summary)}</p></li>`).join('\n')}\n</ul>`,
    footer, brand,
  }));
  return output;
}

export function buildDocs(root = repoRoot) {
  const pages = renderDocs(root);
  for (const [path, html] of pages) {
    mkdirSync(dirname(resolve(root, path)), { recursive: true });
    writeFileSync(resolve(root, path), html);
  }
  return pages.size;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`Rendered ${buildDocs()} documentation pages.`);
}
