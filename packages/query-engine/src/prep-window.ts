import { prepFail, validatePrepWindowConfig, type PrepColumn, type PrepWindowConfig, type PrepWindowStructured, type PrepType } from '@opensight/bundle-parser/prep';
import { quoteIdentifier as q } from './validation.js';

/** A bounded, non-recursive grammar, used only by the prep Window step. No raw SQL is emitted. */
export function parsePrepWindow(expression: string, name: string, path: string): PrepWindowStructured {
  const fail = (): never => prepFail('UNSUPPORTED_PREP_STEP', path, 'Expected one supported window function with OVER (PARTITION BY / ORDER BY / ROWS); expressions, nested calls and other SQL are not supported');
  if (!expression.trim() || expression.length > 10000) fail();
  type Token = { kind: 'word' | 'identifier' | 'number' | 'symbol'; text: string };
  const tokens: Token[] = [];
  const pattern = /\s+|"(?:[^"]|"")*"|[A-Za-z_][A-Za-z_0-9]*|[0-9]+|[(),]/y;
  let pos = 0;
  while (pos < expression.length) {
    pattern.lastIndex = pos;
    const match = pattern.exec(expression);
    if (!match) return fail();
    const text = match[0]; pos = pattern.lastIndex;
    if (/^\s/.test(text)) continue;
    tokens.push({ kind: text.startsWith('"') ? 'identifier' : /^[A-Za-z_]/.test(text) ? 'word' : /^[0-9]/.test(text) ? 'number' : 'symbol', text });
    if (tokens.length > 4096) fail();
  }
  let index = 0;
  const take = (text: string): boolean => {
    const token = tokens[index];
    if (token && (token.kind === 'word' || token.kind === 'symbol') && token.text.toUpperCase() === text) { index++; return true; }
    return false;
  };
  const expect = (text: string): void => { if (!take(text)) fail(); };
  const identifier = (): string => {
    const token = tokens[index++];
    if (token?.kind === 'identifier') return token.text.slice(1, -1).replaceAll('""', '"');
    if (token?.kind === 'word') return token.text;
    return fail();
  };
  const integer = (): number => {
    const token = tokens[index++];
    if (token?.kind !== 'number') return fail();
    const value = Number(token.text);
    if (!Number.isInteger(value) || value > 2147483647) fail();
    return value;
  };
  const functionToken = tokens[index++];
  if (functionToken?.kind !== 'word') return fail();
  const fn = functionToken.text.toUpperCase();
  const functions = { ROW_NUMBER: 'rowNumber', RANK: 'rank', DENSE_RANK: 'denseRank', SUM: 'runningTotal', AVG: 'runningAverage', LAG: 'lag', LEAD: 'lead', NTILE: 'ntile' } as const;
  if (!Object.hasOwn(functions, fn)) return fail();
  const config: PrepWindowStructured = { name, function: functions[fn as keyof typeof functions], partitionBy: [], orderBy: [] };
  expect('(');
  if (fn === 'NTILE') config.buckets = integer();
  else if (['SUM', 'AVG', 'LAG', 'LEAD'].includes(fn)) {
    config.valueColumn = identifier();
    if ((fn === 'LAG' || fn === 'LEAD') && take(',')) config.offset = integer();
  }
  expect(')'); expect('OVER'); expect('(');
  if (take('PARTITION')) {
    expect('BY');
    do { config.partitionBy.push(identifier()); } while (take(','));
  }
  if (take('ORDER')) {
    expect('BY');
    do {
      const column = identifier(), direction = take('DESC') ? 'desc' : (take('ASC'), 'asc');
      config.orderBy.push({ column, direction });
    } while (take(','));
  }
  if (fn === 'SUM' || fn === 'AVG') {
    // An explicit ROWS frame distinguishes running from moving and avoids dialect defaults.
    expect('ROWS'); expect('BETWEEN');
    if (take('UNBOUNDED')) { expect('PRECEDING'); expect('AND'); expect('CURRENT'); expect('ROW'); }
    else {
      const bound = (direction: string): number => {
        if (take('CURRENT')) { expect('ROW'); return 0; }
        const count = integer(); expect(direction); return count;
      };
      config.function = fn === 'SUM' ? 'movingSum' : 'movingAverage';
      config.frameBefore = bound('PRECEDING'); expect('AND'); config.frameAfter = bound('FOLLOWING');
    }
  }
  expect(')');
  if (index !== tokens.length) fail();
  // Reuse the exact structured bounds, names, list uniqueness and function constraints.
  validatePrepWindowConfig(config, path);
  return config;
}

export function compilePrepWindow(config: PrepWindowConfig, columns: readonly PrepColumn[], dialect: 'duckdb' | 'postgres', path: string): { sql: string; type: PrepType } {
  const c = 'expression' in config ? parsePrepWindow(config.expression, config.name, `${path}.expression`) : config;
  if (!c.orderBy.length) prepFail('PREP_WINDOW_ORDER_REQUIRED', `${path}.${'expression' in config ? 'expression' : 'orderBy'}`, 'Window functions require an explicit Order by; include unique tie-breaker columns for deterministic row numbering');
  const column = (name: string): PrepColumn => columns.find(col => col.name === name) ?? prepFail('PREP_SCHEMA_MISMATCH', path, `Unknown column: ${name}`);
  const partition = c.partitionBy.map(name => q(column(name).name));
  // Pin null placement for both directions so the dialects share the same ordering.
  const order = c.orderBy.map(o => `${q(column(o.column).name)} ${o.direction.toUpperCase()} NULLS LAST`);
  const value = c.valueColumn === undefined ? undefined : column(c.valueColumn);
  let fn: string, frame = '', type: PrepType = 'INTEGER';
  switch (c.function) {
    case 'rowNumber': fn = 'ROW_NUMBER()'; break;
    case 'rank': fn = 'RANK()'; break;
    case 'denseRank': fn = 'DENSE_RANK()'; break;
    case 'ntile': fn = `NTILE(${c.buckets})`; break;
    case 'lag': case 'lead':
      if (!value) return prepFail('PREP_SCHEMA_MISMATCH', path, 'Window function requires a value column');
      fn = `${c.function.toUpperCase()}(${q(value.name)}, ${c.offset ?? 1})`; type = value.type; break;
    case 'runningTotal': case 'runningAverage': case 'movingSum': case 'movingAverage': {
      if (!value || !['INTEGER', 'DECIMAL'].includes(value.type)) prepFail('PREP_SCHEMA_MISMATCH', `${path}.valueColumn`, 'Running and moving functions require an INTEGER or DECIMAL value column');
      const aggregation = c.function === 'runningTotal' || c.function === 'movingSum' ? 'SUM' : 'AVG';
      fn = `${aggregation}(CAST(${q(value.name)} AS ${dialect === 'postgres' ? 'DOUBLE PRECISION' : 'DOUBLE'}))`;
      type = 'DECIMAL';
      frame = c.function === 'movingSum' || c.function === 'movingAverage'
        ? ` ROWS BETWEEN ${c.frameBefore ?? 0} PRECEDING AND ${c.frameAfter ?? 0} FOLLOWING`
        : ' ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW';
      break;
    }
    default: return prepFail('UNSUPPORTED_PREP_STEP', path, 'Unsupported window function');
  }
  return { sql: `${fn} OVER (${partition.length ? `PARTITION BY ${partition.join(', ')} ` : ''}ORDER BY ${order.join(', ')}${frame})`, type };
}
