import { array, fail, nonempty, object, optional, required, string } from './validation.js';

/** Inventory validation retains known unsupported variants for the import report. */
export function validateInsightConfiguration(value: unknown, path: string, api = false): void {
  const key = (name: string) => api ? name[0]!.toUpperCase() + name.slice(1) : name;
  const config = object(value, path);
  optional(config, key('customNarrative'), path, (value, p) => required(object(value, p), key('narrative'), p, string));
  optional(config, key('computations'), path, array((value, p) => {
    const entries = Object.entries(object(value, p));
    if (entries.length !== 1) fail(p, 'INSIGHT_COMPUTATION_INVALID: expected exactly one computation variant');
    const [kind, raw] = entries[0]!;
    if (/anomaly/i.test(kind)) fail(p, 'INSIGHT_ANOMALY_UNSUPPORTED: anomaly computations are not supported');
    const known = ['totalAggregation', 'maximumMinimum', 'topBottomRanked', 'growthRate', 'periodOverPeriod', 'metricComparison', 'forecast', 'periodToDate', 'topBottomMovers', 'uniqueValues'].map(key);
    if (!known.includes(kind)) fail(`${p}.${kind}`, 'INSIGHT_COMPUTATION_UNKNOWN: unknown computation type');
    const body = object(raw, `${p}.${kind}`);
    required(body, key('computationId'), p, nonempty);
    optional(body, key('name'), p, string);
  }));
}
