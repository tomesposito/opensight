import { lstatSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { digest } from './release-manifest.mjs';
import { frontendFiles } from './release-safety.mjs';
import { marketingFiles } from './frontend-policy.mjs';
export function hostedDemo(bytes) {
  const html = bytes.toString('utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/gi)];
  const match = /<script type="module">([\s\S]+)<\/script>/.exec(scripts[0]?.[0] ?? '');
  if (scripts.length !== 1 || !match) throw Error('DEMO_SCRIPT_INVALID');
  return { html: Buffer.from(html.replace(scripts[0][0], '<script type="module" src="./app.js"></script>')),
    script: Buffer.from(match[1]) };
}
export function packageSites(site, demo, target) {
  const manifestPath = join(target, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath));
  frontendFiles(manifest);
  if (existsSync(join(target, 'marketing'))) throw Error('MARKETING_TARGET_EXISTS');
  // Check all inputs before writing, including intermediate directories; do not
  // follow links to private files accidentally placed under the approved site.
  const input = marketingFiles.map(name => {
    const relative = name.slice('marketing/'.length);
    const isDemo = relative === 'demo/index.html' || relative === 'demo/app.js';
    const source = isDemo ? demo : join(site, relative);
    const boundary = isDemo ? resolve(source) : resolve(site);
    for (let p = resolve(source); ; p = resolve(p, '..')) {
      if (lstatSync(p).isSymbolicLink()) throw Error('MARKETING_SOURCE_UNSAFE');
      if (p === boundary) break;
    }
    if (!lstatSync(source).isFile()) throw Error('MARKETING_SOURCE_UNSAFE');
    let bytes = readFileSync(source);
    if (!bytes.length || bytes.length > 16 * 1024 * 1024) throw Error('MARKETING_SOURCE_INVALID');
    if (isDemo) { const split = hostedDemo(bytes); bytes = relative.endsWith('.js') ? split.script : split.html; }
    return { name, bytes, hash: digest(bytes) };
  });
  for (const { name, bytes, hash } of input) {
    mkdirSync(resolve(target, name, '..'), { recursive: true });
    writeFileSync(join(target, name), bytes); manifest.files[name] = hash;
  }
  frontendFiles(manifest, true);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [site, demo, target] = process.argv.slice(2);
  if (!site || !demo || !target?.startsWith('/')) throw Error('SITE_PACKAGE_ARGUMENT_INVALID');
  packageSites(site, demo, target);
  console.log('ATTESTED_MARKETING_AND_DEMO_ASSEMBLED');
}
