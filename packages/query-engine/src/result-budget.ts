import { fail, QueryEngineError } from './validation.js';

export interface ResultBudgetOptions {
  /** May only lower the hard 100,000-row result cap. Breaches fail, never truncate. */
  maxRows?: number;
  /** May only lower the hard 64 MiB cumulative raw-value cap. */
  maxBytes?: number;
  /** May only lower the hard 16 KiB per-cell raw-value cap. */
  maxCellBytes?: number;
}
function limit(value: number | undefined, maximum: number, path: string): number {
  if (value === undefined) return maximum;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) fail('INVALID_INPUT', path, 'Expected a positive integer within the execution limit');
  return value;
}
/** Validate before connecting; charge each raw row before conversion or retention. */
export function resultBudget(options: ResultBudgetOptions, engine: 'redshift' | 'mysql'): (row: readonly unknown[]) => void {
  const maxRows = limit(options.maxRows, 100_000, '$.options.maxRows');
  const maxBytes = limit(options.maxBytes, 64 * 1024 * 1024, '$.options.maxBytes');
  // BLAZE defaults to 16,384 characters. Using the same magnitude in UTF-8 bytes
  // is conservative for multibyte text and bounds a single library result cell.
  const maxCellBytes = limit(options.maxCellBytes, 16 * 1024, '$.options.maxCellBytes');
  let rows = 0, bytes = 0;
  const exceeded = (kind: string): never => { throw new QueryEngineError('EXECUTION_ERROR', `$.${engine}`, `${engine === 'redshift' ? 'Redshift' : 'MySQL'} result ${kind} limit exceeded`); };
  return raw => {
    if (++rows > maxRows) exceeded('row');
    for (const cell of raw) {
      const size = Buffer.isBuffer(cell) ? cell.byteLength : Buffer.byteLength(cell === null ? '' : String(cell), 'utf8');
      if (size > maxCellBytes) exceeded('cell byte');
      bytes += size;
      if (bytes > maxBytes) exceeded('byte');
    }
  };
}
