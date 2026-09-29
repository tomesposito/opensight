/** Portable dataset preparation metadata. Source IDs resolve through trusted connectors. */
export type PrepType = 'INTEGER' | 'DECIMAL' | 'STRING' | 'DATETIME' | 'BOOLEAN';
export interface PrepColumn { name: string; type: PrepType }
export type PrepAggregation = 'SUM' | 'AVG' | 'COUNT' | 'MIN' | 'MAX';
/** Same predicate shape/operators as the Phase 2b bound row filter. */
export type PrepFilter = { columnName: string; operator?: 'EQUALS' | 'GREATER_THAN_OR_EQUAL_TO' | 'LESS_THAN_OR_EQUAL_TO' } & ({ value: string | number } | { values: (string | number)[] });
export interface PrepMeasure { column: string; name: string; aggregation: PrepAggregation }
export type PrepInput = string | { dataset: string };
export type PrepJoinInput = PrepInput | { step: string };
export type PrepJoinOutputs = { columns: { column: string; name: string }[]; prefix?: never } | { prefix: string; columns?: never };
export type PrepStep = { id: string; name?: string } & (
  { kind: 'changeType'; config: { column: string; type: PrepType } } |
  { kind: 'rename'; config: { column: string; name: string } } |
  { kind: 'select'; config: { columns: string[] } } |
  { kind: 'filter'; config: { filters: PrepFilter[] } } |
  { kind: 'calculate'; config: { name: string; expression: string } } |
  { kind: 'aggregate'; config: { groupBy: string[]; measures: PrepMeasure[] } } |
  { kind: 'join'; config: { source: PrepJoinInput; joinType: 'inner' | 'left' | 'right' | 'full'; keys: { left: string; right: string }[] } & PrepJoinOutputs } |
  { kind: 'append'; config: { source: string } } |
  { kind: 'pivot'; config: { groupBy: string[]; column: string; value: string; aggregation: PrepAggregation; values: { value: string | number; name: string }[] } } |
  { kind: 'unpivot'; config: { columns: string[]; nameColumn: string; valueColumn: string } }
);
export interface PrepPipeline { version: 1; input: PrepInput; steps: PrepStep[] }
export type PrepErrorCode = 'INVALID_PREP_PIPELINE' | 'UNSUPPORTED_PREP_STEP' | 'PREP_SCHEMA_MISMATCH' | 'PREP_SOURCE_NOT_FOUND' | 'PREP_SECURITY_REJECTED' | 'PREP_EXECUTION_FAILED' | 'PREP_NOT_FOUND' | 'PREP_LIMIT_EXCEEDED';
export class PrepError extends Error {
  constructor(readonly code: PrepErrorCode, readonly path: string, message: string) { super(`${path}: ${message}`); this.name = 'PrepError'; }
}
export function prepFail(code: PrepErrorCode, path: string, message: string): never { throw new PrepError(code, path, message); }
const invalid = (path: string, message: string): never => prepFail('INVALID_PREP_PIPELINE', path, message);
export function prepObject(raw: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid(path, 'Expected an object');
  if (Object.keys(raw).some(k => !keys.includes(k))) invalid(path, 'Unknown configuration property');
  return raw as Record<string, unknown>;
}
export function prepName(raw: unknown, path: string): string {
  if (typeof raw !== 'string' || !raw.trim() || raw !== raw.trim() || raw.length > 128 || /[\x00-\x1f]/.test(raw)) return invalid(path, 'Expected a name of 1–128 characters without control characters');
  return raw;
}
function list(raw: unknown, path: string, empty = false): unknown[] {
  if (!Array.isArray(raw) || raw.length > 256 || !empty && !raw.length) return invalid(path, 'Expected a list with at most 256 entries');
  return raw;
}
function names(raw: unknown, path: string, empty = false): void {
  const values = list(raw, path, empty).map((v, i) => prepName(v, `${path}[${i}]`).toLowerCase());
  if (new Set(values).size !== values.length) invalid(path, 'Duplicate or case-ambiguous names');
}
function choice(raw: unknown, values: readonly string[], path: string): void { if (typeof raw !== 'string' || !values.includes(raw)) invalid(path, `Expected ${values.join(', ')}`); }
function scalar(raw: unknown, path: string): void { if (!(typeof raw === 'number' && Number.isFinite(raw) || typeof raw === 'string' && raw.length <= 10000 && !raw.includes('\0'))) invalid(path, 'Expected a finite number or string'); }
const aggregations = ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX'];
/** Deliberate self-hosted workflow limits (see docs/data-prep.md § Workflow limits). */
export const PREP_MAX_IMPORT_INPUTS = 32;
export const prepTypes: readonly PrepType[] = ['INTEGER', 'DECIMAL', 'STRING', 'DATETIME', 'BOOLEAN'];
function inputReference(raw: unknown, path: string, previous?: readonly string[]): void {
  if (typeof raw === 'string') { prepName(raw, path); return; }
  const ref = prepObject(raw, previous ? ['dataset', 'step'] : ['dataset'], path);
  if (Object.keys(ref).length !== 1) invalid(path, 'Expected exactly one input reference');
  if (Object.hasOwn(ref, 'dataset')) prepName(ref.dataset, `${path}.dataset`);
  else {
    const id = prepName(ref.step, `${path}.step`);
    if (!previous?.includes(id)) invalid(path, `Join source must reference an earlier step: ${id}`);
  }
}
export function validatePrepPipeline(raw: unknown, path = '$.opensightPrep'): PrepPipeline {
  const p = prepObject(raw, ['version', 'input', 'steps'], path);
  if (p.version !== 1) invalid(`${path}.version`, 'Unsupported pipeline version');
  inputReference(p.input, `${path}.input`);
  const steps = list(p.steps, `${path}.steps`, true);
  if (steps.length > 50) invalid(`${path}.steps`, 'At most 50 steps');
  names(steps.map(v => v && typeof v === 'object' ? (v as Record<string, unknown>).id : undefined), `${path}.steps.ids`, true);
  for (const [i, rawStep] of steps.entries()) {
    const sp = `${path}.steps[${i}]`, s = prepObject(rawStep, ['id', 'kind', 'config'], sp), cp = `${sp}.config`;
    prepName(s.id, `${sp}.id`);
    switch (s.kind) {
      case 'changeType': { const c = prepObject(s.config, ['column', 'type'], cp); prepName(c.column, cp); choice(c.type, prepTypes, cp); break; }
      case 'rename': { const c = prepObject(s.config, ['column', 'name'], cp); prepName(c.column, cp); prepName(c.name, cp); break; }
      case 'select': { const c = prepObject(s.config, ['columns'], cp); names(c.columns, cp); break; }
      case 'filter': {
        const c = prepObject(s.config, ['filters'], cp);
        for (const f of list(c.filters, cp)) {
          const v = prepObject(f, ['columnName', 'operator', 'value', 'values'], cp); prepName(v.columnName, cp);
          if (v.operator !== undefined) choice(v.operator, ['EQUALS', 'GREATER_THAN_OR_EQUAL_TO', 'LESS_THAN_OR_EQUAL_TO'], cp);
          if (Object.hasOwn(v, 'value') === Object.hasOwn(v, 'values')) invalid(cp, 'Expected exactly one of value or values');
          if (Object.hasOwn(v, 'value')) scalar(v.value, cp);
          else { if (v.operator && v.operator !== 'EQUALS') invalid(cp, 'Lists support only EQUALS'); list(v.values, cp, true).forEach(v => scalar(v, cp)); }
        }
        break;
      }
      case 'calculate': { const c = prepObject(s.config, ['name', 'expression'], cp); prepName(c.name, cp); if (typeof c.expression !== 'string' || !c.expression.trim() || c.expression.length > 10000) invalid(cp, 'Expected an expression of 1–10000 characters'); break; }
      case 'aggregate': {
        const c = prepObject(s.config, ['groupBy', 'measures'], cp); names(c.groupBy, cp, true);
        for (const m of list(c.measures, cp)) { const v = prepObject(m, ['column', 'name', 'aggregation'], cp); prepName(v.column, cp); prepName(v.name, cp); choice(v.aggregation, aggregations, cp); }
        break;
      }
      case 'join': {
        const c = prepObject(s.config, ['source', 'joinType', 'keys', 'columns', 'prefix'], cp);
        inputReference(c.source, `${cp}.source`, steps.slice(0, i).map(s => (s as { id: string }).id));
        choice(c.joinType, ['inner', 'left', 'right', 'full'], cp);
        const pairs = new Set<string>();
        for (const [n, k] of list(c.keys, `${cp}.keys`).entries()) {
          const kp = `${cp}.keys[${n}]`, v = prepObject(k, ['left', 'right'], kp);
          prepName(v.left, `${kp}.left`); prepName(v.right, `${kp}.right`);
          const pair = JSON.stringify([v.left, v.right]);
          if (pairs.has(pair)) invalid(kp, 'Duplicate join key pair'); pairs.add(pair);
        }
        if (Object.hasOwn(c, 'columns') === Object.hasOwn(c, 'prefix')) invalid(cp, 'Expected exactly one of columns or prefix');
        if (Object.hasOwn(c, 'prefix')) prepName(c.prefix, `${cp}.prefix`);
        else for (const col of list(c.columns, `${cp}.columns`)) { const v = prepObject(col, ['column', 'name'], cp); prepName(v.column, cp); prepName(v.name, cp); }
        break;
      }
      case 'append': { const c = prepObject(s.config, ['source'], cp); prepName(c.source, cp); break; }
      case 'pivot': {
        const c = prepObject(s.config, ['groupBy', 'column', 'value', 'aggregation', 'values'], cp); names(c.groupBy, cp, true); prepName(c.column, cp); prepName(c.value, cp); choice(c.aggregation, aggregations, cp);
        for (const v of list(c.values, cp)) { const entry = prepObject(v, ['value', 'name'], cp); scalar(entry.value, cp); prepName(entry.name, cp); }
        break;
      }
      case 'unpivot': { const c = prepObject(s.config, ['columns', 'nameColumn', 'valueColumn'], cp); names(c.columns, cp); prepName(c.nameColumn, cp); prepName(c.valueColumn, cp); break; }
      default: prepFail('UNSUPPORTED_PREP_STEP', `${sp}.kind`, 'Unknown or unsupported transformation');
    }
  }
  // Import budget: every source read counts as an import step (top input, join
  // dataset/table sources, append sources), matching QuickSight's 32 import
  // steps per workflow. Step references reuse earlier results and do not count.
  const parsed = structuredClone(raw) as PrepPipeline;
  let importCount = 1; // the top-level input always reads a source
  for (const step of parsed.steps) {
    if (step.kind === 'join') {
      const source = step.config.source;
      if (typeof source === 'string' || Object.hasOwn(source, 'dataset')) importCount++;
    } else if (step.kind === 'append') importCount++;
  }
  if (importCount > PREP_MAX_IMPORT_INPUTS) prepFail('PREP_LIMIT_EXCEEDED', `${path}.input`, `At most ${PREP_MAX_IMPORT_INPUTS} import steps per workflow (found ${importCount})`);
  return parsed;
}
