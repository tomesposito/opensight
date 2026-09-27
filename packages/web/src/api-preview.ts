import { themeValid } from './themes.js';
import type { BundleSheet } from '@opensight/bundle-parser';
import type { DefinitionResponse, ResourceKind } from './api-client.js';
import { convertDefinition } from './definition-converter.js';
import type { Fixture, FixtureVisual } from './model.js';

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
// JSON object key order is immaterial; array order and absent properties matter.
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => equal(v, b[i]));
  if (!isObject(a) || !isObject(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(k => Object.hasOwn(b, k) && equal(a[k], b[k]));
}

function placements(sheet: BundleSheet): Map<string, FixtureVisual['placement']> | undefined {
  if (sheet.layouts?.length !== 1) return;
  const configuration = sheet.layouts[0]?.configuration;
  if (!isObject(configuration) || !isObject(configuration.gridLayout)) return;
  const elements = configuration.gridLayout.elements;
  if (!Array.isArray(elements)) return;
  const result = new Map<string, FixtureVisual['placement']>();
  for (const element of elements) {
    if (!isObject(element) || element.elementType !== 'VISUAL' || typeof element.elementId !== 'string') return;
    const { columnIndex: column = 0, columnSpan: columns, rowIndex: row = 0, rowSpan: rows } = element;
    if (typeof column !== 'number' || typeof columns !== 'number' || typeof row !== 'number' || typeof rows !== 'number' ||
      ![column, columns, row, rows].every(Number.isSafeInteger) || column < 0 || row < 0 || row > 1000 || columns < 1 || rows < 1 || rows > 21 || column + columns > 36 || result.has(element.elementId)) return;
    result.set(element.elementId, { column, columns, row, rows });
  }
  const allPlaced = (sheet.visuals ?? []).every(v => result.has(Object.values(v)[0]!.visualId));
  if (allPlaced) return result;
}

/** Live definitions, closed fixture results. Never matches data by visual ID alone. */
export function buildApiPreview(response: DefinitionResponse, kind: ResourceKind, fixtures: Fixture[]): Fixture {
  const fixture = fixtures.find(f => f.id === response.id && f.apiResource?.kind === kind);
  const reference = fixture?.apiResource;
  const matches = reference && equal(response.definition, reference.source === 'api' ? convertDefinition(reference.definition) : reference.definition);
  const sheets = response.definition.sheets ?? [];
  const sheetIds = new Set<string>();
  let fallbackLayout = false;
  const preview: Fixture = {
    id: response.id,
    name: response.name ?? response.id,
    description: `Live ${kind} definition · precomputed fixture data only`,
    provenance: `${kind === 'analysis' ? 'analyses' : 'dashboards'}/${response.id}/definition`,
    notice: 'Definitions are fetched live. Chart data uses precomputed fixture results; the query engine is not available over HTTP. ',
    sheets: sheets.map((sheet, si) => {
      if (sheetIds.has(sheet.sheetId)) throw new Error(`Duplicate sheet ID: ${sheet.sheetId}`);
      sheetIds.add(sheet.sheetId);
      const grid = placements(sheet);
      if (!grid && sheet.visuals?.length) fallbackLayout = true;
      const visualIds = new Set<string>();
      return {
        id: sheet.sheetId, name: sheet.name ?? sheet.sheetId,
        visuals: (sheet.visuals ?? []).map((definition, vi): FixtureVisual => {
          const id = Object.values(definition)[0]!.visualId;
          if (visualIds.has(id)) throw new Error(`Duplicate visual ID in sheet ${sheet.sheetId}: ${id}`);
          visualIds.add(id);
          const pinned = matches ? fixture?.sheets[si]?.visuals[vi] : undefined;
          return {
            source: 'bundle', definition, ...(themeValid(response.definition.opensightTheme) ? { theme: response.definition.opensightTheme } : {}), rows: pinned?.rows ?? null, bindings: pinned?.bindings ?? {},
            placement: grid?.get(id) ?? { column: 0, columns: 36, row: vi * 6, rows: 6 },
            path: `Definition.sheets[${si}].visuals[${vi}]`,
          };
        }),
      };
    }),
  };
  preview.notice += matches ? fixture!.notice : 'No matching reviewed fixture definition: data is unavailable.';
  if (fallbackLayout) preview.notice += ' Missing or unsupported layouts use full-width cards in definition order.';
  return preview;
}
