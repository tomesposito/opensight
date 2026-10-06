/**
 * Shared types for the parity measurement harness.
 *
 * All rectangles are fractions of the image they are defined against
 * (0..1), so a pairing stays valid if captures are re-taken at a
 * different pixel size but the same layout.
 */

export interface FracRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Region {
  /** Short stable id, e.g. "toolbar". */
  name: string;
  rect: FracRect;
  /** What this region holds in the QuickSight reference. */
  description: string;
}

export interface NamedExclusion {
  name: string;
  rect: FracRect;
  /** Why these pixels are not scored (e.g. reference letterboxing,
   *  browser chrome, or an intentional declared divergence). */
  reason: string;
}

export interface StructuralItem {
  /** Key element visible in the reference region(s). */
  item: string;
  /** Whether the current demo capture shows it. Recorded by hand at
   *  baseline time; the harness carries it, it does not compute it. */
  present: boolean;
  note: string;
}

export interface Pairing {
  id: string;
  title: string;
  /** Absolute path to the reference image (PNG). References live
   *  outside the repo; pixels are never committed. */
  reference: string;
  /** Absolute path to the demo capture (PNG). */
  capture: string;
  /** Capture conditions, for reproducibility. */
  viewport: string;
  theme: string;
  fixture: string;
  referenceNotes?: string;
  regions: Region[];
  exclusions: NamedExclusion[];
  structural: StructuralItem[];
}

export interface RegionScore {
  name: string;
  description: string;
  /** Pixels scored in this region (after exclusions). */
  pixels: number;
  diffPixels: number;
  diffFraction: number;
  excludedPixels: number;
  clamped: boolean;
  verdict: 'equivalent' | 'different';
}

export interface PairingResult {
  id: string;
  title: string;
  reference: string;
  capture: string;
  referenceSize: { w: number; h: number };
  captureSize: { w: number; h: number };
  normalizedTo: { w: number; h: number };
  /** Cover-fit scale applied to the capture before cropping. */
  scale: number;
  crop: { x: number; y: number };
  /** True when capture/reference aspect ratios differ by more than the
   *  protocol allows; region scores are then low-confidence. */
  aspectMismatch: boolean;
  regions: RegionScore[];
  /** Mean diff fraction weighted by scored region pixels. */
  overallDiffFraction: number;
  structural: StructuralItem[];
}

export interface TopGap {
  pairing: string;
  region: string;
  description: string;
  diffFraction: number;
}

export interface ParityReport {
  tool: string;
  generatedAt: string;
  tolerance: number;
  equivalentThreshold: number;
  /** Interpretation rule — see docs/parity-measurement.md. */
  interpretation: string;
  pairings: PairingResult[];
  topGaps: TopGap[];
}

/** Named error codes (fail-closed: a broken input stops the run). */
export const ERR = {
  READ_FAILED: 'PARITY_READ_FAILED',
  UNSUPPORTED_FORMAT: 'PARITY_UNSUPPORTED_FORMAT',
  DECODE_FAILED: 'PARITY_DECODE_FAILED',
  INVALID_IMAGE: 'PARITY_INVALID_IMAGE',
  EMPTY_REGION: 'PARITY_EMPTY_REGION',
  CONFIG_INVALID: 'PARITY_CONFIG_INVALID',
} as const;

export class ParityError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
    this.name = 'ParityError';
  }
}
