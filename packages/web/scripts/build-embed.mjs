import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

// Build two independent single-file entries: the hosted renderer (verified API data)
// and the explicitly offline appearance fixture (synthetic states only).
const root = fileURLToPath(new URL('../', import.meta.url));
for (const [entry, filename] of [['embed.html', 'opensight-embed.html'], ['embed-preview.html', 'opensight-embed-preview.html']]) {
  const result = await build({
    root, configFile: false, base: './',
    build: {
      write: false, cssCodeSplit: false, modulePreload: false,
      rolldownOptions: { input: new URL(`../${entry}`, import.meta.url).pathname, output: { codeSplitting: false, comments: { legal: true } } },
    },
  });
  if (Array.isArray(result) || !('output' in result)) throw new Error('Expected a single demo bundle');
  const scripts = result.output.filter(item => item.type === 'chunk');
  const styles = result.output.filter(item => item.type === 'asset' && item.fileName.endsWith('.css'));
  const document = result.output.find(item => item.type === 'asset' && item.fileName === entry);
  if (scripts.length !== 1 || styles.length !== 1 || !document || result.output.length !== 3) {
    throw new Error('Embed renderer must contain exactly one script, one stylesheet and its HTML entry');
  }
  const html = String(document.source)
    .replace(/<script\b[^>]*src="[^"]+"[^>]*><\/script>/, () => `<script type="module">${scripts[0].code.replace(/<\/script/gi, '<\\/script')}</script>`)
    .replace(/<link\b[^>]*rel="stylesheet"[^>]*>/, () => `<style>${String(styles[0].source).replace(/<\/style/gi, '<\\/style')}</style>`);
  const output = new URL(`../dist/${filename}`, import.meta.url);
  await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
  await writeFile(output, html);
  console.log(`Embed entry: ${fileURLToPath(output)} (${Buffer.byteLength(html)} bytes)`);
}
