import type { ParameterBindings, ParameterDeclaration, ParameterValue } from './parameters.js';
import type { BoundColumn, Calculation, RowExpression, ScalarType, SqlDialect } from './types.js';
import { array, equals, fail, keys, object, quoteIdentifier, string, unique } from './validation.js';

interface Binding { scalarType: ScalarType; nullable: boolean }
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

/** Small precedence parser; function calls, division and non-row levels never become SQL. */
function parseExpression(source: string, path: string, binder: ExpressionBinder): RowExpression {
  if (source.length > 10000) fail('INVALID_INPUT', path, 'expression exceeds 10000 characters');
  let offset = 0;
  let depth = 0;
  const whitespace = () => { while (/\s/.test(source[offset] ?? '') && offset < source.length) offset++; };
  function expression(minimum: number): RowExpression {
    if (++depth > 100) fail('INVALID_INPUT', path, 'expression nesting exceeds 100');
    whitespace();
    const start = offset;
    let left: RowExpression;
    const location = (end: number) => ({ path, start, end });
    if (source[offset] === '(') {
      offset++;
      left = expression(0);
      whitespace();
      if (source[offset] !== ')') fail('INVALID_INPUT', path, `expected ')' at offset ${offset}`);
      offset++;
      left = { ...left, location: location(offset) };
    } else if (source.startsWith('${', offset)) {
      const end = source.indexOf('}', offset + 2), name = source.slice(offset + 2, end);
      const parameter = binder.parameters.find(p => p.name === name);
      if (end < 0 || !parameter) fail('UNRESOLVED_BINDING', path, `unknown parameter at offset ${offset}: ${name}`);
      const values = binder.values[name];
      if (parameter.multiple || values?.length !== 1) fail('TYPE_MISMATCH', path, `parameter ${name} requires exactly one scalar value in an expression`);
      offset = end + 1;
      left = { kind: 'parameter', name, value: values[0]!, scalarType: parameter.type, nullable: false, level: 'row', dependencies: [], location: location(offset) };
    } else if (source[offset] === '{') {
      const end = source.indexOf('}', offset + 1);
      if (end < 0) fail('INVALID_INPUT', path, `unclosed column reference at offset ${offset}`);
      const name = string(source.slice(offset + 1, end), path);
      offset = end + 1;
      const binding = binder.bind(name, path);
      left = { kind: 'column', dataSetIdentifier: binder.dataSetIdentifier, columnName: name,
        scalarType: binding.scalarType, nullable: binding.nullable,
        level: 'row', dependencies: [name], location: location(offset) };
    } else {
      const literal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(source.slice(offset));
      if (!literal) {
        if (/^[A-Za-z_$]/.test(source.slice(offset))) {
          fail('UNSUPPORTED_FEATURE', path, `functions, parameters and non-row evaluation are unsupported at offset ${offset}`);
        }
        fail('INVALID_INPUT', path, `expected a numeric literal or column reference at offset ${offset}`);
      }
      offset += literal[0].length;
      const value = Number(literal[0]);
      if (!Number.isFinite(value)) fail('INVALID_INPUT', path, 'numeric literal must be finite');
      left = { kind: 'literal', value, scalarType: 'number', nullable: false,
        level: 'row', dependencies: [], location: location(offset) };
    }
    while (true) {
      whitespace();
      const operator = source[offset];
      if (operator === '/') fail('UNSUPPORTED_FEATURE', path, `division is deferred pending source conformance at offset ${offset}`);
      if (operator !== '+' && operator !== '-' && operator !== '*') break;
      const precedence = operator === '*' ? 2 : 1;
      if (precedence < minimum) break;
      offset++;
      const right = expression(precedence + 1);
      if (left.scalarType !== 'number' || right.scalarType !== 'number') {
        fail('TYPE_MISMATCH', path, 'arithmetic requires numeric operands');
      }
      left = { kind: 'binary', operator, left, right, scalarType: 'number',
        nullable: left.nullable || right.nullable, level: 'row',
        dependencies: [...new Set([...left.dependencies, ...right.dependencies])], location: location(offset) };
    }
    depth--;
    return left;
  }
  const result = expression(0);
  whitespace();
  if (offset !== source.length) fail('INVALID_INPUT', path, `unexpected token at offset ${offset}`);
  return result;
}

export function expressionSql(expression: RowExpression, dialect: SqlDialect = 'duckdb', bind?: (value: ParameterValue) => string): string {
  const numericType = dialect === 'postgres' ? 'DOUBLE PRECISION' : 'DOUBLE';
  switch (expression.kind) {
    case 'parameter': {
      if (!bind) fail('INVALID_INPUT', expression.location.path, 'parameter SQL requires a binder');
      return `CAST(${bind(expression.value)} AS ${expression.scalarType === 'number' ? numericType : expression.scalarType === 'datetime' ? 'TIMESTAMP' : 'VARCHAR'})`;
    }
    case 'literal': return `CAST(${expression.value} AS ${numericType})`;
    case 'column': return quoteIdentifier(expression.columnName);
    // Arithmetic operates on double precision in this provisional slice; avoid integer overflow.
    case 'binary': return `(CAST(${expressionSql(expression.left, dialect, bind)} AS ${numericType}) ${expression.operator} CAST(${expressionSql(expression.right, dialect, bind)} AS ${numericType}))`;
  }
}
