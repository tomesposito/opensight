import type { RowExpression, ScalarType } from './types.js';
import { constant, dateUnits, formatParts } from './datetime.js';
import { fail } from './validation.js';

export interface FunctionReference {
  name: string; category: string; signature: string; example: string;
  min: number; max: number; result: ScalarType | 'first'; types?: readonly ScalarType[];
  stage?: 'aggregate' | 'table' | 'over';
}
const entry = (name: string, category: string, signature: string, example: string, min: number, max: number, result: FunctionReference['result'], types?: readonly ScalarType[], stage?: FunctionReference['stage']): FunctionReference => ({ name, category, signature: `${name}(${signature})`, example, min, max, result, types, stage });
export const functionCatalog: readonly FunctionReference[] = [
  ...['sumOver', 'avgOver', 'countOver', 'minOver', 'maxOver'].map(n => entry(n, 'Level-aware aggregation', 'measure, [partition fields] [, PRE_FILTER|PRE_AGG|POST_AGG_FILTER]', `${n}({revenue}, [{region}], PRE_AGG)`, 2, 3, n === 'minOver' || n === 'maxOver' ? 'first' : 'number', undefined, 'over')),
  entry('runningSum', 'Table calculation', 'measure, [sort ASC|DESC, ...] [, partition fields]', 'runningSum(sum({revenue}), [{order_date} ASC], [{region}])', 2, 3, 'number', undefined, 'table'),
  ...['periodOverPeriodDifference', 'periodOverPeriodPercentDifference'].map(n => entry(n, 'Table calculation', 'measure, date [, period, offset]', `${n}(sum({revenue}), {order_date}, MONTH, 1)`, 2, 4, 'number', undefined, 'table')),
  entry('percentOfTotal', 'Table calculation', 'measure [, partition fields]', 'percentOfTotal(sum({revenue}), [{region}])', 1, 2, 'number', undefined, 'table'),
  ...['difference', 'percentDifference'].map(n => entry(n, 'Table calculation', 'measure, [sort ASC|DESC, ...] [, lookup_index, partition fields]', `${n}(sum({revenue}), [{order_date} ASC], -1, [{region}])`, 2, 4, 'number', undefined, 'table')),
  ...['rank', 'denseRank'].map(n => entry(n, 'Table calculation', '[sort ASC|DESC, ...] [, partition fields, calculation level]', `${n}([sum({revenue}) DESC], [{region}])`, 1, 3, 'number', undefined, 'table')),
  ...['sum', 'avg', 'median', 'stdev', 'stdevp', 'var', 'varp'].map(n => entry(n, 'Aggregation', 'measure', `${n}({revenue})`, 1, 1, 'number', ['number'], 'aggregate')),
  ...['count', 'distinct_count', 'min', 'max'].map(n => entry(n, 'Aggregation', 'expression', `${n}({revenue})`, 1, 1, n === 'min' || n === 'max' ? 'first' : 'number', undefined, 'aggregate')),
  entry('percentile', 'Aggregation', 'measure, percentile', 'percentile({revenue}, 90)', 2, 2, 'number', ['number'], 'aggregate'),
  entry('ifelse', 'Conditional', 'condition, then [, condition, then ...], else', "ifelse({revenue} > 0, {profit} / {revenue}, 0)", 3, 99, 'first'),
  entry('coalesce', 'Conditional', 'expression1, expression2, ...', 'coalesce({profit}, 0)', 2, 99, 'first'),
  entry('nullIf', 'Conditional', 'expression1, expression2', 'nullIf({revenue}, 0)', 2, 2, 'first'),
  ...['isNull', 'isNotNull'].map(n => entry(n, 'Conditional', 'expression', `${n}({profit})`, 1, 1, 'boolean')),
  entry('addDateTime', 'Datetime', 'amount, period, datetime', "addDateTime(1, 'MM', {order_date})", 3, 3, 'datetime', ['number', 'string', 'datetime']),
  entry('dateDiff', 'Datetime', 'date1, date2 [, period]', "dateDiff({order_date}, now(), 'DD')", 2, 3, 'number', ['datetime', 'datetime', 'string']),
  entry('truncDate', 'Datetime', 'period, datetime', "truncDate('MM', {order_date})", 2, 2, 'datetime', ['string', 'datetime']),
  entry('extract', 'Datetime', 'period, datetime', "extract('YYYY', {order_date})", 2, 2, 'number', ['string', 'datetime']),
  entry('formatDate', 'Datetime', 'datetime [, format]', "formatDate({order_date}, 'yyyy-MM-dd')", 1, 2, 'string', ['datetime', 'string']),
  entry('now', 'Datetime', '', 'now()', 0, 0, 'datetime'),
  entry('parseDate', 'Conversion', 'string [, format]', "parseDate('2024-02-29', 'yyyy-MM-dd')", 1, 2, 'datetime', ['string']),
  ...['abs', 'ceil', 'floor', 'sqrt', 'exp', 'ln', 'decimalToInt'].map(n => entry(n, 'Numeric', 'number', `${n}({revenue})`, 1, 1, 'number', ['number'])),
  entry('round', 'Numeric', 'number [, decimal_places]', 'round({revenue}, 2)', 1, 2, 'number', ['number']),
  entry('power', 'Numeric', 'number, exponent', 'power({revenue}, 2)', 2, 2, 'number', ['number']),
  entry('log', 'Numeric', 'number [, base]', 'log(100, 10)', 1, 2, 'number', ['number']),
  entry('mod', 'Numeric', 'number, divisor', 'mod({revenue}, 10)', 2, 2, 'number', ['number']),
  entry('pi', 'Numeric', '', 'pi()', 0, 0, 'number'),
  entry('toDecimal', 'Conversion', 'integer', 'toDecimal({order_id})', 1, 1, 'number', ['number']),
  ...['parseDecimal', 'parseInt'].map(n => entry(n, 'Conversion', 'string', `${n}('12.50')`, 1, 1, 'number', ['string'])),
  entry('concat', 'String', 'string1, string2, ...', "concat({region}, ' / ', {category})", 2, 99, 'string', ['string']),
  entry('substring', 'String', 'string, start, length', 'substring({region}, 1, 2)', 3, 3, 'string', ['string', 'number', 'number']),
  ...['left', 'right'].map(n => entry(n, 'String', 'string, length', `${n}({region}, 2)`, 2, 2, 'string', ['string', 'number'])),
  ...['trim', 'upper', 'lower'].map(n => entry(n, 'String', 'string', `${n}({region})`, 1, 1, 'string', ['string'])),
  entry('replace', 'String', 'string, substring, replacement', "replace({region}, 'East', 'E')", 3, 3, 'string', ['string']),
  entry('locate', 'String', 'string, substring [, start]', "locate({region}, 'a', 1)", 2, 3, 'number', ['string', 'string', 'number']),
  entry('strlen', 'String', 'string', 'strlen({region})', 1, 1, 'number', ['string']),
  entry('toString', 'Conversion', 'expression', 'toString({revenue})', 1, 1, 'string'),
];
export const functionReference = (name: string): FunctionReference | undefined => functionCatalog.find(f => f.name.toLowerCase() === name.toLowerCase());
export function functionError(f: FunctionReference, path: string, reason: string): never {
  return fail('TYPE_MISMATCH', path, `${f.name}: ${reason}. Expected ${f.signature}.`);
}
export function validateCall(name: string, args: readonly RowExpression[], path: string): FunctionReference {
  const f = functionReference(name);
  if (!f) fail('UNSUPPORTED_FEATURE', path, `Unsupported function ${name}.`);
  if (args.length < f.min || args.length > f.max) functionError(f, path, 'incorrect number of arguments');
  if (f.types) args.forEach((a, i) => {
    const expected = f.types![Math.min(i, f.types!.length - 1)]!;
    if (a.scalarType !== 'unknown' && a.scalarType !== expected && !(a.kind === 'literal' && a.value === null)) functionError(f, path, `argument ${i + 1} must be ${expected}`);
  });
  if (f.name === 'ifelse' && args.length % 2 !== 1) functionError(f, path, 'conditions and results must be followed by one else result');
  if (f.name === 'ifelse') args.slice(0, -1).forEach((arg, i) => { if (i % 2 === 0 && !['boolean', 'unknown'].includes(arg.scalarType)) functionError(f, path, `argument ${i + 1} must be a condition`); });
  if (['ifelse', 'coalesce', 'nullIf'].includes(f.name)) {
    const results = f.name === 'ifelse' ? args.filter((_, i) => i % 2 === 1 || i === args.length - 1) : args;
    const types = new Set(results.map(a => a.scalarType).filter(t => t !== 'unknown'));
    if (types.size > 1) functionError(f, path, 'result arguments must have compatible types');
  }
  if (f.stage === 'aggregate' && args.some(a => a.level === 'aggregate' || a.level === 'table')) functionError(f, path, 'nested aggregation is not allowed');
  if (f.name === 'percentile' && (args[1]?.kind !== 'literal' || typeof args[1].value !== 'number' || args[1].value < 0 || args[1].value > 100)) functionError(f, path, 'percentile must be a constant from 0 to 100');
  if (f.stage === 'table') {
    const ranked = ['rank', 'denseRank'].includes(f.name), period = f.name.startsWith('periodOverPeriod');
    if (!ranked && !['aggregate', 'table'].includes(args[0]!.level) && args[0]!.scalarType !== 'unknown') functionError(f, path, 'measure must be aggregated');
    if (!ranked && !['number', 'unknown'].includes(args[0]!.scalarType)) functionError(f, path, 'measure must be numeric');
    const listIndexes = ranked ? [0, 1] : period ? [] : f.name === 'percentOfTotal' ? [1] : f.name === 'runningSum' ? [1, 2] : [1, 3];
    for (const i of listIndexes) if (args[i] && args[i]!.kind !== 'list') functionError(f, path, `argument ${i + 1} must be a field list`);
    const sortIndex = ranked ? 0 : !period && f.name !== 'percentOfTotal' ? 1 : -1;
    if (sortIndex >= 0 && args[sortIndex]?.kind === 'list' && !args[sortIndex].items.length) functionError(f, path, 'sort list cannot be empty');
    if (period) {
      if (!['datetime', 'unknown'].includes(args[1]!.scalarType)) functionError(f, path, 'date must be a datetime field');
      if (args[2] && !(constant(args[2]).toUpperCase() in periodUnits)) functionError(f, path, 'invalid period');
    }
    const index = period ? 3 : ['difference', 'percentDifference'].includes(f.name) ? 2 : -1;
    if (index >= 0 && args[index] && !integerConstant(args[index]!)) functionError(f, path, 'offset must be a constant integer');
    if (ranked && args[2] && !['PRE_FILTER', 'PRE_AGG', 'POST_AGG_FILTER'].includes(constant(args[2]))) functionError(f, path, 'invalid calculation level');
    if (ranked && args[2] && constant(args[2]) !== 'POST_AGG_FILTER' && ['aggregate', 'table'].includes(args[0]!.level)) functionError(f, path, 'sort expressions must be unaggregated at PRE_FILTER and PRE_AGG');
  }
  if (f.stage === 'over') {
    if (args[1]!.kind !== 'list' || args[1]!.items.some(a => a.kind === 'sort' || a.level === 'aggregate' || a.level === 'table')) functionError(f, path, 'partition must be a list of unaggregated fields');
    const level = constant(args[2], 'POST_AGG_FILTER');
    if (!['PRE_FILTER', 'PRE_AGG', 'POST_AGG_FILTER'].includes(level)) functionError(f, path, 'invalid calculation level');
    if (level === 'POST_AGG_FILTER' && !['aggregate', 'table'].includes(args[0]!.level) && args[0]!.scalarType !== 'unknown') functionError(f, path, 'POST_AGG_FILTER requires an aggregated measure');
    if (level !== 'POST_AGG_FILTER' && ['aggregate', 'table'].includes(args[0]!.level)) functionError(f, path, `${level} requires an unaggregated measure`);
    if (level === 'PRE_FILTER' && args.some(a => a.level === 'pre_agg')) functionError(f, path, 'PRE_FILTER cannot depend on PRE_AGG');
    if (['sumOver', 'avgOver'].includes(f.name) && !['number', 'unknown'].includes(args[0]!.scalarType)) functionError(f, path, 'measure must be numeric');
  }
  const periodIndex = f.name === 'addDateTime' ? 1 : f.name === 'dateDiff' ? 2 : ['truncDate', 'extract'].includes(f.name) ? 0 : -1;
  if (periodIndex >= 0 && args[periodIndex]) {
    const period = constant(args[periodIndex]).toUpperCase();
    if (!(period in dateUnits) && !(f.name === 'extract' && period === 'WD') || f.name === 'extract' && period === 'WK') functionError(f, path, 'invalid period');
  }
  if (['formatDate', 'parseDate'].includes(f.name) && args[1]) {
    if (args[1].kind !== 'literal' || typeof args[1].value !== 'string') functionError(f, path, 'format must be a string literal');
    try { formatParts(args[1].value); } catch (e) { functionError(f, path, e instanceof Error ? e.message : String(e)); }
  }
  return f;
}

export const periodUnits: Record<string, string> = { ...dateUnits, YEAR: 'year', QUARTER: 'quarter', MONTH: 'month', WEEK: 'week', DAY: 'day', HOUR: 'hour', MINUTE: 'minute', SECOND: 'second', MILLISECOND: 'millisecond' };
export const integerConstant = (e: RowExpression): boolean => e.kind === 'literal' && typeof e.value === 'number' && Number.isInteger(e.value) || e.kind === 'unary' && e.operator !== 'NOT' && integerConstant(e.operand);
