import { decodePng, normalizeToReference } from './image.js';
import { scoreRegions } from './diff.js';
import {
  ParityError,
  ERR,
  type Pairing,
  type PairingResult,
  type ParityReport,
  type TopGap,
} from './types.js';

export const DEFAULT_TOLERANCE = 16;
export const DEFAULT_EQUIVALENT_THRESHOLD = 0.05;

export const INTERPRETATION =
  'Scores are pixel-difference fractions, not fidelity grades: layouts, copy, data and ' +
  'fonts legitimately differ between a QuickSight product screenshot and the OpenSight demo, ' +
  'so absolute values are expected to be high. Use baseline-to-baseline deltas of the same ' +
  'pairing to judge whether a change moved fidelity; a region below the equivalent threshold ' +
  'reads as visually equivalent at this protocol.';

function isPairing(v: unknown): v is Pairing {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.id === 'string' &&
    typeof p.title === 'string' &&
    typeof p.reference === 'string' &&
    typeof p.capture === 'string' &&
    typeof p.viewport === 'string' &&
    typeof p.theme === 'string' &&
    typeof p.fixture === 'string' &&
    Array.isArray(p.regions) &&
    Array.isArray(p.exclusions) &&
    Array.isArray(p.structural)
  );
}

export function parseConfig(json: string): Pairing[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (cause) {
    throw new ParityError(ERR.CONFIG_INVALID, `config is not valid JSON: ${(cause as Error).message}`);
  }
  const list = (raw as { pairings?: unknown }).pairings;
  if (!Array.isArray(list) || list.length === 0 || !list.every(isPairing)) {
    throw new ParityError(ERR.CONFIG_INVALID, 'config must define a non-empty "pairings" array of pairings');
  }
  return list as Pairing[];
}

export async function runPairing(
  pairing: Pairing,
  tolerance: number,
  equivalentThreshold: number,
): Promise<PairingResult> {
  const ref = await decodePng(pairing.reference);
  const cap = await decodePng(pairing.capture);
  const norm = normalizeToReference(ref, cap);
  const { scores, overallDiffFraction } = scoreRegions(
    ref,
    norm.image,
    pairing.regions,
    pairing.exclusions,
    tolerance,
    equivalentThreshold,
  );
  return {
    id: pairing.id,
    title: pairing.title,
    reference: pairing.reference,
    capture: pairing.capture,
    referenceSize: { w: ref.w, h: ref.h },
    captureSize: { w: cap.w, h: cap.h },
    normalizedTo: { w: ref.w, h: ref.h },
    scale: norm.scale,
    crop: norm.crop,
    aspectMismatch: norm.aspectMismatch,
    regions: scores,
    overallDiffFraction,
    structural: pairing.structural,
  };
}

export async function buildReport(
  pairings: Pairing[],
  opts: { tolerance?: number; equivalentThreshold?: number } = {},
): Promise<ParityReport> {
  const tolerance = opts.tolerance ?? DEFAULT_TOLERANCE;
  const equivalentThreshold = opts.equivalentThreshold ?? DEFAULT_EQUIVALENT_THRESHOLD;
  const results: PairingResult[] = [];
  for (const pairing of pairings) {
    results.push(await runPairing(pairing, tolerance, equivalentThreshold));
  }
  const topGaps: TopGap[] = results
    .flatMap((r) =>
      r.regions.map((s) => ({
        pairing: r.id,
        region: s.name,
        description: s.description,
        diffFraction: s.diffFraction,
      })),
    )
    .sort((a, b) => b.diffFraction - a.diffFraction)
    .slice(0, 10);
  return {
    tool: '@opensight/parity',
    generatedAt: new Date().toISOString(),
    tolerance,
    equivalentThreshold,
    interpretation: INTERPRETATION,
    pairings: results,
    topGaps,
  };
}

const pct = (f: number): string => `${(f * 100).toFixed(1)}%`;

export function renderMarkdown(report: ParityReport): string {
  const lines: string[] = [];
  lines.push('# Parity measurement baseline');
  lines.push('');
  lines.push(`Generated ${report.generatedAt} by \`${report.tool}\` (tolerance ${report.tolerance}, equivalent below ${pct(report.equivalentThreshold)}).`);
  lines.push('');
  lines.push(`> ${report.interpretation}`);
  lines.push('');
  lines.push('## Top measured gaps (by region diff fraction)');
  lines.push('');
  lines.push('| # | Pairing | Region | Diff | What the region holds |');
  lines.push('| - | ------- | ------ | ---- | --------------------- |');
  report.topGaps.forEach((g, i) => {
    lines.push(`| ${i + 1} | ${g.pairing} | ${g.region} | ${pct(g.diffFraction)} | ${g.description} |`);
  });
  lines.push('');
  for (const p of report.pairings) {
    lines.push(`## ${p.id} — ${p.title}`);
    lines.push('');
    lines.push(`Reference ${p.referenceSize.w}×${p.referenceSize.h}; capture ${p.captureSize.w}×${p.captureSize.h} normalized to ${p.normalizedTo.w}×${p.normalizedTo.h} (scale ${p.scale.toFixed(3)}, crop ${p.crop.x},${p.crop.y}). Overall region-weighted diff: **${pct(p.overallDiffFraction)}**.${p.aspectMismatch ? ' ⚠️ ASPECT_MISMATCH — region scores are low-confidence.' : ''}`);
    lines.push('');
    lines.push('| Region | Diff | Verdict | Excluded px | What it holds |');
    lines.push('| ------ | ---- | ------- | ----------- | ------------- |');
    for (const s of p.regions) {
      lines.push(`| ${s.name} | ${pct(s.diffFraction)} | ${s.verdict} | ${s.excludedPixels} | ${s.description} |`);
    }
    lines.push('');
    lines.push('Structural checklist (recorded by hand at baseline time):');
    lines.push('');
    for (const item of p.structural) {
      lines.push(`- ${item.present ? '✅' : '❌'} ${item.item} — ${item.note}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
