// Executed inside the final image. No operator environment values are serialized.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const packages = [];
async function visit(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(dir, entry.name);
    if (entry.name.startsWith('@')) { await visit(path); continue; }
    const file = await readFile(join(path, 'package.json'), 'utf8').catch(() => null);
    if (file) { const p = JSON.parse(file); packages.push({ type: 'library', name: p.name, version: p.version,
      ...(typeof p.license === 'string' ? { licenses: [{ license: { name: p.license } }] } : {}) }); }
    await visit(join(path, 'node_modules')).catch(e => { if (e.code !== 'ENOENT') throw e; });
  }
}
await visit('/var/task/node_modules');
const rpm = execFileSync('rpm', ['-qa', '--queryformat', '%{NAME}\t%{VERSION}-%{RELEASE}\t%{LICENSE}\n'], { encoding: 'utf8' });
for (const line of rpm.trim().split('\n')) { const [name, version, license] = line.split('\t'); packages.push({ type: 'operating-system', name, version, licenses: [{ license: { name: license } }] }); }
console.log(JSON.stringify({ bomFormat: 'CycloneDX', specVersion: '1.5', version: 1,
  metadata: { component: { type: 'application', name: 'opensight' } }, components: packages.sort((a, b) => a.name.localeCompare(b.name)) }, null, 2));
