import { datasetFields, defaults, emptyDraft, type AuthorDataset, type AuthorDraft, type DataField } from './authoring.js';

type Result<T> = { ok: true; value: T } | { ok: false; message: string; token?: string; matches: string[] };
export interface FieldSearch { measure: DataField; dimension?: DataField }

/** Only unbracketed `by` separates tokens. A literal ] is escaped as ]]. */
export function fieldSearchParts(text: string): string[] {
  const parts: string[] = [];
  let start = 0, bracket = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '[') bracket = true;
    else if (text[i] === ']' && bracket) {
      if (text[i + 1] === ']') i++;
      else bracket = false;
    } else if (!bracket && /^\s+by\s+/i.test(text.slice(i))) {
      parts.push(text.slice(start, i));
      i += /^\s+by\s+/i.exec(text.slice(i))![0].length - 1;
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

export const fieldToken = (name: string): string => `[${name.replaceAll(']', ']]')}]`;
const fold = (text: string): string => text.toLowerCase();
function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < b.length; j++) next.push(Math.min(next[j]! + 1, row[j + 1]! + 1, row[j]! + (a[i] === b[j] ? 0 : 1)));
    row = next;
  }
  return row[b.length]!;
}
export function closestFields(token: string, fields: readonly DataField[]): DataField[] {
  const query = fold(token.trim()).slice(0, 256);
  const rank = (name: string): number => {
    const value = fold(name);
    return value === query ? -3 : value.startsWith(query) ? -2 : value.includes(query) ? -1 : distance(query, value);
  };
  return fields.map((field, index) => ({ field, index, score: rank(field.name) }))
    .sort((a, b) => a.score - b.score || a.index - b.index).slice(0, 8).map(entry => entry.field);
}
export const searchFields = (dataset: AuthorDataset | undefined, role: DataField['role']): readonly DataField[] =>
  datasetFields(dataset).filter(field => field.role === role && (role === 'measure' ? ['INTEGER', 'DECIMAL'].includes(field.type) : field.type !== 'BOOLEAN'));

export function resolveFieldSearch(text: string, dataset?: AuthorDataset): Result<FieldSearch> {
  const parts = fieldSearchParts(text);
  if (!text.trim() || text.length > 1024 || parts.length > 2) return { ok: false, message: 'Use one measure field, optionally followed by by and one dimension field.', matches: [] };
  const resolved: DataField[] = [];
  for (let i = 0; i < parts.length; i++) {
    const raw = parts[i]!.trim();
    const bracketed = /^\[((?:[^\]]|\]\])+)\]$/.exec(raw);
    if (!raw || (!bracketed && /[\[\]]/.test(raw))) return { ok: false, message: `Incomplete field token “${raw}”. Use [field name] or a plain field name.`, token: raw, matches: [] };
    const token = bracketed ? bracketed[1]!.replaceAll(']]', ']') : raw;
    const role = i === 0 ? 'measure' : 'dimension';
    const fields = datasetFields(dataset), exact = fields.filter(field => fold(field.name) === fold(token));
    const eligible = searchFields(dataset, role);
    if (exact.length !== 1 || !eligible.some(field => field.name === exact[0]!.name && field.type === exact[0]!.type)) {
        const matches = (exact.length > 1 ? exact : closestFields(token, eligible)).map(field => field.name);
        const reason = exact.length > 1 ? 'Ambiguous field' : exact.length ? `Expected a ${role} field, found` : 'Unknown field';
        return { ok: false, token, matches, message: `${reason} “${token}”. ${matches.length ? `Closest ${role} fields: ${matches.map(fieldToken).join(', ')}. Choose a field explicitly.` : `No supported ${role} fields are available.`}` };
    }
    resolved.push(exact[0]!);
  }
  return { ok: true, value: { measure: resolved[0]!, ...(resolved[1] ? { dimension: resolved[1] } : {}) } };
}

/** Ordinary Author draft: serialization, query planning and rendering stay on the existing path. */
export function createFieldSearchDraft(text: string, dataset?: AuthorDataset): Result<AuthorDraft> {
  const result = resolveFieldSearch(text, dataset);
  if (!result.ok) return result;
  const { measure, dimension } = result.value;
  const draft = { ...emptyDraft(), ...(dataset ? { dataset } : {}) };
  const sheet = draft.sheets[0]!;
  sheet.visuals = [{ ...defaults(), id: 'visual-1', kind: dimension ? 'bar' : 'kpi',
    title: `SUM ${measure.name}${dimension ? ` by ${dimension.name}` : ''}`, donut: false,
    dimension: dimension?.name ?? null, measures: [measure.name] }];
  sheet.selectedId = 'visual-1';
  sheet.layout = [{ i: 'visual-1', x: 0, y: 0, w: 6, h: 8 }];
  return { ok: true, value: draft };
}
