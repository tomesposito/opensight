import type { ResultValue } from './types.js';
/** QuickSight ignores nulls; percentile is the discrete (observed-value) percentile. */
export function aggregateValue(name: string, input: readonly ResultValue[], percentile = 50): ResultValue {
  const values = input.filter((v): v is string | number => v !== null);
  if (name === 'count') return values.length;
  if (name === 'distinct_count') return new Set(values).size;
  if (!values.length) return null;
  if (name === 'min' || name === 'max') return values.reduce((a, b) => name === 'min' ? a < b ? a : b : a > b ? a : b);
  const numbers = values.map(Number), n = numbers.length, sum = numbers.reduce((a, b) => a + b, 0);
  let result: number;
  if (name === 'sum') result = sum;
  else if (name === 'avg') result = sum / n;
  else if (name === 'median' || name === 'percentile') {
    numbers.sort((a, b) => a - b);
    result = name === 'percentile' ? numbers[Math.max(0, Math.ceil(n * percentile / 100) - 1)]! : (numbers[Math.floor((n - 1) / 2)]! + numbers[Math.floor(n / 2)]!) / 2;
  } else {
    const population = name === 'varp' || name === 'stdevp'; if (!population && n < 2) return null;
    const mean = sum / n, variance = numbers.reduce((total, v) => total + (v - mean) ** 2, 0) / (population ? n : n - 1);
    result = name === 'stdev' || name === 'stdevp' ? Math.sqrt(variance) : variance;
  }
  if (!Number.isFinite(result)) throw new Error('Nonfinite aggregate');
  return result;
}
