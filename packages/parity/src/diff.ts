import { fracToPixels, type RgbaImage } from './image.js';
import { ParityError, ERR, type FracRect, type Region, type NamedExclusion, type RegionScore } from './types.js';

/**
 * Per-region pixel diff. A pixel differs when any RGB channel differs by
 * more than `tolerance` (absorbs JPEG artifacts and antialiasing).
 * Pixels inside any named exclusion are skipped and counted separately.
 * Alpha is ignored: captures are opaque screenshots.
 */
export function diffRegion(
  ref: RgbaImage,
  cap: RgbaImage,
  region: Region,
  exclusions: NamedExclusion[],
  tolerance: number,
): RegionScore {
  if (ref.w !== cap.w || ref.h !== cap.h) {
    throw new ParityError(ERR.INVALID_IMAGE, 'reference and capture must share a canvas; normalize first');
  }
  const r = fracToPixels(region.rect, ref.w, ref.h);
  if (r.x1 <= r.x0 || r.y1 <= r.y0) {
    throw new ParityError(ERR.EMPTY_REGION, `region "${region.name}" is empty after clamping`);
  }
  const excl = exclusions.map((e) => ({ e, p: fracToPixels(e.rect, ref.w, ref.h) }));
  const inExclusion = (x: number, y: number): boolean =>
    excl.some(({ p }) => x >= p.x0 && x < p.x1 && y >= p.y0 && y < p.y1);

  let pixels = 0;
  let diffPixels = 0;
  let excludedPixels = 0;
  for (let y = r.y0; y < r.y1; y++) {
    for (let x = r.x0; x < r.x1; x++) {
      if (inExclusion(x, y)) {
        excludedPixels++;
        continue;
      }
      pixels++;
      const o = (y * ref.w + x) * 4;
      const dr = Math.abs(ref.data[o]! - cap.data[o]!);
      const dg = Math.abs(ref.data[o + 1]! - cap.data[o + 1]!);
      const db = Math.abs(ref.data[o + 2]! - cap.data[o + 2]!);
      if (Math.max(dr, dg, db) > tolerance) diffPixels++;
    }
  }
  if (pixels === 0) {
    throw new ParityError(ERR.EMPTY_REGION, `region "${region.name}" is fully excluded`);
  }
  return {
    name: region.name,
    description: region.description,
    pixels,
    diffPixels,
    diffFraction: diffPixels / pixels,
    excludedPixels,
    clamped: r.clamped,
    verdict: 'different', // verdict assigned by scoreRegions with the threshold
  };
}

/** Assign verdicts and compute the pairing-level weighted score. */
export function scoreRegions(
  ref: RgbaImage,
  cap: RgbaImage,
  regions: Region[],
  exclusions: NamedExclusion[],
  tolerance: number,
  equivalentThreshold: number,
): { scores: RegionScore[]; overallDiffFraction: number } {
  const scores = regions.map((region) => {
    const s = diffRegion(ref, cap, region, exclusions, tolerance);
    s.verdict = s.diffFraction < equivalentThreshold ? 'equivalent' : 'different';
    return s;
  });
  const totalPixels = scores.reduce((n, s) => n + s.pixels, 0);
  const totalDiff = scores.reduce((n, s) => n + s.diffPixels, 0);
  return { scores, overallDiffFraction: totalPixels === 0 ? 0 : totalDiff / totalPixels };
}

export type { FracRect };
