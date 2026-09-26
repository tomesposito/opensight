#!/usr/bin/env node
/**
 * Usage: node dist/summarize.js <bundle.qs | synthetic-analysis.json>
 */
import { loadBundle, summarizeBundle } from './parse.js';
import { loadQsBundle, summarizeQsBundle } from './archive.js';

const path = process.argv[2];
if (!path) {
  console.error('Usage: summarize <bundle.qs | synthetic-analysis.json>');
  process.exit(1);
}

if (path.toLowerCase().endsWith('.qs')) {
  console.log(JSON.stringify(summarizeQsBundle(await loadQsBundle(path)), null, 2));
} else {
  const summary = summarizeBundle(loadBundle(path));

  console.log(`Analysis: ${summary.name} (${summary.analysisId})`);
  console.log(`\nDatasets (${summary.dataSets.length}):`);
  for (const d of summary.dataSets) console.log(`  - ${d.identifier}`);

  console.log(`\nSheets (${summary.sheets.length}):`);
  for (const s of summary.sheets) {
    console.log(`  - ${s.name ?? s.sheetId} [${s.sheetId}]: ${s.visualCount} visual(s)`);
  }

  console.log(`\nVisuals (${summary.visuals.length}):`);
  for (const v of summary.visuals) {
    console.log(`  - [${v.kind}] ${v.title ?? v.visualId} (sheet: ${v.sheetName ?? v.sheetId})`);
  }

  console.log(`\nCalculated fields (${summary.calculatedFields.length}):`);
  for (const c of summary.calculatedFields) {
    console.log(`  - ${c.name} [${c.dataSet}]: ${c.expression}`);
  }

  console.log(`\nParameters (${summary.parameters.length}): ${summary.parameters.join(', ') || '—'}`);
  console.log(`Filter groups (${summary.filterGroups.length}): ${summary.filterGroups.join(', ') || '—'}`);
}
