import {
  buildReport,
  decodePng,
  diffRegion,
  normalizeToReference,
  parseConfig,
  renderMarkdown,
  scoreRegions,
  DEFAULT_TOLERANCE,
  DEFAULT_EQUIVALENT_THRESHOLD,
  INTERPRETATION,
} from '@opensight/parity';
import type {
  Pairing,
  ParityReport,
  Region,
  RegionScore,
  FracRect,
} from '@opensight/parity';

async function exercise(): Promise<void> {
  const rect: FracRect = { x: 0, y: 0, w: 1, h: 1 };
  const region: Region = { name: 'full', rect, description: 'whole image' };
  const pairing: Pairing = {
    id: 'demo',
    title: 'Demo',
    reference: '/tmp/ref.png',
    capture: '/tmp/cap.png',
    viewport: '1440x900',
    theme: 'light',
    fixture: 'synthetic',
    regions: [region],
    exclusions: [],
    structural: [],
  };
  const parsed: Pairing[] = parseConfig(JSON.stringify({ pairings: [pairing] }));
  const report: ParityReport = await buildReport(parsed, {
    tolerance: DEFAULT_TOLERANCE,
    equivalentThreshold: DEFAULT_EQUIVALENT_THRESHOLD,
  });
  const md: string = renderMarkdown(report);
  const img = await decodePng('/tmp/ref.png');
  const norm = normalizeToReference(img, img);
  const score: RegionScore = diffRegion(img, img, region, [], 16);
  const { scores, overallDiffFraction } = scoreRegions(img, img, [region], [], 16, 0.05);
  void md;
  void norm;
  void score;
  void scores;
  void overallDiffFraction;
  void INTERPRETATION;
}

void exercise;
