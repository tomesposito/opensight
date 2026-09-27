import type { ParameterBindings, ParameterDeclaration, ParameterValue } from './parameters.js';
import type { BoundColumn, Calculation, RowExpression, ScalarType, SqlDialect, ExpressionLevel } from './types.js';
import { array, equals, fail, keys, object, quoteIdentifier, string, unique } from './validation.js';

export interface Binding { scalarType: ScalarType; nullable: boolean; level?: ExpressionLevel }
interface Declaration { expression: string; path: string }

/** Resolve only reachable calculations; completed nodes are emitted in dependency order. */
export class ExpressionBinder {
  readonly calculations: Calculation[] = [];
  private readonly declarations = new Map<string, Declaration>();
  private readonly bindings = new Map<string, Binding>();
  private readonly visiting = new Set<string>();

  constructor(readonly dataSetIdentifier: string, columns: readonly BoundColumn[], raw: unknown, readonly parameters: readonly ParameterDeclaration[] = [], readonly values: ParameterBindings = {}) {
    const names = new Set<string>();
    for (const column of columns) {
      unique(names, column.name, '$.dataSet.DataSet.OutputColumns');
      this.bindings.set(column.name, column);
    }
    for (const [index, value] of array(raw === undefined ? [] : raw, '$.analysis.Definition.CalculatedFields').entries()) {
      const path = `$.analysis.Definition.CalculatedFields[${index}]`;
      const c = object(value, path);
      keys(c, ['Name', 'DataSetIdentifier', 'Expression'], path);
      equals(c.DataSetIdentifier, dataSetIdentifier, `${path}.DataSetIdentifier`);
      const name = string(c.Name, `${path}.Name`);
      unique(names, name, `${path}.Name`);
      this.declarations.set(name, { expression: string(c.Expression, `${path}.Expression`), path: `${path}.Expression` });
    }
  }

  bind(name: string, path: string): Binding {
    const ready = this.bindings.get(name);
    if (ready) return ready;
    const declaration = this.declarations.get(name);
    if (!declaration) fail('UNRESOLVED_BINDING', path, `unknown column: ${name}`);
    if (this.visiting.has(name)) fail('CALCULATION_CYCLE', path, `calculated-field cycle through ${name}`);
    if (this.visiting.size >= 100) fail('INVALID_INPUT', path, 'calculated-field dependency depth exceeds 100');
    this.visiting.add(name);
    const expression = parseExpression(declaration.expression, declaration.path, this);
    this.visiting.delete(name);
    this.bindings.set(name, expression);
    this.calculations.push({ name, expression });
    return expression;
  }
}

export interface ExpressionContext {
  dataSetIdentifier?: string;
  bind?: (name: string, path: string) => Binding;
  parameters?: readonly ParameterDeclaration[];
  values?: ParameterBindings;
}
const levels: ExpressionLevel[] = ['row', 'pre_filter', 'pre_agg', 'aggregate', 'table'];
export const expressionLevel = (args: readonly RowExpression[]): ExpressionLevel => levels[Math.max(0, ...args.map(a => levels.indexOf(a.level)))]!;
export function parseExpression(source: string, path = '$.expression', context: ExpressionContext = {}): RowExpression {
  if (source.length > 10000) fail('INVALID_INPUT', path, 'expression exceeds 10000 characters');
  let offset = 0, depth = 0;
  const whitespace = () => { while (offset < source.length && /\s/.test(source[offset]!)) offset++; };
  const info = (start: number, scalarType: ScalarType, args: readonly RowExpression[] = []) => ({ scalarType, nullable: true, level: expressionLevel(args), dependencies: [...new Set(args.flatMap(a => a.dependencies))], location: { path, start, end: offset } });
  const expect = (token: string) => { whitespace(); if (!source.startsWith(token, offset)) fail('INVALID_INPUT', path, `expected '${token}' at offset ${offset}`); offset += token.length; };
  function expression(minimum = 0): RowExpression {
    if (++depth > 100) fail('INVALID_INPUT', path, 'expression nesting exceeds 100');
    whitespace(); const start = offset;
    let left: RowExpression;
    if (source[offset] === '(') {
      offset++; left = expression(); expect(')'); left = { ...left, location: { path, start, end: offset } };
    } else if (source.startsWith('${', offset)) {
      const end = source.indexOf('}', offset + 2), name = source.slice(offset + 2, end);
      if (end < 0 || !name) fail('INVALID_INPUT', path, `unclosed parameter at offset ${offset}`);
      const parameter = context.parameters?.find(p => p.name === name), values = context.values?.[name];
      if (context.bind && !parameter) fail('UNRESOLVED_BINDING', path, `unknown parameter: ${name}`);
      if (parameter && (parameter.multiple || values?.length !== 1)) fail('TYPE_MISMATCH', path, `parameter ${name} requires exactly one scalar value in an expression`);
      offset = end + 1;
      left = { ...info(start, parameter?.type ?? 'unknown'), nullable: false, kind: 'parameter', name, value: values?.[0] ?? 0 };
    } else if (source[offset] === '{') {
      const end = source.indexOf('}', offset + 1);
      if (end < 0) fail('INVALID_INPUT', path, `unclosed column reference at offset ${offset}`);
      const name = string(source.slice(offset + 1, end), path); offset = end + 1;
      const binding = context.bind?.(name, path) ?? { scalarType: 'unknown' as const, nullable: true };
      left = { ...info(start, binding.scalarType), ...binding, kind: 'column', dataSetIdentifier: context.dataSetIdentifier ?? '', columnName: name, dependencies: [name] };
    } else if (source[offset] === '[') {
      offset++; const items: RowExpression[] = []; whitespace();
      if (source[offset] !== ']') do {
        let item = expression(); whitespace(); const sort = /^(ASC|DESC)\b/i.exec(source.slice(offset));
        if (sort) { offset += sort[0].length; item = { ...info(start, item.scalarType, [item]), kind: 'sort', expression: item, direction: sort[0].toUpperCase() as 'ASC' | 'DESC' }; }
        items.push(item); whitespace(); if (source[offset] !== ',') break; offset++;
      } while (true);
      expect(']'); left = { ...info(start, 'unknown', items), kind: 'list', items };
    } else if (source[offset] === "'" || source[offset] === '"') {
      const quote = source[offset++]!; let value = '', closed = false;
      while (offset < source.length) {
        const c = source[offset++]!;
        if (c === quote) { if (source[offset] === quote) { value += quote; offset++; } else { closed = true; break; } }
        else if (c === '\\' && (source[offset] === quote || source[offset] === '\\')) value += source[offset++]!;
        else value += c;
      }
      if (!closed || value.includes('\0')) fail('INVALID_INPUT', path, 'invalid string literal');
      left = { ...info(start, 'string'), nullable: false, kind: 'literal', value };
    } else if (source[offset] === '-' || source[offset] === '+' || /^NOT\b/i.test(source.slice(offset))) {
      const operator = /^NOT\b/i.test(source.slice(offset)) ? 'NOT' : source[offset] as '-' | '+';
      offset += operator.length; const operand = expression(operator === 'NOT' ? 3 : 7);
      left = { ...info(start, operator === 'NOT' ? 'boolean' : 'number', [operand]), kind: 'unary', operator, operand };
    } else {
      const numeric = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(source.slice(offset));
      if (numeric) {
        offset += numeric[0].length; const value = Number(numeric[0]);
        if (!Number.isFinite(value)) fail('INVALID_INPUT', path, 'numeric literal must be finite');
        left = { ...info(start, 'number'), nullable: false, kind: 'literal', value };
      } else {
        const word = /^[A-Za-z_][A-Za-z_0-9]*/.exec(source.slice(offset));
        if (!word) fail('INVALID_INPUT', path, `expected an expression at offset ${offset}`);
        const name = word[0]; offset += name.length; whitespace();
        if (source[offset] === '(') {
          offset++; const args: RowExpression[] = []; whitespace();
          if (source[offset] !== ')') do { args.push(expression()); whitespace(); if (source[offset] !== ',') break; offset++; } while (true);
          expect(')'); const f = validateCall(name, args, path);
          left = { ...info(start, f.result === 'first' ? args[0]!.scalarType : f.result, args), kind: 'call', name: f.name, args };
        } else if (/^(null|true|false)$/i.test(name)) {
          left = { ...info(start, /^null$/i.test(name) ? 'unknown' : 'boolean'), kind: 'literal', value: /^null$/i.test(name) ? null : /^true$/i.test(name) ? 1 : 0 };
        } else left = { ...info(start, 'string'), kind: 'symbol', value: name.toUpperCase() };
      }
    }
    while (true) {
      whitespace(); const match = /^(<>|!=|<=|>=|==|[+*\/=<>-]|AND\b|OR\b)/i.exec(source.slice(offset));
      if (!match) break;
      const raw = match[0].toUpperCase(), operator = (raw === '==' ? '=' : raw === '!=' ? '<>' : raw) as Extract<RowExpression, {kind: 'binary'}>['operator'];
      const precedence = operator === 'OR' ? 1 : operator === 'AND' ? 2 : ['=', '<>', '<', '>', '<=', '>='].includes(operator) ? 3 : ['+', '-'].includes(operator) ? 4 : 5;
      if (precedence < minimum) break;
      offset += raw.length; const right = expression(precedence + 1), arithmetic = precedence >= 4;
      if (arithmetic && [left, right].some(x => !['number', 'unknown'].includes(x.scalarType))) fail('TYPE_MISMATCH', path, 'arithmetic requires numeric operands');
      left = { ...info(start, arithmetic ? 'number' : 'boolean', [left, right]), nullable: left.nullable || right.nullable, kind: 'binary', operator, left, right };
    }
    depth--; return left;
  }
  const result = expression(); whitespace();
  if (offset !== source.length) fail('INVALID_INPUT', path, `unexpected token at offset ${offset}`);
  if (result.kind === 'symbol' || result.kind === 'list') fail('INVALID_INPUT', path, 'expected a scalar expression');
  return result;
}

export function expressionSql(expression: RowExpression, dialect: SqlDialect = 'duckdb', bind?: (value: ParameterValue) => string): string {
  const numericType = dialect === 'postgres' ? 'DOUBLE PRECISION' : 'DOUBLE';
  const compile = (e: RowExpression) => expressionSql(e, dialect, bind);
  switch (expression.kind) {
    case 'parameter': {
      if (!bind) fail('INVALID_INPUT', expression.location.path, 'parameter SQL requires a binder');
      return `CAST(${bind(expression.value)} AS ${expression.scalarType === 'number' ? numericType : expression.scalarType === 'datetime' ? 'TIMESTAMP' : 'VARCHAR'})`;
    }
    case 'literal': return expression.value === null ? 'NULL' : expression.scalarType === 'boolean' ? expression.value ? 'TRUE' : 'FALSE' : typeof expression.value === 'number' ? `CAST(${expression.value} AS ${numericType})` : `CAST(${bind ? bind(expression.value) : quoteLiteral(expression.value)} AS VARCHAR)`;
    case 'column': return quoteIdentifier(expression.columnName);
    case 'unary': return `(${expression.operator} ${compile(expression.operand)})`;
    case 'binary': {
      const a = compile(expression.left), b = compile(expression.right);
      if (['+', '-', '*', '/'].includes(expression.operator)) return `(CAST(${a} AS ${numericType}) ${expression.operator} ${expression.operator === '/' ? `NULLIF(CAST(${b} AS ${numericType}), 0)` : `CAST(${b} AS ${numericType})`})`;
      return `(${a} ${expression.operator} ${b})`;
    }
    case 'call': return scalarSql(expression, dialect, compile);
    default: return fail('INVALID_INPUT', expression.location.path, 'list or keyword outside function argument');
  }
}
import { validateCall } from './catalog.js';
import { scalarSql } from './scalar.js';
import { quoteLiteral } from './validation.js';
