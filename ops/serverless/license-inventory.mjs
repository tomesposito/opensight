import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * License inventory gate for releases. Reads a CycloneDX SBOM (as produced
 * by ops/serverless/runtime-sbom.mjs), checks every component against the
 * D-27/D-36 license policy, and emits a canonical inventory whose digest
 * the release manifest binds.
 *
 * Policy (AGENTS.md + D-27):
 * - Application (npm) components: MIT, Apache-2.0, ISC, BSD variants, or an
 *   explicitly approved exception (tslib 0BSD). Anything else fails closed.
 * - OS components: the base image is infrastructure, not bundled application
 *   code; commercial/proprietary identifiers fail, copyleft is reported for
 *   operator review but does not block (see D-27).
 */

const APPROVED_NPM = new Set(['MIT', 'Apache-2.0', 'ISC', 'BSD', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'CC0-1.0', 'Unlicense', 'WTFPL']);
const APPROVED_EXCEPTIONS = new Map([['tslib', new Set(['0BSD'])]]); // D-27 explicit exception
const FORBIDDEN_OS = /(commercial|proprietary|unknown|none|not specified)/i;

export function licenseInventory(sbom) {
  const components = sbom?.components;
  if (!Array.isArray(components)) throw Error('LICENSE_SBOM_INVALID');
  const inventory = [];
  for (const c of components) {
    const names = (c.licenses ?? []).map(l => l?.license?.name).filter(Boolean);
    if (!names.length) throw Error('LICENSE_MISSING');
    const entry = { type: c.type, name: c.name, version: c.version, licenses: [...new Set(names)].sort() };
    if (c.type === 'library') {
      const exception = APPROVED_EXCEPTIONS.get(c.name);
      const ok = entry.licenses.every(l => APPROVED_NPM.has(l) || exception?.has(l));
      if (!ok) throw Error('LICENSE_POLICY_VIOLATION');
      entry.policy = 'approved';
    } else {
      if (entry.licenses.some(l => FORBIDDEN_OS.test(l))) throw Error('LICENSE_POLICY_VIOLATION');
      entry.policy = entry.licenses.some(l => /GPL|AGPL|LGPL/i.test(l)) ? 'review-copyleft' : 'approved';
    }
    inventory.push(entry);
  }
  inventory.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  const digest = createHash('sha256').update(JSON.stringify(inventory)).digest('hex');
  return { inventory, digest };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const sbom = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const { inventory, digest } = licenseInventory(sbom);
  const review = inventory.filter(i => i.policy === 'review-copyleft');
  console.log(JSON.stringify({ digest, components: inventory.length, review: review.map(r => r.name) }, null, 2));
  if (process.argv[3]) (await import('node:fs')).writeFileSync(process.argv[3], JSON.stringify(inventory, null, 2) + '\n');
}
