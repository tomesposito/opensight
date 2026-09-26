import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

// Rebuild from source as one inline module, so the fixture/author demo also opens
// from file:// without fetching module chunks, styles or assets.
const root = fileURLToPath(new URL('../', import.meta.url));
const result = await build({
  root, configFile: false, base: './',
  build: {
    write: false, cssCodeSplit: false, modulePreload: false,
    rolldownOptions: { output: { codeSplitting: false } },
  },
});
if (Array.isArray(result) || !('output' in result)) throw new Error('Expected a single demo bundle');
const scripts = result.output.filter(item => item.type === 'chunk');
const styles = result.output.filter(item => item.type === 'asset' && item.fileName.endsWith('.css'));
const document = result.output.find(item => item.type === 'asset' && item.fileName === 'index.html');
if (scripts.length !== 1 || styles.length !== 1 || !document || result.output.length !== 3) {
  throw new Error('Demo must contain exactly one script, one stylesheet and index.html');
}
const html = String(document.source)
  .replace(/<script\b[^>]*src="[^"]+"[^>]*><\/script>/, () => `<script type="module">${scripts[0].code.replace(/<\/script/gi, '<\\/script')}</script>`)
  .replace(/<link\b[^>]*rel="stylesheet"[^>]*>/, () => `<style>${String(styles[0].source).replace(/<\/style/gi, '<\\/style')}</style>`);
const output = new URL('../dist/opensight-demo.html', import.meta.url);
await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
await writeFile(output, html);
console.log(`Single-file demo: ${fileURLToPath(output)} (${Buffer.byteLength(html)} bytes)`);
