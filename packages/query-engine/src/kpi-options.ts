export interface KpiOptions {
  sparkline?: { visibility: 'VISIBLE' | 'HIDDEN'; type: 'LINE' | 'AREA' };
  comparison?: { comparisonMethod: 'DIFFERENCE' | 'PERCENT_DIFFERENCE' };
  primaryValueDisplayType?: 'ACTUAL' | 'COMPARISON';
  progressBar?: { visibility: 'VISIBLE' | 'HIDDEN' };
  trendArrows?: { visibility: 'VISIBLE' | 'HIDDEN' };
}

/** Shared fail-closed subset for compiler and native query planning. */
export function parseKpiOptions(value: unknown, native: boolean, path: string, fail: (path: string, message: string) => never): KpiOptions {
  const key = (name: string): string => native ? name[0]!.toUpperCase() + name.slice(1) : name;
  const object = (value: unknown, names: string[], at: string): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(at, 'expected an object');
    const o = value as Record<string, unknown>;
    for (const name of Object.keys(o)) if (!names.map(key).includes(name)) fail(`${at}.${name}`, 'unsupported property');
    return o;
  };
  const oneOf = <T extends string>(value: unknown, choices: readonly T[], fallback: T, at: string): T => {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !choices.includes(value as T)) return fail(at, `expected ${choices.join(', ')}`);
    return value as T;
  };
  const raw = object(value, ['sparkline', 'comparison', 'primaryValueDisplayType', 'progressBar', 'trendArrows'], path);
  const result: KpiOptions = {};
  for (const name of ['sparkline', 'progressBar', 'trendArrows'] as const) {
    if (raw[key(name)] === undefined) continue;
    const at = `${path}.${key(name)}`, o = object(raw[key(name)], name === 'sparkline' ? ['visibility', 'type'] : ['visibility'], at);
    const visibility = oneOf(o[key('visibility')], ['VISIBLE', 'HIDDEN'], 'VISIBLE', `${at}.${key('visibility')}`);
    if (name === 'sparkline') result.sparkline = { visibility, type: oneOf(o[key('type')], ['LINE', 'AREA'], 'LINE', `${at}.${key('type')}`) };
    else result[name] = { visibility };
  }
  if (raw[key('comparison')] !== undefined) {
    const at = `${path}.${key('comparison')}`, o = object(raw[key('comparison')], ['comparisonMethod'], at);
    if (o[key('comparisonMethod')] === undefined) fail(at, 'comparisonMethod is required');
    result.comparison = { comparisonMethod: oneOf(o[key('comparisonMethod')], ['DIFFERENCE', 'PERCENT_DIFFERENCE'], 'DIFFERENCE', at) };
  }
  if (raw[key('primaryValueDisplayType')] !== undefined) result.primaryValueDisplayType = oneOf(raw[key('primaryValueDisplayType')], ['ACTUAL', 'COMPARISON'] as const, 'ACTUAL', path);
  return result;
}
