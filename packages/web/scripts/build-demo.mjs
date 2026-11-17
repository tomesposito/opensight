import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

// Rebuild from source as one inline module, so the fixture/author demo also opens
// from file:// without fetching module chunks, styles or assets.
const root = fileURLToPath(new URL('../', import.meta.url));
const result = await build({
  root, configFile: false, base: './',
  define: { 'import.meta.env.VITE_OPENSIGHT_OFFLINE_DEMO': JSON.stringify('true') },
  build: {
    write: false, cssCodeSplit: false, modulePreload: false,
    rolldownOptions: { output: { codeSplitting: false, comments: { legal: true } } },
  },
});
if (Array.isArray(result) || !('output' in result)) throw new Error('Expected a single demo bundle');
const scripts = result.output.filter(item => item.type === 'chunk');
const styles = result.output.filter(item => item.type === 'asset' && item.fileName.endsWith('.css'));
const document = result.output.find(item => item.type === 'asset' && item.fileName === 'index.html');
if (scripts.length !== 1 || styles.length !== 1 || !document || result.output.length !== 3) {
  throw new Error('Demo must contain exactly one script, one stylesheet and index.html');
}
// Issue #237: the demo is an app shell, not a placement page, so the
// deploy-time demo artifact serves noindex (links to it still work as CTAs).
// Only this built artifact gets the meta — the app shell source is shared
// with the local and hosted apps, which are not changed here.
const ROBOTS_META = '<meta name="robots" content="noindex, follow" />';
const withRobotsMeta = String(document.source).replace(
  /<meta name="viewport"[^>]*>/,
  match => `${match}\n    ${ROBOTS_META}`,
);
if (!withRobotsMeta.includes(ROBOTS_META)) {
  throw new Error('Demo document has no viewport meta to anchor the robots meta after');
}
const html = withRobotsMeta
  .replace(/<script\b[^>]*src="[^"]+"[^>]*><\/script>/, () => `<script type="module">${scripts[0].code.replace(/<\/script/gi, '<\\/script')}</script>`)
  .replace(/<link\b[^>]*rel="stylesheet"[^>]*>/, () => `<style>${String(styles[0].source).replace(/<\/style/gi, '<\\/style')}</style>`);
const output = new URL('../dist/opensight-demo.html', import.meta.url);
await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
await writeFile(output, html);
console.log(`Single-file demo: ${fileURLToPath(output)} (${Buffer.byteLength(html)} bytes)`);
