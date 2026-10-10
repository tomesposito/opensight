import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
const [kind, target] = process.argv.slice(2);
if (!['runtime', 'frontend'].includes(kind) || !target?.startsWith('/') || resolve(target) === process.cwd()) throw Error('PACKAGE_ARGUMENT_INVALID');
await mkdir(target, { recursive: true });
if (kind === 'frontend') await cp('packages/web/dist', target, { recursive: true });
else {
  for (const file of ['package.json', 'package-lock.json', 'LICENSE', 'node_modules']) await cp(file, join(target, file), { recursive: true, verbatimSymlinks: true });
  for (const name of await readdir('packages')) {
    await mkdir(join(target, 'packages', name), { recursive: true });
    await cp(join('packages', name, 'package.json'), join(target, 'packages', name, 'package.json'));
    if (name === 'web') {
      await cp('packages/web/build/server', join(target, 'packages/web/build/server'), { recursive: true });
      await mkdir(join(target, 'packages/web/dist'));
      for (const file of await readdir('packages/web/dist')) if (/^opensight-embed.*\.html$/.test(file)) await cp(join('packages/web/dist', file), join(target, 'packages/web/dist', file));
    } else await cp(join('packages', name, 'dist'), join(target, 'packages', name, 'dist'), { recursive: true });
  }
  await mkdir(join(target, 'ops/serverless'), { recursive: true });
  await cp('ops/serverless/rds-ca.pem', join(target, 'ops/serverless/rds-ca.pem'));
}
const files = {};
async function inventory(dir, prefix = '') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relative = join(prefix, entry.name), path = join(dir, entry.name);
    if (entry.isDirectory()) await inventory(path, relative);
    else if (entry.isFile()) files[relative] = createHash('sha256').update(await readFile(path)).digest('hex');
  }
}
await inventory(target);
await writeFile(join(target, 'manifest.json'), JSON.stringify({ version: 1, kind, platform: kind === 'runtime' ? 'linux/arm64' : 'browser', node: process.version, files }, null, 2) + '\n');
