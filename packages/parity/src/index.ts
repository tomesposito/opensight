export { buildReport, parseConfig, renderMarkdown, runPairing, DEFAULT_TOLERANCE, DEFAULT_EQUIVALENT_THRESHOLD, INTERPRETATION } from './report.js';
export { decodePng, normalizeToReference, fracToPixels } from './image.js';
export { diffRegion, scoreRegions } from './diff.js';
export { ParityError, ERR } from './types.js';
export type {
  FracRect, Region, NamedExclusion, StructuralItem, Pairing,
  RegionScore, PairingResult, TopGap, ParityReport,
} from './types.js';
