import { parameterValueError } from '@opensight/query-engine/parameters';
import { analysisObject } from '@opensight/web/analysis';
import { MetadataError } from './metadata-db.js';
import type { DashboardVersion } from './dashboard-model.js';
import type { JsonObject } from './mapping.js';

function fail(code: string): never { throw new MetadataError(code, 422); }
/** Values change a request-local clone only. No caller-supplied expressions, columns or predicates. */
export function dashboardControls(version: DashboardVersion, raw: unknown): JsonObject {
  const body = analysisObject(raw, '$');
  if (Object.keys(body).some(k => k !== 'controlValues')) fail('DASHBOARD_UNDECLARED_CONTROL');
  const values = body.controlValues === undefined ? {} : analysisObject(body.controlValues, '$.controlValues');
  const definition = structuredClone(version.wireDefinition), controls = new Map<string, { parameter?: string; filter?: string }>();
  for (const rawSheet of definition.Sheets as unknown[] ?? []) {
    const sheet = analysisObject(rawSheet, '$.Sheets');
    for (const [collection, idKey, sourceKey] of [['ParameterControls', 'ParameterControlId', 'SourceParameterName'], ['FilterControls', 'FilterControlId', 'SourceFilterId']]) {
      for (const rawControl of sheet[collection!] as unknown[] ?? []) {
        const control = analysisObject(Object.values(analysisObject(rawControl, '$.controls'))[0], '$.control');
        const id = String(control[idKey!]);
        if (controls.has(id)) fail('DASHBOARD_CONTROL_INVALID');
        controls.set(id, sourceKey === 'SourceParameterName' ? { parameter: String(control[sourceKey]) } : { filter: String(control[sourceKey!]) });
      }
    }
  }
  for (const [id, value] of Object.entries(values)) {
    const control = controls.get(id); if (!control) fail('DASHBOARD_UNDECLARED_CONTROL');
    if (control.parameter) {
      const entries = (definition.ParameterDeclarations as JsonObject[] ?? []).flatMap(d => Object.entries(d));
      const found = entries.find(([, b]) => analysisObject(b, '$.parameter').Name === control.parameter);
      if (!found) fail('DASHBOARD_CONTROL_INVALID');
      const [kind, rawParameter] = found, p = analysisObject(rawParameter, '$.parameter');
      const type = kind === 'StringParameterDeclaration' ? 'string' : kind === 'DateTimeParameterDeclaration' ? 'datetime' : 'number';
      if (parameterValueError({ name: control.parameter, type, multiple: p.ParameterValueType === 'MULTI_VALUED', ...(type === 'number' ? { integer: kind === 'IntegerParameterDeclaration' } : {}) }, value)) fail('DASHBOARD_CONTROL_VALUE_INVALID');
      p.DefaultValues = { StaticValues: structuredClone(value) };
    } else {
      const filters = (definition.FilterGroups as JsonObject[] ?? []).flatMap(g => (g.Filters as JsonObject[] ?? []).flatMap(f => Object.entries(f)));
      const found = filters.find(([, b]) => analysisObject(b, '$.filter').FilterId === control.filter);
      if (!found || found[0] !== 'CategoryFilter') fail('DASHBOARD_CONTROL_UNSUPPORTED');
      const filter = analysisObject(found[1], '$.filter'), configuration = analysisObject(filter.Configuration, '$.filter.Configuration');
      if (!configuration.FilterListConfiguration || !Array.isArray(value) || value.length > 1000 || value.some(v => typeof v !== 'string' || v.includes('\0') || v.length > 10000) || new Set(value).size !== value.length) fail('DASHBOARD_CONTROL_VALUE_INVALID');
      analysisObject(configuration.FilterListConfiguration, '$.filter.Configuration').CategoryValues = structuredClone(value);
    }
  }
  return definition;
}
