import type { IncomingMessage, ServerResponse } from 'node:http';
import { QueryEngineError, validatePolicy, validateRowRule, validateColumnGrant, type BoundColumn, type DatasetPolicy, type SecurityContext, type SecurityGroup, type SecurityUser } from '@opensight/query-engine';
import { AutomationStore } from './automation-store.js';
import { method, routeId, send } from './automation-routes.js';
import { id, record, invalid } from './schedule.js';
import { readBody, RequestError } from './query.js';

export interface Identity { namespaceId: string; userId: string }
export interface User extends SecurityUser { name: string; role: 'admin' | 'reader' }
export interface Group extends SecurityGroup { name: string }
export interface SecurityState {
  version: 1;
  namespaces: { id: string; name: string }[];
  users: User[];
  groups: Group[];
  datasets: (DatasetPolicy & { datasetId: string })[];
}
export interface SecurityOptions {
  /** Verify credentials server-side. Never resolve identity from user/group headers or query bodies. */
  authenticate(request: IncomingMessage): Identity | undefined | Promise<Identity | undefined>;
  initialState: SecurityState;
  storePath?: string;
}
export class SecurityError extends RequestError {
  constructor(status: number, readonly code: string, message: string) { super(status, message); this.name = 'SecurityError'; }
}
export const emptySecurityState = (): SecurityState => ({ version: 1, namespaces: [{ id: 'default', name: 'Default' }], users: [], groups: [], datasets: [] });
function name(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 512 || /[\x00-\x1f]/.test(raw)) invalid('$.name', 'expected a name');
  return raw;
}
function rows(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw) || raw.length > 256) invalid('$', 'expected at most 256 resources');
  return raw as Record<string, unknown>[];
}
export function validateSecurityState(raw: unknown, columns: readonly BoundColumn[]): SecurityState {
  const s = record(raw, ['version', 'namespaces', 'users', 'groups', 'datasets']);
  if (s.version !== 1) invalid('$.version', 'expected 1');
  const namespaces = rows(s.namespaces).map(r => { record(r, ['id', 'name']); return { id: id(r.id, '$.id'), name: name(r.name) }; });
  const users = rows(s.users).map(r => {
    record(r, ['id', 'namespaceId', 'name', 'role']);
    if (r.role !== 'admin' && r.role !== 'reader') invalid('$.role', 'expected admin or reader');
    return { id: id(r.id, '$.id'), namespaceId: id(r.namespaceId, '$.namespaceId'), name: name(r.name), role: r.role } as User;
  });
  const groups = rows(s.groups).map(r => {
    record(r, ['id', 'namespaceId', 'name', 'userIds']);
    if (!Array.isArray(r.userIds) || r.userIds.length > 256) invalid('$.userIds', 'expected user IDs');
    return { id: id(r.id, '$.id'), namespaceId: id(r.namespaceId, '$.namespaceId'), name: name(r.name), userIds: r.userIds.map(v => id(v, '$.userIds')) };
  });
  const datasets = rows(s.datasets).map(r => {
    const { datasetId, ...policy } = r;
    return { datasetId: id(datasetId, '$.datasetId'), ...validatePolicy(policy, columns) };
  });
  for (const list of [namespaces, users, groups, datasets]) {
    const keys = list.map(r => `${'namespaceId' in r ? r.namespaceId : ''}/${'id' in r ? r.id : r.datasetId}`);
    if (new Set(keys).size !== keys.length) invalid('$', 'duplicate resource');
  }
  for (const r of [...users, ...groups, ...datasets]) if (!namespaces.some(n => n.id === r.namespaceId)) invalid('$.namespaceId', 'unknown namespace');
  for (const g of groups) if (new Set(g.userIds).size !== g.userIds.length || g.userIds.some(id => !users.some(u => u.id === id && u.namespaceId === g.namespaceId))) invalid('$.userIds', 'unresolved or duplicate user');
  for (const d of datasets) for (const rule of [...d.rowRules, ...(d.columnGrants ?? [])]) for (const p of rule.principals) {
    if (!(p.type === 'user' ? users : groups).some(v => v.id === p.id && v.namespaceId === d.namespaceId)) invalid('$.principals', 'unresolved principal');
  }
  return { version: 1, namespaces, users, groups, datasets };
}
export class SecurityService {
  hasAssets: (namespaceId: string) => boolean = () => false;
  private constructor(readonly store: AutomationStore<SecurityState>, private readonly options: SecurityOptions, readonly columns: readonly BoundColumn[], readonly dataSetArn: string) {}
  static async load(options: SecurityOptions, columns: readonly BoundColumn[], dataSetArn: string): Promise<SecurityService> {
    const validate = (raw: unknown) => validateSecurityState(raw, columns);
    const store = await AutomationStore.load(validate(options.initialState), options.storePath, validate);
    if (store.read().datasets.some(d => d.datasetId !== 'sales' || d.dataSetArn !== dataSetArn)) throw new Error('Unresolved security dataset binding');
    return new SecurityService(store, options, columns, dataSetArn);
  }
  async authenticate(request: IncomingMessage): Promise<Identity> {
    if (['x-user-id', 'x-principal', 'x-groups', 'x-namespace-id'].some(k => request.headers[k] !== undefined)) throw new SecurityError(403, 'FORGED_PRINCIPAL', 'Caller-supplied principal headers are not supported');
    let identity: Identity | undefined;
    try { identity = await this.options.authenticate(request); }
    catch { throw new SecurityError(401, 'UNKNOWN_PRINCIPAL', 'Credentials could not be resolved'); }
    if (!identity) throw new SecurityError(401, request.headers.authorization ? 'UNKNOWN_PRINCIPAL' : 'PRINCIPAL_REQUIRED', 'Authenticated principal required');
    if (!this.store.read().users.some(u => u.id === identity.userId && u.namespaceId === identity.namespaceId)) throw new SecurityError(403, 'UNKNOWN_PRINCIPAL', 'Principal does not resolve');
    return { namespaceId: identity.namespaceId, userId: identity.userId };
  }
  admin(identity: Identity, state = this.store.read()): void {
    if (!state.users.some(u => u.id === identity.userId && u.namespaceId === identity.namespaceId && u.role === 'admin')) throw new SecurityError(403, 'SECURITY_ADMIN_REQUIRED', 'Namespace administrator required');
  }
  context(identity?: Identity): SecurityContext {
    const state = this.store.read(), namespaceId = identity?.namespaceId ?? 'default';
    const stored = state.datasets.find(d => d.namespaceId === namespaceId && d.datasetId === 'sales');
    const policy = stored ? (({ datasetId, ...policy }) => policy)(stored) : { namespaceId, dataSetArn: this.dataSetArn, rowLevel: false, rowRules: [] };
    return { namespaceId, userId: identity?.userId, users: state.users.map(({ id, namespaceId }) => ({ id, namespaceId })), groups: state.groups.map(({ id, namespaceId, userIds }) => ({ id, namespaceId, userIds })),
      policy };
  }
  async route(request: IncomingMessage, response: ServerResponse, path: string, query: string, identity: Identity): Promise<boolean> {
    const match = /^\/api\/datasets\/([^/]+)\/(row-rules|column-grants)(?:\/([^/]+))?$/.exec(path);
    if (!match) return false;
    if (query) throw new RequestError(400, 'Query parameters are not supported');
    this.admin(identity);
    if (routeId(match[1]!) !== 'sales') throw new RequestError(404, 'Dataset not found');
    const columnMode = match[2] === 'column-grants';
    const ruleId = match[3] === undefined ? undefined : routeId(match[3]);
    const verb = method(request, response, ruleId ? ['GET', 'PUT', 'DELETE'] : ['GET']);
    const policy = this.context(identity).policy;
    if (verb === 'GET') {
      const resources = columnMode ? policy.columnGrants ?? [] : policy.rowRules;
      const result = ruleId ? resources.find(r => r.id === ruleId) : resources;
      if (!result) throw new RequestError(404, 'Row rule not found');
      send(response, 200, result); return true;
    }
    const raw = verb === 'PUT' ? record(await readBody(request), columnMode ? ['principals', 'column', 'effect'] : ['principals', 'predicate']) : undefined;
    try {
      const rule = raw && !columnMode ? validateRowRule({ ...raw, id: ruleId }, this.columns) : undefined;
      const grant = raw && columnMode ? validateColumnGrant({ ...raw, id: ruleId }, this.columns) : undefined;
      await this.store.change(state => {
        this.admin(identity, state);
        let dataset = state.datasets.find(d => d.namespaceId === identity.namespaceId && d.datasetId === 'sales');
        if (!dataset) { dataset = { ...policy, datasetId: 'sales' }; state.datasets.push(dataset); }
        if (columnMode) {
          if (!grant && !dataset.columnGrants?.some(g => g.id === ruleId)) throw new RequestError(404, 'Column grant not found');
          dataset.columnGrants = (dataset.columnGrants ?? []).filter(g => g.id !== ruleId);
          if (grant) {
            dataset.columnGrants.push(grant);
            dataset.protectedColumns = [...new Set([...(dataset.protectedColumns ?? []), grant.column])];
          }
        } else {
        if (!rule && !dataset.rowRules.some(r => r.id === ruleId)) throw new RequestError(404, 'Row rule not found');
        dataset.rowRules = dataset.rowRules.filter(r => r.id !== ruleId);
        dataset.rowLevel = true;
        if (rule) dataset.rowRules.push(rule);
        }
        validateSecurityState(state, this.columns);
      });
      send(response, 200, rule ?? grant ?? { deleted: true });
    } catch (error) {
      if (error instanceof QueryEngineError) throw new SecurityError(400, error.code, error.message);
      throw error;
    }
    return true;
  }
}
