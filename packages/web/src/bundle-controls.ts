import type { AuthorParameter } from './parameters.js';
import { controlError, type AuthorControl } from './controls.js';
import type { CategoryFilter } from './authoring.js';
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {};
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const text = (v: unknown): string => typeof v === 'string' ? v : '';
export function serializeControl(c: AuthorControl, parameters: readonly AuthorParameter[], controls: readonly AuthorControl[]): Obj {
  const p = parameters.find(p => p.id === c.parameterId);
  if (!p) throw new Error(`Unresolved parameter for control ${c.label}`);
  const kind = c.kind === 'date' ? 'dateTimePicker' : c.kind === 'text' ? 'textField' : c.kind;
  return { [kind]: { parameterControlId: c.importedId ?? c.id, title: c.label, sourceParameterName: p.name,
    ...(c.kind === 'dropdown' ? { type: p.multiple ? 'MULTI_SELECT' : 'SINGLE_SELECT', selectableValues: c.source ? { linkToDataSetColumn: { columnName: c.source.columnName, dataSetIdentifier: c.source.dataSetIdentifier } } : { values: (c.options ?? []).map(String) } } : {}),
    ...(c.kind === 'slider' ? { type: 'SINGLE_POINT', minimumValue: c.min, maximumValue: c.max, stepSize: c.step } : {}),
    ...(c.kind === 'date' ? { type: 'SINGLE_VALUED' } : {}),
    ...(c.cascade?.length ? { cascadingControlConfiguration: { sourceControls: c.cascade.map(parent => { const source = controls.find(c => c.id === parent.controlId); return { sourceSheetControlId: source?.importedId ?? parent.controlId, columnToMatch: { dataSetIdentifier: c.source?.dataSetIdentifier ?? 'sales_data', columnName: parent.columnName } }; }) } } : {}),
  } };
}
export function importControls(raw: unknown, parameters: readonly AuthorParameter[], local: (identifier: string) => boolean, messages: string[], sheetId: string): AuthorControl[] {
  const controls: AuthorControl[] = [];
  if (raw !== undefined && !Array.isArray(raw)) { messages.push(`Sheet ${sheetId}.parameterControls: display only; expected an array (retained verbatim).`); return controls; }
  for (const [index, value] of list(raw).entries()) {
    const [variant, v] = Object.entries(obj(value))[0] ?? [], body = obj(v), name = text(body.title) || text(body.parameterControlId) || `control ${index + 1}`;
    const report = (m: string) => messages.push(`Control ${name} on sheet ${sheetId}: ${m}`);
    const p = parameters.find(p => p.name === body.sourceParameterName);
    const kind = variant === 'dropdown' ? 'dropdown' : variant === 'slider' ? 'slider' : variant === 'dateTimePicker' ? 'date' : variant === 'textField' ? 'text' : undefined;
    if (!p || !kind || !text(body.parameterControlId) || Object.keys(obj(value)).length !== 1) { report('display only; unsupported control type or unresolved parameter (retained verbatim).'); continue; }
    const known = ['parameterControlId','title','sourceParameterName','displayOptions', ...(kind === 'dropdown' ? ['type','selectableValues','cascadingControlConfiguration'] : kind === 'slider' ? ['type','minimumValue','maximumValue','stepSize'] : kind === 'date' ? ['type'] : [])];
    if (Object.keys(body).some(k => !known.includes(k)) || body.title !== undefined && typeof body.title !== 'string' || kind === 'dropdown' && body.type !== undefined && body.type !== (p.multiple ? 'MULTI_SELECT' : 'SINGLE_SELECT') || kind === 'slider' && body.type !== undefined && body.type !== 'SINGLE_POINT' || kind === 'date' && body.type !== undefined && body.type !== 'SINGLE_VALUED') { report('display only; unsupported control properties or selection semantics (retained verbatim).'); continue; }
    const selectable = obj(body.selectableValues), source = obj(selectable.linkToDataSetColumn);
    if (body.selectableValues !== undefined && (typeof body.selectableValues !== 'object' || body.selectableValues === null || Array.isArray(body.selectableValues)) || selectable.values !== undefined && !Array.isArray(selectable.values) || Object.keys(source).some(k => !['dataSetIdentifier','columnName'].includes(k)) || Object.keys(selectable).some(k => !['values','linkToDataSetColumn'].includes(k)) || selectable.values !== undefined && selectable.linkToDataSetColumn !== undefined) { report('display only; unsupported options (retained verbatim).'); continue; }
    const c: AuthorControl = { id: `control-${index + 1}`, importedId: text(body.parameterControlId), label: name, kind, parameterId: p.id,
      ...(kind === 'slider' ? { min: body.minimumValue as number, max: body.maximumValue as number, step: body.stepSize as number } : {}),
      ...(kind === 'dropdown' ? selectable.linkToDataSetColumn ? { source: { columnName: text(source.columnName), dataSetIdentifier: text(source.dataSetIdentifier), local: local(text(source.dataSetIdentifier)) } } : { options: list(selectable.values).map(v => p.type === 'number' && typeof v === 'string' && v.trim() ? Number(v) : v as string | number) } : {}),
    };
    const problem = controlError(c, parameters);
    if (problem || c.source && (!c.source.columnName || !c.source.dataSetIdentifier) || controls.some(existing => existing.importedId === c.importedId)) { report(`display only; ${problem ?? 'invalid control identity/source'} (retained verbatim).`); continue; }
    const cascades = obj(body.cascadingControlConfiguration);
    if (body.cascadingControlConfiguration !== undefined) {
      if (!c.source || Object.keys(cascades).some(k => k !== 'sourceControls') || !Array.isArray(cascades.sourceControls)) { report('display only; unsupported cascade (retained verbatim).'); continue; }
      c.cascade = list(cascades.sourceControls).map(raw => { const parent = obj(raw), match = obj(parent.columnToMatch); return { controlId: text(parent.sourceSheetControlId), columnName: text(match.columnName) }; });
      if (list(cascades.sourceControls).some(raw => { const parent = obj(raw), match = obj(parent.columnToMatch); return Object.keys(parent).some(k => !['sourceSheetControlId', 'columnToMatch'].includes(k)) || Object.keys(match).some(k => !['dataSetIdentifier','columnName'].includes(k)) || match.dataSetIdentifier !== c.source?.dataSetIdentifier; })) { report('display only; cascade crosses datasets or has unsupported properties (retained verbatim).'); continue; }
    }
    if (body.displayOptions !== undefined) report('displayOptions retained; native input appearance used.');
    controls.push(c);
  }
  const byOriginal = new Map(controls.map(c => [c.importedId, c.id]));
  controls.forEach(c => c.cascade?.forEach(parent => { parent.controlId = byOriginal.get(parent.controlId) ?? ''; }));
  const invalid = (c: AuthorControl, seen = new Set<string>()): boolean => seen.has(c.id) || (c.cascade ?? []).some(parent => { const p = controls.find(c => c.id === parent.controlId); return !parent.columnName || !p || invalid(p, new Set(seen).add(c.id)); });
  return controls.filter(c => { if (invalid(c)) { messages.push(`Control ${c.label} on sheet ${sheetId}: display only; unresolved or cyclic cascade (retained verbatim).`); return false; } messages.push(`Control ${c.label} on sheet ${sheetId}: ${c.source && !c.source.local ? 'parameter is live; options require a resolved dataset' : 'live'}; bound to ${parameters.find(p => p.id === c.parameterId)!.name}.`); return true; });
}
export function serializeFilter(filter: CategoryFilter, id: string, identifier: string, parameters: readonly AuthorParameter[]): Obj {
  const column = { dataSetIdentifier: identifier, columnName: filter.columnName };
  if (!filter.parameterName) return { categoryFilter: { filterId: id, column, configuration: { filterListConfiguration: { matchOperator: 'EQUALS', nullOption: 'NON_NULLS_ONLY', categoryValues: filter.values } } } };
  const p = parameters.find(p => p.name === filter.parameterName);
  if (!p) throw new Error(`Undeclared filter parameter ${filter.parameterName}`);
  const operator = filter.operator ?? 'EQUALS';
  if (p.type === 'string') return { categoryFilter: { filterId: id, column, configuration: { customFilterConfiguration: { matchOperator: 'EQUALS', nullOption: 'NON_NULLS_ONLY', parameterName: p.name } } } };
  if (p.type === 'number' && operator === 'EQUALS') return { numericEqualityFilter: { filterId: id, column, matchOperator: 'EQUALS', nullOption: 'NON_NULLS_ONLY', parameterName: p.name } };
  const date = p.type === 'datetime';
  if (p.multiple) throw new Error('Numeric/date range filters require a single-value parameter');
  return { [date ? 'timeRangeFilter' : 'numericRangeFilter']: { filterId: id, column, nullOption: 'NON_NULLS_ONLY',
    ...(date ? { timeGranularity: 'SECOND' } : {}),
    ...(operator !== 'LESS_THAN_OR_EQUAL_TO' ? { [date ? 'rangeMinimumValue' : 'rangeMinimum']: { parameter: p.name }, includeMinimum: true } : {}),
    ...(operator !== 'GREATER_THAN_OR_EQUAL_TO' ? { [date ? 'rangeMaximumValue' : 'rangeMaximum']: { parameter: p.name }, includeMaximum: true } : {}),
  } };
}
/** Only parameter equality and inclusive one-sided ranges; unmodeled semantics remain blocked. */
export function importParameterFilter(raw: unknown, parameters: readonly AuthorParameter[]): CategoryFilter | undefined {
  const [kind, value] = Object.entries(obj(raw))[0] ?? [], f = obj(value), column = obj(f.column);
  if (typeof column.columnName !== 'string') return;
  let name: string, operator: CategoryFilter['operator'] = 'EQUALS';
  if (kind === 'categoryFilter') {
    if (Object.keys(f).some(k => !['filterId','column','configuration'].includes(k))) return;
    const config = obj(f.configuration), c = obj(config.customFilterConfiguration ?? config.customFilterListConfiguration ?? config.filterListConfiguration);
    if (c.matchOperator !== 'EQUALS' || c.nullOption !== 'NON_NULLS_ONLY' || typeof c.parameterName !== 'string' || Object.keys(c).some(k => !['matchOperator','nullOption','parameterName'].includes(k))) return;
    name = c.parameterName;
    if (parameters.find(p => p.name === name)?.type !== 'string') return;
  } else if (kind === 'numericEqualityFilter') {
    if (f.matchOperator !== 'EQUALS' || f.nullOption !== 'NON_NULLS_ONLY' || typeof f.parameterName !== 'string' || Object.keys(f).some(k => !['filterId','column','matchOperator','nullOption','parameterName'].includes(k)) || parameters.find(p => p.name === f.parameterName)?.type !== 'number') return;
    name = f.parameterName;
  } else if (kind === 'numericRangeFilter' || kind === 'timeRangeFilter') {
    const date = kind === 'timeRangeFilter', minKey = date ? 'rangeMinimumValue' : 'rangeMinimum', maxKey = date ? 'rangeMaximumValue' : 'rangeMaximum';
    if (f.nullOption !== 'NON_NULLS_ONLY' || Object.keys(f).some(k => !['filterId','column','nullOption',minKey,maxKey,'includeMinimum','includeMaximum',...(date ? ['timeGranularity'] : [])].includes(k))) return;
    if (date && f.timeGranularity !== undefined && !['SECOND','MILLISECOND'].includes(String(f.timeGranularity))) return;
    const min = obj(f[minKey]), max = obj(f[maxKey]);
    if (f[minKey] !== undefined && (typeof min.parameter !== 'string' || Object.keys(min).length !== 1 || f.includeMinimum !== true) || f[maxKey] !== undefined && (typeof max.parameter !== 'string' || Object.keys(max).length !== 1 || f.includeMaximum !== true)) return;
    if (min.parameter && max.parameter && min.parameter !== max.parameter) return;
    name = text(min.parameter ?? max.parameter); operator = min.parameter && max.parameter ? 'EQUALS' : min.parameter ? 'GREATER_THAN_OR_EQUAL_TO' : 'LESS_THAN_OR_EQUAL_TO';
    const p = parameters.find(p => p.name === name);
    if (!p || p.multiple || p.type !== (date ? 'datetime' : 'number')) return;
  } else return;
  if (Object.keys(column).some(k => !['dataSetIdentifier','columnName'].includes(k))) return;
  return { columnName: column.columnName, values: [], parameterName: name, operator };
}
