import { parseExpression } from '@opensight/query-engine/browser';
import { calculationInfo, dataFields, sheetParameters, type AuthorDraft, type AuthorDataset, type AuthorVisual, type CalculatedField } from './authoring.js';
import type { AuthorParameter } from './parameters.js';

export interface UnresolvedFieldDiagnostic {
  sheetId?: string;
  visualId?: string;
  controlId?: string;
  calculation?: string;
  location: string;
  fieldName: string;
  reason: 'missing from dataset' | 'role changed' | 'calculation references missing field';
}
type Problem = Pick<UnresolvedFieldDiagnostic, 'fieldName' | 'reason' | 'calculation'>;
type Expected = 'dimension' | 'measure' | 'string' | 'number' | 'datetime' | 'boolean';
const scalarType = (type: string): Expected => type === 'STRING' ? 'string' : type === 'DATETIME' ? 'datetime' : type === 'BOOLEAN' ? 'boolean' : 'number';

/** Parse dependencies, rather than matching braces in literals or parameters. */
function fieldChecker(calculations: readonly CalculatedField[], dataset: AuthorDataset) {
  const fields = dataFields(calculations, dataset);
  const dependencies = new Map(calculations.map(c => [c.name, parseExpression(c.expression, '$.expression', { validationOnly: true }).dependencies]));
  const cache = new Map<string, Problem[]>();
  const calculationProblems = (name: string, visiting = new Set<string>()): Problem[] => {
    const ready = cache.get(name); if (ready) return ready;
    if (visiting.has(name)) return []; // validateDraft rejects cycles separately.
    const next = new Set(visiting).add(name), refs = dependencies.get(name) ?? [];
    const problems = refs.flatMap(fieldName => dependencies.has(fieldName) ? calculationProblems(fieldName, next)
      : !fields.some(f => f.name === fieldName) ? [{ fieldName, calculation: name, reason: 'calculation references missing field' as const }] : []);
    // A retained expression can become ill-typed after a column type changes.
    // Structural expression checks still run in validateDraft with unknown bindings.
    if (!problems.length) {
      try { calculationInfo(name, calculations, dataset); }
      catch { problems.push(...refs.map(fieldName => ({ fieldName, calculation: name, reason: 'role changed' as const }))); }
    }
    cache.set(name, problems); return problems;
  };
  return (name: string, expected?: Expected, noBoolean = false): Problem[] => {
    const field = fields.find(f => f.name === name);
    if (!field) return [{ fieldName: name, reason: 'missing from dataset' }];
    const problems = dependencies.has(name) ? [...calculationProblems(name)] : [];
    if (expected && (expected === 'dimension' || expected === 'measure' ? field.role !== expected : scalarType(field.type) !== expected) || noBoolean && field.type === 'BOOLEAN') {
      problems.push({ fieldName: name, reason: 'role changed' });
    }
    return problems;
  };
}

function visualDiagnostics(visual: AuthorVisual, check: ReturnType<typeof fieldChecker>, parameters: readonly AuthorParameter[]): UnresolvedFieldDiagnostic[] {
  const result: UnresolvedFieldDiagnostic[] = [];
  const add = (name: string, location: string, expected?: Expected, noBoolean = false) => {
    result.push(...check(name, expected, noBoolean).map(problem => ({ ...problem, location, visualId: visual.id })));
  };
  if (visual.dimension !== null) add(visual.dimension, 'dimension', 'dimension');
  for (const well of ['rows', 'columns', 'measures', 'smallMultiples', 'breakdowns'] as const) {
    for (const name of visual[well] ?? []) add(name, well, well === 'measures' ? 'measure' : 'dimension', well === 'smallMultiples' || well === 'breakdowns');
  }
  for (const filter of visual.filters) add(filter.columnName, 'filter', filter.parameterName ? parameters.find(p => p.name === filter.parameterName)?.type : 'string');
  for (const level of visual.hierarchy?.levels ?? []) add(level.columnName, 'hierarchy', level.granularity ? 'datetime' : 'dimension');
  for (const field of visual.tooltipHiddenFields) add(field, 'hidden tooltip field');
  for (const field of visual.tooltipExtraFields) add(field.field, 'extra tooltip field', 'measure');
  for (const action of visual.filterActions ?? []) {
    add(action.sourceField, 'filter action', 'dimension');
    for (const name of [...Object.values(action.mappings), ...action.scopeFields ?? []]) add(name, 'filter action', 'dimension');
  }
  for (const action of visual.urlActions ?? []) {
    add(action.sourceField, 'URL action', 'dimension');
    for (const [, name] of action.urlTemplate.matchAll(/\{([^{}]+)\}/g)) add(name!, 'URL action', 'dimension');
  }
  for (const action of visual.navigationActions ?? []) {
    add(action.sourceField, 'navigation action', 'dimension');
    for (const [name, parameter] of Object.entries(action.parameterMappings)) add(name, 'navigation action', parameters.find(p => p.name === parameter)?.type);
  }
  return result;
}

/** Explicit local dataset bindings only; imported bundles keep their import diagnostics. */
export function unresolvedVisualFieldDiagnostics(visual: AuthorVisual, calculations: readonly CalculatedField[], dataset?: AuthorDataset, parameters: readonly AuthorParameter[] = []): UnresolvedFieldDiagnostic[] {
  return dataset ? visualDiagnostics(visual, fieldChecker(calculations, dataset), parameters) : [];
}

/** Derived state: never rewrites references or stores stale diagnostic flags in a draft. */
export function unresolvedFieldDiagnostics(draft: AuthorDraft): UnresolvedFieldDiagnostic[] {
  if (!draft.dataset) return [];
  const check = fieldChecker(draft.calculatedFields, draft.dataset), result: UnresolvedFieldDiagnostic[] = [];
  for (const calculation of draft.calculatedFields) {
    result.push(...check(calculation.name).map(problem => ({ ...problem, calculation: calculation.name, location: 'calculation' })));
  }
  for (const sheet of draft.sheets) {
    const parameters = sheetParameters(draft, sheet);
    for (const visual of sheet.visuals) result.push(...visualDiagnostics(visual, check, parameters).map(d => ({ ...d, sheetId: sheet.id })));
    for (const control of sheet.controls) {
      if (!control.source?.local) continue;
      const add = (name: string, expected?: Expected) => result.push(...check(name, expected).map(problem => ({ ...problem, sheetId: sheet.id, controlId: control.id, location: 'control binding' })));
      add(control.source.columnName, parameters.find(p => p.id === control.parameterId)?.type);
      for (const cascade of control.cascade ?? []) add(cascade.columnName, parameters.find(p => p.id === sheet.controls.find(c => c.id === cascade.controlId)?.parameterId)?.type);
    }
  }
  return result;
}

export function unresolvedFieldMessage(diagnostics: readonly UnresolvedFieldDiagnostic[]): string | undefined {
  return diagnostics.length ? `Unavailable fields: ${[...new Set(diagnostics.map(d => `${d.fieldName} (${d.reason})`))].join(', ')}. Repair the field assignments or replace the dataset.` : undefined;
}
