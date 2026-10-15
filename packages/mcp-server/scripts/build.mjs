import { build } from 'esbuild';
import { readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const result = await build({ absWorkingDir: root, entryPoints: ['src/index.ts', 'src/cli.ts'], outdir: 'dist',
  bundle: true, platform: 'node', target: 'node24', format: 'esm', metafile: true,
  plugins: [{ name: 'sdk-supported-mit-validator', setup(b) {
    // The low-level protocol imports parseWithCompat; its unused Zod-v3 converter
    // has only module-local initializers. Mark that unused package side-effect free.
    b.onResolve({ filter: /^zod-to-json-schema$/ }, () => ({ path: fileURLToPath(import.meta.resolve('zod-to-json-schema')), sideEffects: false }));
    b.onResolve({ filter: /\/ajv-provider\.js$/ }, args => {
      if (!args.importer.includes('@modelcontextprotocol/sdk/')) throw new Error('Unexpected validator import');
      return { path: resolve(root, 'scripts/sdk-validator.mjs') };
    });
  } }], banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  legalComments: 'inline' });
const packages = new Map();
const contributed = new Set(Object.values(result.metafile.outputs).flatMap(output => Object.entries(output.inputs).filter(([, detail]) => detail.bytesInOutput > 0).map(([input]) => input)));
for (const input of contributed) {
  if (!input.includes('node_modules/')) continue;
  let directory = dirname(resolve(root, input));
  while (!existsSync(join(directory, 'package.json'))) {
    const parent = dirname(directory); if (parent === directory) throw new Error('Unresolved package license'); directory = parent;
  }
  let manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  // ESM subdirectories can contain a module marker rather than a package manifest.
  while (!manifest.name) {
    directory = dirname(directory);
    if (existsSync(join(directory, 'package.json'))) manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  }
  if (!['MIT', 'Apache-2.0'].includes(manifest.license)) throw new Error(`Unapproved shipped license: ${manifest.name} ${manifest.license}`);
  const license = readdirSync(directory).find(name => /^licen[sc]e(?:\..*)?$/i.test(name));
  const licensePath = license ? join(directory, license) : manifest.name === '@cfworker/json-schema' ? join(root, 'licenses/cfworker-MIT.txt') : undefined;
  if (!licensePath) throw new Error(`Missing license text: ${manifest.name}`);
  packages.set(manifest.name, { name: manifest.name, version: manifest.version, license: manifest.license, notice: readFileSync(licensePath, 'utf8') });
}
for (const output of Object.values(result.metafile.outputs)) {
  for (const imported of output.imports) if (imported.external && !imported.path.startsWith('node:')) throw new Error(`Unbundled runtime import: ${imported.path}`);
}
writeFileSync(join(root, 'dist/THIRD_PARTY_NOTICES.txt'), [...packages.values()].map(p => `${p.name} ${p.version} (${p.license})\n${p.notice}`).join('\n\n'));
writeFileSync(join(root, 'dist/license-audit.json'), JSON.stringify([...packages.values()].map(({ notice, ...p }) => p), null, 2) + '\n');
// tsc supplies declarations; only the audited bundles may remain executable in dist.
for (const name of readdirSync(join(root, 'dist'))) if ((name.endsWith('.js') && !['cli.js', 'index.js'].includes(name)) || name.endsWith('.map')) rmSync(join(root, 'dist', name));
console.log(`Bundled runtime licenses: ${[...packages.values()].map(p => `${p.name}@${p.version} ${p.license}`).join(', ')}`);
