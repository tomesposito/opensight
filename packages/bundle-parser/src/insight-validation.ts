import { array, fail, nonempty, object, optional, required, string } from './validation.js';

/** Forecast properties use the same ranges and defaults as chart forecasting. */
function validateForecast(value: unknown, path: string, key: (name: string) => string): void {
  const invalid = (p: string, message: string): never => fail(p, `INSIGHT_COMPUTATION_INVALID: ${message}`);
  const forecastObject = (raw: unknown, p: string): Record<string, unknown> => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid(p, 'expected an object');
    return raw as Record<string, unknown>;
  };
  const allowed = (raw: Record<string, unknown>, names: string[], p: string) => {
    for (const name of Object.keys(raw)) if (!names.map(key).includes(name)) fail(`${p}.${name}`, 'INSIGHT_CONFIGURATION_UNSUPPORTED: unsupported forecast property');
  };
  const body = forecastObject(value, path);
  allowed(body, ['computationId', 'name', 'time', 'value', 'forecastProperties'], path);
  const id = body[key('computationId')];
  if (typeof id !== 'string' || !/^[\w-]{1,512}$/.test(id)) invalid(`${path}.${key('computationId')}`, 'a computationId is required');
  if (body[key('name')] !== undefined && typeof body[key('name')] !== 'string') invalid(`${path}.${key('name')}`, 'name must be a string');
  const properties = body[key('forecastProperties')];
  if (properties === undefined) return;
  const p = `${path}.${key('forecastProperties')}`, raw = forecastObject(properties, p);
  allowed(raw, ['periodsForward', 'periodsBackward', 'predictionInterval', 'seasonality', 'customSeasonalityValue', 'lowerBoundary', 'upperBoundary'], p);
  for (const name of ['periodsForward', 'periodsBackward']) {
    const n = raw[key(name)];
    if (n !== undefined && (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 100)) invalid(`${p}.${key(name)}`, 'expected an integer between 0 and 100');
  }
  const interval = raw[key('predictionInterval')];
  if (interval !== undefined && ![80, 90, 95].includes(interval as number)) invalid(`${p}.${key('predictionInterval')}`, 'prediction interval must be 80, 90 or 95');
  const seasonality = raw[key('seasonality')] === undefined ? 'AUTOMATIC' : raw[key('seasonality')];
  if (!['AUTOMATIC', 'NONE', 'CUSTOM'].includes(seasonality as string)) invalid(`${p}.${key('seasonality')}`, 'invalid forecast seasonality');
  const custom = raw[key('customSeasonalityValue')];
  if (seasonality === 'CUSTOM' && (typeof custom !== 'number' || !Number.isInteger(custom) || custom < 2 || custom > 366)) invalid(`${p}.${key('customSeasonalityValue')}`, 'a custom seasonality period between 2 and 366 is required');
  for (const name of ['lowerBoundary', 'upperBoundary']) {
    const n = raw[key(name)];
    if (n !== undefined && (typeof n !== 'number' || !Number.isFinite(n))) invalid(`${p}.${key(name)}`, 'expected a finite number');
  }
  const lower = raw[key('lowerBoundary')], upper = raw[key('upperBoundary')];
  if (typeof lower === 'number' && typeof upper === 'number' && lower > upper) invalid(p, 'lower boundary must not exceed upper boundary');
}

function validatePeriodToDate(value: unknown, path: string, key: (name: string) => string): void {
  const invalid = (p: string, message: string): never => fail(p, `INSIGHT_COMPUTATION_INVALID: ${message}`);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid(path, 'expected an object');
  const body = value as Record<string, unknown>;
  const allowed = ['computationId', 'name', 'time', 'value', 'periodTimeGranularity'].map(key);
  for (const name of Object.keys(body)) if (!allowed.includes(name)) fail(`${path}.${name}`, 'INSIGHT_CONFIGURATION_UNSUPPORTED: unsupported periodToDate property');
  const id = body[key('computationId')];
  if (typeof id !== 'string' || !/^[\w-]{1,512}$/.test(id)) invalid(`${path}.${key('computationId')}`, 'a computationId is required');
  if (body[key('name')] !== undefined && typeof body[key('name')] !== 'string') invalid(`${path}.${key('name')}`, 'name must be a string');
  const grain = body[key('periodTimeGranularity')];
  if (grain !== undefined && !['DAY', 'MONTH', 'QUARTER', 'YEAR'].includes(grain as string)) invalid(`${path}.${key('periodTimeGranularity')}`, 'periodTimeGranularity must be DAY, MONTH, QUARTER or YEAR');
}

function validateUniqueValues(value: unknown, path: string, key: (name: string) => string): void {
  const invalid = (p: string, message: string): never => fail(p, `INSIGHT_COMPUTATION_INVALID: ${message}`);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid(path, 'expected an object');
  const body = value as Record<string, unknown>;
  const allowed = ['computationId', 'name', 'category'].map(key);
  for (const name of Object.keys(body)) if (!allowed.includes(name)) fail(`${path}.${name}`, 'INSIGHT_CONFIGURATION_UNSUPPORTED: unsupported uniqueValues property');
  const id = body[key('computationId')];
  if (typeof id !== 'string' || !/^[\w-]{1,512}$/.test(id)) invalid(`${path}.${key('computationId')}`, 'a computationId is required');
  if (body[key('name')] !== undefined && typeof body[key('name')] !== 'string') invalid(`${path}.${key('name')}`, 'name must be a string');
}

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
    if (kind === key('forecast')) { validateForecast(raw, `${p}.${kind}`, key); return; }
    if (kind === key('periodToDate')) { validatePeriodToDate(raw, `${p}.${kind}`, key); return; }
    if (kind === key('uniqueValues')) { validateUniqueValues(raw, `${p}.${kind}`, key); return; }
    const body = object(raw, `${p}.${kind}`);
    required(body, key('computationId'), p, nonempty);
    optional(body, key('name'), p, string);
  }));
}
