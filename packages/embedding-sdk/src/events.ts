// Structured-clone wire contract shared by the host SDK and the hosted frame.
export type EmbedRouteArea = 'dashboard' | 'catalog' | 'author' | 'prep' | 'ask';
export function embedRoute(path: unknown, landing = false) {
  if (typeof path !== 'string') return;
  const routes: [RegExp, EmbedRouteArea][] = [
    [/^\/dashboards(?:\/([A-Za-z0-9_-]{1,512}))?$/, 'dashboard'],
    [/^\/data$/, 'catalog'], [/^\/analyses\/author(?:\/([A-Za-z0-9_-]{1,512}))?$/, 'author'],
    [/^\/data\/preparation$/, 'prep'], [/^\/ask-o$/, 'ask'],
    ...(!landing ? [
      [/^\/home$/, 'dashboard'], [/^\/analyses(?:\/new|\/drafts\/[A-Za-z0-9-]{1,80})?$/, 'author'],
      [/^\/data\/(?:sources|new)$/, 'prep'], [/^\/data\/datasets\/([A-Za-z0-9_-]{1,128})$/, 'catalog'],
      [/^\/data\/preparation\/(?:source|edit|dataset)\/([A-Za-z0-9_-]{1,128})$/, 'prep'],
    ] as [RegExp, EmbedRouteArea][] : []),
  ];
  for (const [pattern, area] of routes) {
    const match = pattern.exec(path);
    if (match) return { path, area, ...(match[1] ? { id: match[1] } : {}) };
  }
}

export type EmbedCell = string | number | boolean | null;
export type EmbedValues = Record<string, EmbedCell>;
export type EmbedFilters = Record<string, (string | number)[]>;
export interface EmbedCustomAction { id: string; label: string; columns: string[] }
export type EmbedDataEvent =
  | { type: 'customAction'; visualId: string; actionId: string; values: EmbedValues }
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

function list<T>(value: unknown, maximum: number, valid: (entry: unknown) => entry is T): value is T[] {
  return Array.isArray(value) && value.length <= maximum && Object.keys(value).length === value.length && Array.from(value).every(valid);
}

export function isCustomActions(value: unknown): value is EmbedCustomAction[] {
  const action = (item: unknown): item is EmbedCustomAction => record(item) && exact(item, 'id', 'label', 'columns')
    && id(item.id) && name(item.label) && !!item.label.trim() && list(item.columns, 64, name)
    && item.columns.length > 0 && new Set(item.columns).size === item.columns.length;
  return list(value, 32, action) && new Set(value.map(item => item.id)).size === value.length;
}

export function isEmbedDataEvent(value: unknown, customActions: readonly EmbedCustomAction[] = []): value is EmbedDataEvent {
  if (!record(value)) return false;
  switch (value.type) {
    case 'customAction': {
      const action = customActions.find(item => item.id === value.actionId);
      return !!action && exact(value, 'type', 'visualId', 'actionId', 'values') && id(value.visualId)
        && record(value.values) && exact(value.values, ...action.columns) && values(value.values);
    }
    case 'selection': return exact(value, 'type', 'visualId', 'values') && id(value.visualId) && values(value.values);
    case 'filterState': return exact(value, 'type', 'filters') && record(value.filters) && Object.entries(value.filters).every(([key, v]) => name(key) && filterValues(v));
    case 'navigation': return exact(value, 'type', 'path') && !!embedRoute(value.path);
    case 'save': return exact(value, 'type', 'analysisId', 'version') && id(value.analysisId) && Number.isSafeInteger(value.version) && Number(value.version) >= 1;
    default: return false;
  }
}

export function isDataMessage(value: unknown, sessionId: string, channelId: string, customActions: readonly EmbedCustomAction[] = []): value is { payload: EmbedDataEvent } {
  return record(value) && exact(value, 'version', 'type', 'sessionId', 'channelId', 'payload') && value.version === 2
    && value.type === 'opensight:data' && value.sessionId === sessionId && value.channelId === channelId && isEmbedDataEvent(value.payload, customActions);
}

export type EmbedHostAction =
  | { type: 'setFilter'; filterId: string; values: (string | number)[] }
  | { type: 'navigate'; path: string }
  | { type: 'refresh' };

export function isHostAction(value: unknown): value is EmbedHostAction {
  if (!record(value)) return false;
  switch (value.type) {
    case 'setFilter': return exact(value, 'type', 'filterId', 'values') && name(value.filterId) && filterValues(value.values);
    case 'navigate': return exact(value, 'type', 'path') && !!embedRoute(value.path);
    case 'refresh': return exact(value, 'type');
    default: return false;
  }
}

export function isActionMessage(value: unknown, sessionId: string, channelId: string): value is { payload: EmbedHostAction } {
  return record(value) && exact(value, 'version', 'type', 'sessionId', 'channelId', 'payload') && value.version === 2
    && value.type === 'opensight:action' && value.sessionId === sessionId && value.channelId === channelId && isHostAction(value.payload);
}
