import type { RowExpression, ScalarType } from './types.js';
import { fail } from './validation.js';

export interface FunctionReference {
  name: string; category: string; signature: string; example: string;
  min: number; max: number; result: ScalarType | 'first'; types?: readonly ScalarType[];
  stage?: 'aggregate' | 'table' | 'over';
}
const entry = (name: string, category: string, signature: string, example: string, min: number, max: number, result: FunctionReference['result'], types?: readonly ScalarType[], stage?: FunctionReference['stage']): FunctionReference => ({ name, category, signature: `${name}(${signature})`, example, min, max, result, types, stage });
export const functionCatalog: readonly FunctionReference[] = [
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
  return f;
}
