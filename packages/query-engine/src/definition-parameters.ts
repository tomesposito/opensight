import { validateParameters, type ParameterDeclaration, type ParameterBindings } from './parameters.js';
import { array, object, string, keys, fail } from './validation.js';

/** QuickSight declarations bind to the same typed evaluator as interactive queries. */
export function definitionParameters(raw: unknown): { declarations: ParameterDeclaration[]; bindings: ParameterBindings } {
  const bindings: ParameterBindings = {};
  const declarations = array(raw ?? [], '$.analysis.Definition.ParameterDeclarations').map((value, i): ParameterDeclaration => {
    const path = `$.analysis.Definition.ParameterDeclarations[${i}]`, entries = Object.entries(object(value, path));
    if (entries.length !== 1) fail('UNSUPPORTED_FEATURE', '$.analysis.Definition.ParameterDeclarations', 'Expected one parameter variant');
    const [kind, rawBody] = entries[0]!, b = object(rawBody, path);
    if (!['StringParameterDeclaration', 'IntegerParameterDeclaration', 'DecimalParameterDeclaration', 'DateTimeParameterDeclaration'].includes(kind)) fail('UNSUPPORTED_FEATURE', path, 'Unsupported parameter declaration');
    keys(b, ['Name', 'ParameterValueType', 'DefaultValues', 'TimeGranularity'], path);
    const name = string(b.Name, `${path}.Name`), defaults = object(b.DefaultValues ?? { StaticValues: [] }, `${path}.DefaultValues`);
    keys(defaults, ['StaticValues'], `${path}.DefaultValues`);
    const type = kind === 'StringParameterDeclaration' ? 'string' : kind === 'DateTimeParameterDeclaration' ? 'datetime' : 'number';
    if (kind !== 'DateTimeParameterDeclaration' && !['SINGLE_VALUED', 'MULTI_VALUED'].includes(String(b.ParameterValueType)) || kind === 'DateTimeParameterDeclaration' && b.ParameterValueType !== undefined && b.ParameterValueType !== 'SINGLE_VALUED') fail('INVALID_INPUT', path, 'Invalid parameter multiplicity');
    if (Object.hasOwn(bindings, name)) fail('INVALID_INPUT', path, 'Duplicate parameter');
    Object.defineProperty(bindings, name, { value: defaults.StaticValues, enumerable: true });
    return { name, type, multiple: b.ParameterValueType === 'MULTI_VALUED', ...(type === 'number' ? { integer: kind === 'IntegerParameterDeclaration' } : {}) };
  });
  try { return validateParameters(declarations, bindings); }
  catch (e) { fail('INVALID_INPUT', '$.analysis.Definition.ParameterDeclarations', String(e)); }
}

export function validateDefinitionControls(rawSheets: unknown, rawFilters: unknown, parameters: readonly ParameterDeclaration[]): void {
  const filters = new Set(array(rawFilters ?? [], '$.analysis.Definition.FilterGroups').flatMap(g => array(object(g, '$.FilterGroups').Filters, '$.Filters').map(f => {
    const bodies = Object.values(object(f, '$.Filters')); return bodies.length === 1 ? object(bodies[0], '$.Filter').FilterId : undefined;
  })));
  const ids = new Set<string>();
  for (const [index, value] of array(rawSheets, '$.analysis.Definition.Sheets').entries()) {
    const sheet = object(value, '$.Sheets');
    for (const [collection, idKey, sourceKey] of [['ParameterControls', 'ParameterControlId', 'SourceParameterName'], ['FilterControls', 'FilterControlId', 'SourceFilterId']] as const) {
      const path = `$.analysis.Definition.Sheets[${index}].${collection}`;
      for (const raw of array(sheet[collection] ?? [], path)) {
        const entries = Object.entries(object(raw, path));
        if (entries.length !== 1 || !['DateTimePicker', 'Dropdown', 'List', 'Slider', 'TextField', 'TextArea', 'RelativeDateTime'].includes(entries[0]![0])) fail('UNSUPPORTED_FEATURE', path, 'Unsupported control');
        const body = object(entries[0]![1], path), id = string(body[idKey], path), source = string(body[sourceKey], path);
        if (ids.has(id)) fail('INVALID_INPUT', path, 'Duplicate control ID'); ids.add(id);
        if (sourceKey === 'SourceParameterName' ? !parameters.some(p => p.name === source) : !filters.has(source)) fail('UNRESOLVED_BINDING', path, 'Unresolved control source');
      }
    }
  }
}
