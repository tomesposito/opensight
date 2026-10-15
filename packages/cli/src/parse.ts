import type { RequestOptions } from '@opensight/headless-sdk';
import { operations } from './generated.js';
import { invalid, record } from './errors.js';
import type { Format, Operation, Schema } from './types.js';

export interface Invocation {
  operation: Operation;
  path: Record<string, unknown>;
  options: RequestOptions;
  body: unknown;
  format: Format;
}
export type Parsed = Invocation | { help: string[] };

/** Validate only the frozen spec's input vocabulary; the API still owns domain validation. */
export function valid(value: unknown, schema: Schema): boolean {
  if (schema.oneOf && schema.oneOf.filter(s => valid(value, s)).length !== 1) return false;
  if (schema.anyOf && !schema.anyOf.some(s => valid(value, s))) return false;
  if (schema.allOf && !schema.allOf.every(s => valid(value, s))) return false;
  if (Object.hasOwn(schema, 'const') && JSON.stringify(value) !== JSON.stringify(schema.const)) return false;
  if (schema.enum && !schema.enum.some(v => JSON.stringify(v) === JSON.stringify(value))) return false;
  const matches = (type: string): boolean => type === 'null' ? value === null : type === 'array' ? Array.isArray(value)
    : type === 'object' ? record(value) : type === 'integer' ? Number.isSafeInteger(value)
      : type === 'number' ? typeof value === 'number' && Number.isFinite(value) : typeof value === type;
  if (schema.type && !(Array.isArray(schema.type) ? schema.type : [schema.type]).some(matches)) return false;
  if (typeof value === 'number' && (schema.minimum !== undefined && value < schema.minimum || schema.maximum !== undefined && value > schema.maximum)) return false;
  if (typeof value === 'string' && (schema.minLength !== undefined && [...value].length < schema.minLength
    || schema.maxLength !== undefined && [...value].length > schema.maxLength || schema.pattern && !new RegExp(schema.pattern).test(value))) return false;
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems || schema.maxItems !== undefined && value.length > schema.maxItems) return false;
    if (schema.uniqueItems && new Set(value.map(v => JSON.stringify(v))).size !== value.length) return false;
    if (schema.items && !value.every(v => valid(v, schema.items!))) return false;
  }
  if (record(value)) {
    const keys = Object.keys(value), props = schema.properties ?? {};
    if (schema.required?.some(k => !Object.hasOwn(value, k))) return false;
    if (schema.minProperties !== undefined && keys.length < schema.minProperties || schema.maxProperties !== undefined && keys.length > schema.maxProperties) return false;
    for (const key of keys) {
      if (Object.hasOwn(props, key)) { if (!valid(value[key], props[key]!)) return false; }
      else if (schema.additionalProperties === false || record(schema.additionalProperties) && !valid(value[key], schema.additionalProperties)) return false;
    }
  }
  return true;
}

function scalar(raw: string, schema: Schema, name: string): unknown {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  let value: unknown = raw;
  if (types.includes('null') && raw === 'null') value = null;
  else if (!types.includes('string') && !(schema.enum?.every(v => typeof v === 'string'))) {
    try { value = JSON.parse(raw); } catch { invalid(`--${name} requires a JSON value of the documented type.`); }
  }
  if (!valid(value, schema)) invalid(`Invalid value for ${name}; see command --help.`);
  return value;
}

export function parse(argv: string[]): Parsed {
  const words: string[] = [], flags = new Map<string, string>();
  let help = false, positionalOnly = false;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (!positionalOnly && token === '--') { positionalOnly = true; continue; }
    if (!positionalOnly && ['--help', '-h'].includes(token)) { help = true; continue; }
    if (!positionalOnly && token.startsWith('--')) {
      const equals = token.indexOf('='), key = token.slice(2, equals < 0 ? undefined : equals);
      if (flags.has(key)) invalid('Each flag may be supplied only once.');
      const value = equals < 0 ? argv[++i] : token.slice(equals + 1);
      if (value === undefined || equals < 0 && value.startsWith('--')) invalid('A flag is missing its value; use --flag=value for a value starting with --.');
      flags.set(key, value);
    } else if (!positionalOnly && token.startsWith('-')) invalid('Unknown short option; use --help.');
    else words.push(token);
  }
  const [noun, command, ...positionals] = words;
  if (noun && !operations.some(o => o.noun === noun)) invalid('Unknown resource; use opensight --help.');
  const op = operations.find(o => o.noun === noun && o.command === command);
  if (command && !op) invalid('Unknown command; use the resource --help.');
  const rawFormat = flags.get('format') ?? 'json';
  if (!['json', 'table', 'yaml'].includes(rawFormat)) invalid('--format must be json, table or yaml.');
  flags.delete('format');
  if (help || !noun || !command) {
    if (flags.size || positionals.length) invalid('Help accepts only a resource and command.');
    return { help: words };
  }
  if (!op) return invalid('Unknown command.');
  const positional = op.arguments.filter(a => a.positional);
  if (positionals.length > positional.length) invalid('Too many positional arguments; see command --help.');
  for (let i = 0; i < positionals.length; i++) {
    const name = positional[i]!.name;
    if (flags.has(name)) invalid(`Supply ${name} as either a positional argument or a flag, once.`);
    flags.set(name, positionals[i]!);
  }
  const allowed = new Set([...op.arguments.map(a => a.name), ...(op.body ? [op.body.input] : [])]);
  if ([...flags.keys()].some(k => !allowed.has(k))) invalid('Unknown flag; use command --help for accepted arguments.');
  const path: Record<string, unknown> = {}, options: RequestOptions = {}, bodyFields: Record<string, unknown> = {};
  for (const arg of op.arguments) {
    const raw = flags.get(arg.name);
    if (raw === undefined) {
      if (arg.required && arg.location !== 'body') invalid(`Missing required ${arg.positional ? `<${arg.name}>` : `--${arg.name}`}.`);
      continue;
    }
    const value = scalar(raw, arg.schema, arg.name);
    if (arg.location === 'path') {
      if (value === '.' || value === '..') invalid('Invalid path identifier.');
      path[arg.name] = value;
    } else if (arg.location === 'header') {
      if (/[\r\n\x00]/.test(String(value))) invalid('Invalid header argument.');
      Object.assign(options, { [arg.name]: value });
    } else Object.defineProperty(bodyFields, arg.wireName, { value, enumerable: true });
  }
  let body: unknown;
  if (op.body) {
    const whole = flags.get(op.body.input);
    if (whole !== undefined) {
      if (Object.keys(bodyFields).length) invalid(`Do not combine --${op.body.input} with individual body fields.`);
      try { body = JSON.parse(whole); } catch { invalid(`--${op.body.input} requires JSON.`); }
    } else if (Object.keys(bodyFields).length || op.body.schema.type === 'object') body = bodyFields;
    if (body === undefined && op.body.required) invalid(`Missing required --${op.body.input} JSON body.`);
    if (body !== undefined && !valid(body, op.body.schema)) invalid(`Request body does not match the operation schema; see command --help.`);
  }
  return { operation: op, path, options, body, format: rawFormat as Format };
}
