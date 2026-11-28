// Structured-clone wire contract shared by the host SDK and the hosted frame.
export type EmbedCell = string | number | boolean | null;
export type EmbedValues = Record<string, EmbedCell>;
export type EmbedFilters = Record<string, (string | number)[]>;
export type EmbedDataEvent =
  | { type: 'selection'; visualId: string; values: EmbedValues }
  | { type: 'filterState'; filters: EmbedFilters }
  | { type: 'navigation'; path: string }
  | { type: 'save'; analysisId: string; version: number };

function record(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

function exact(value: Record<string, unknown>, ...keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,512}$/.test(value);
const name = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\x00-\x1f\x7f]/.test(value);
const scalar = (value: unknown) => typeof value === 'number' ? Number.isFinite(value) : typeof value === 'string' && value.length <= 10000 && !value.includes('\0');
const values = (value: unknown) => record(value) && Object.entries(value).every(([key, v]) => name(key) && (v === null || typeof v === 'boolean' || scalar(v)));
const filterValues = (v: unknown) => Array.isArray(v) && v.length <= 1000 && Object.keys(v).length === v.length && Array.from(v).every(scalar) && new Set(v).size === v.length;
const route = (path: unknown) => typeof path === 'string' && path.length <= 1024 && /^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+$/.test(path);

export function isEmbedDataEvent(value: unknown): value is EmbedDataEvent {
  if (!record(value)) return false;
  switch (value.type) {
    case 'selection': return exact(value, 'type', 'visualId', 'values') && id(value.visualId) && values(value.values);
    case 'filterState': return exact(value, 'type', 'filters') && record(value.filters) && Object.entries(value.filters).every(([key, v]) => name(key) && filterValues(v));
    case 'navigation': return exact(value, 'type', 'path') && route(value.path);
    case 'save': return exact(value, 'type', 'analysisId', 'version') && id(value.analysisId) && Number.isSafeInteger(value.version) && Number(value.version) >= 1;
    default: return false;
  }
}

export function isDataMessage(value: unknown, sessionId: string, channelId: string): value is { payload: EmbedDataEvent } {
  return record(value) && exact(value, 'version', 'type', 'sessionId', 'channelId', 'payload') && value.version === 2
    && value.type === 'opensight:data' && value.sessionId === sessionId && value.channelId === channelId && isEmbedDataEvent(value.payload);
}
