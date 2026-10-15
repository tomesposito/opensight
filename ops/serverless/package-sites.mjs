import { lstatSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { digest } from './release-manifest.mjs';
import { frontendFiles } from './release-safety.mjs';
import { marketingFiles } from './frontend-policy.mjs';
export function packageSites(site, demo, target) {
  const manifestPath = join(target, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath));
  frontendFiles(manifest);
  if (existsSync(join(target, 'marketing'))) throw Error('MARKETING_TARGET_EXISTS');
  // Check all inputs before writing, including intermediate directories; do not
  // follow links to private files accidentally placed under the approved site.
  const input = marketingFiles.map(name => {
    const relative = name.slice('marketing/'.length);
    const source = relative === 'demo/index.html' ? demo : join(site, relative);
    const boundary = relative === 'demo/index.html' ? resolve(source) : resolve(site);
    for (let p = resolve(source); ; p = resolve(p, '..')) {
      if (lstatSync(p).isSymbolicLink()) throw Error('MARKETING_SOURCE_UNSAFE');
      if (p === boundary) break;
    }
    if (!lstatSync(source).isFile()) throw Error('MARKETING_SOURCE_UNSAFE');
    const bytes = readFileSync(source);
    if (!bytes.length || bytes.length > 16 * 1024 * 1024) throw Error('MARKETING_SOURCE_INVALID');
    return { name, source, hash: digest(bytes) };
  });
  for (const { name, source, hash } of input) {
    mkdirSync(resolve(target, name, '..'), { recursive: true });
    copyFileSync(source, join(target, name)); manifest.files[name] = hash;
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
