#!/usr/bin/env node
/**
 * CLI: node dist/run.js --config <pairings.json> --out <dir> [--tolerance N] [--threshold F]
 *
 * Reads a pairings config (kept outside the repo; it holds absolute paths
 * to the private reference screenshots), runs every pairing, and writes
 * report.json + report.md into <dir>.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildReport, parseConfig, renderMarkdown, ParityError } from './index.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const configPath = arg('--config');
  const outDir = arg('--out');
  if (!configPath || !outDir) {
    console.error('usage: run.js --config <pairings.json> --out <dir> [--tolerance N] [--threshold F]');
    process.exit(2);
  }
  const tolerance = arg('--tolerance') === undefined ? undefined : Number(arg('--tolerance'));
  const threshold = arg('--threshold') === undefined ? undefined : Number(arg('--threshold'));
  if ((tolerance !== undefined && !Number.isFinite(tolerance)) || (threshold !== undefined && !Number.isFinite(threshold))) {
    console.error('PARITY_CONFIG_INVALID: --tolerance and --threshold must be numbers');
    process.exit(2);
  }
  const pairings = parseConfig(await readFile(configPath, 'utf8'));
  const report = await buildReport(pairings, { tolerance, equivalentThreshold: threshold });
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(join(outDir, 'report.md'), renderMarkdown(report));
  for (const p of report.pairings) {
    console.log(`${p.id}: overall ${(p.overallDiffFraction * 100).toFixed(1)}%${p.aspectMismatch ? ' (ASPECT_MISMATCH)' : ''}`);
  }
}

main().catch((err) => {
  if (err instanceof ParityError) {
    console.error(err.message);
    process.exit(1);
  }
  console.error(err);
  process.exit(1);
});
