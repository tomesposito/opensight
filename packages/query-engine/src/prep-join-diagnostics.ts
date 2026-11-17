import { prepFail } from '@opensight/bundle-parser/prep';

export const PREP_JOIN_SAMPLE_LIMIT = 10_000;
export const PREP_JOIN_EXECUTION_MS = 10_000;
export type PrepJoinRow = Record<string, string | number | boolean | null>;
export interface PrepJoinDiagnostics {
  basis: 'bounded-preview'; sampleLimit: number; timedOut: false;
  matchedRows: number; unmatchedLeft: number; unmatchedRight: number;
  fanOut: boolean; maxLeftMultiplicity: number; maxRightMultiplicity: number;
  leftRowsSampled: number; rightRowsSampled: number;
  leftTruncated: boolean; rightTruncated: boolean;
}
/** One monotonic deadline covers sampling, staging and counting. No partial result. */
export class PrepJoinBudget {
  private readonly deadline: number;
  constructor(private readonly clock: () => number = () => performance.now(), duration = PREP_JOIN_EXECUTION_MS) {
    this.deadline = clock() + Math.min(duration, PREP_JOIN_EXECUTION_MS);
  }
  remaining(): number {
    const remaining = Math.ceil(this.deadline - this.clock());
    if (remaining <= 0) prepFail('PREP_EXECUTION_FAILED', '$.joinDiagnostics', 'Join diagnostics exceeded the shared 10-second execution limit');
    return remaining;
  }
  check(): void { this.remaining(); }
}
/** Counts matches, independent of join type: unmatched outer rows are separate.
 * Callers supply normalized scalars from the validated, identically typed keys. */
export function prepJoinDiagnostics(left: readonly PrepJoinRow[], right: readonly PrepJoinRow[], keys: readonly { left: string; right: string }[],
  provenance: { leftTruncated?: boolean; rightTruncated?: boolean } = {}, check: () => void = () => {}): PrepJoinDiagnostics {
  if (!keys.length) prepFail('INVALID_PREP_PIPELINE', '$.keys', 'Join keys are required');
  const index = (rows: readonly PrepJoinRow[], side: 'left' | 'right') => {
    const counts = new Map<string, number>();
    for (const [i, row] of rows.slice(0, PREP_JOIN_SAMPLE_LIMIT).entries()) {
      if (i % 128 === 0) check();
      const values = keys.map(k => row[k[side]]);
      if (values.some(v => v === undefined || typeof v === 'number' && !Number.isFinite(v))) prepFail('PREP_EXECUTION_FAILED', '$.joinDiagnostics', 'Invalid sampled join key');
      if (values.includes(null)) continue;
      const key = JSON.stringify(values); counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  };
  const l = index(left, 'left'), r = index(right, 'right');
  const leftRowsSampled = Math.min(left.length, PREP_JOIN_SAMPLE_LIMIT), rightRowsSampled = Math.min(right.length, PREP_JOIN_SAMPLE_LIMIT);
  let matchedRows = 0, unmatchedLeft = leftRowsSampled, unmatchedRight = rightRowsSampled, maxLeftMultiplicity = 0, maxRightMultiplicity = 0;
  for (const [key, n] of l) {
    check(); const m = r.get(key); if (!m) continue;
    matchedRows += n * m; unmatchedLeft -= n; unmatchedRight -= m;
    maxLeftMultiplicity = Math.max(maxLeftMultiplicity, n); maxRightMultiplicity = Math.max(maxRightMultiplicity, m);
  }
  check();
  return { basis: 'bounded-preview', sampleLimit: PREP_JOIN_SAMPLE_LIMIT, timedOut: false,
    matchedRows, unmatchedLeft, unmatchedRight, fanOut: maxLeftMultiplicity > 1 || maxRightMultiplicity > 1,
    maxLeftMultiplicity, maxRightMultiplicity, leftRowsSampled, rightRowsSampled,
    leftTruncated: !!provenance.leftTruncated || left.length > PREP_JOIN_SAMPLE_LIMIT,
    rightTruncated: !!provenance.rightTruncated || right.length > PREP_JOIN_SAMPLE_LIMIT };
}
