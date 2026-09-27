import type { BoundColumn } from './types.js';
import type { ParameterValue } from './parameters.js';
import { validDateTime } from './parameters.js';
import { fail, quoteIdentifier as q } from './validation.js';

export interface SecurityUser { id: string; namespaceId: string }
export interface SecurityGroup { id: string; namespaceId: string; userIds: string[] }
export interface RulePrincipal { type: 'user' | 'group'; id: string }
export type RowPredicate = { all: RowPredicate[] } | { any: RowPredicate[] }
  | { column: string; operator: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte'; value: ParameterValue }
  | { column: string; operator: 'in'; values: ParameterValue[] }
  | { column: string; operator: 'is-null' | 'is-not-null' };
export interface RowRule { id: string; principals: RulePrincipal[]; predicate: RowPredicate }
export interface DatasetPolicy { namespaceId: string; dataSetArn: string; rowLevel: boolean; rowRules: RowRule[] }
/** Trusted server configuration, never accepted from query HTTP bodies or imported assets. */
export interface SecurityContext {
  namespaceId: string;
  userId?: string;
  users: SecurityUser[];
  groups: SecurityGroup[];
  policy: DatasetPolicy;
}
function invalid(path: string, message: string): never { return fail('INVALID_SECURITY_POLICY', path, message); }
export function securityObject(raw: unknown, allowed: string[], path: string): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(k => !allowed.includes(k))) invalid(path, 'expected an object with supported properties');
  return raw as Record<string, unknown>;
}
export function securityId(raw: unknown, path: string): string {
  if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/.test(raw)) invalid(path, 'invalid resource ID');
  return raw;
}
function list(raw: unknown, path: string, nonempty = false): unknown[] {
  if (!Array.isArray(raw) || raw.length > 256 || nonempty && !raw.length) invalid(path, 'expected a bounded array');
  return raw;
}
export function validatePrincipals(raw: unknown, path: string): RulePrincipal[] {
  const seen = new Set<string>();
  return list(raw, path, true).map((value, i) => {
    const p = `${path}[${i}]`, r = securityObject(value, ['type', 'id'], p);
    if (r.type !== 'user' && r.type !== 'group') invalid(p, 'expected user or group');
    const id = securityId(r.id, `${p}.id`), key = `${r.type}/${id}`;
    if (seen.has(key)) invalid(p, 'duplicate principal'); seen.add(key);
    return { type: r.type, id };
  });
}
export function validateRowRule(raw: unknown, columns: readonly BoundColumn[]): RowRule {
  const r = securityObject(raw, ['id', 'principals', 'predicate'], '$.rule');
  let count = 0;
  const predicate = (raw: unknown, path: string, depth = 0): RowPredicate => {
    if (++count > 256 || depth > 16) invalid(path, 'predicate exceeds complexity limit');
    const p = securityObject(raw, ['all', 'any', 'column', 'operator', 'value', 'values'], path);
    if ('all' in p || 'any' in p) {
      const key = 'all' in p ? 'all' : 'any';
      securityObject(p, [key], path);
      const children = list(p[key], path, true).map((v, i) => predicate(v, `${path}.${key}[${i}]`, depth + 1));
      return key === 'all' ? { all: children } : { any: children };
    }
    const column = columns.find(c => c.name === p.column);
    if (!column) invalid(`${path}.column`, 'unknown physical column');
    const value = (v: unknown): ParameterValue => {
      if (column.scalarType === 'number' ? typeof v !== 'number' || !Number.isFinite(v)
        : typeof v !== 'string' || v.includes('\0') || v.length > 10000 || column.scalarType === 'datetime' && !validDateTime(v)) invalid(path, 'predicate value does not match column type');
      return v as ParameterValue;
    };
    if (p.operator === 'is-null' || p.operator === 'is-not-null') {
      securityObject(p, ['column', 'operator'], path);
      return { column: column.name, operator: p.operator };
    }
    if (p.operator === 'in') {
      securityObject(p, ['column', 'operator', 'values'], path);
      return { column: column.name, operator: 'in', values: list(p.values, path, true).map(value) };
    }
    if (!['eq', 'ne', 'lt', 'lte', 'gt', 'gte'].includes(String(p.operator))) invalid(path, 'unsupported predicate operator');
    securityObject(p, ['column', 'operator', 'value'], path);
    return { column: column.name, operator: p.operator as 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte', value: value(p.value) };
  };
  return { id: securityId(r.id, '$.rule.id'), principals: validatePrincipals(r.principals, '$.rule.principals'), predicate: predicate(r.predicate, '$.rule.predicate') };
}
export function validatePolicy(raw: unknown, columns: readonly BoundColumn[]): DatasetPolicy {
  const p = securityObject(raw, ['namespaceId', 'dataSetArn', 'rowLevel', 'rowRules'], '$.security.policy');
  if (typeof p.dataSetArn !== 'string' || !p.dataSetArn || p.dataSetArn.includes('\0') || typeof p.rowLevel !== 'boolean') invalid('$.security.policy', 'explicit dataset binding and rowLevel required');
  const rowRules = list(p.rowRules, '$.security.policy.rowRules').map(r => validateRowRule(r, columns));
  if (new Set(rowRules.map(r => r.id)).size !== rowRules.length || !p.rowLevel && rowRules.length) invalid('$.security.policy', 'duplicate rules or rules on an unprotected dataset');
  return { namespaceId: securityId(p.namespaceId, '$.security.policy.namespaceId'), dataSetArn: p.dataSetArn, rowLevel: p.rowLevel, rowRules };
}
export function resolveSecurity(raw: unknown, columns: readonly BoundColumn[], dataSetArn: string): RowPredicate | undefined {
  const s = securityObject(raw, ['namespaceId', 'userId', 'users', 'groups', 'policy'], '$.security');
  const namespaceId = securityId(s.namespaceId, '$.security.namespaceId');
  if (s.userId === undefined) fail('PRINCIPAL_REQUIRED', '$.security.userId', 'an authenticated principal is required');
  const userId = securityId(s.userId, '$.security.userId');
  const users = list(s.users, '$.security.users').map(raw => {
    const u = securityObject(raw, ['id', 'namespaceId'], '$.security.users');
    return { id: securityId(u.id, '$.security.users.id'), namespaceId: securityId(u.namespaceId, '$.security.users.namespaceId') };
  });
  if (new Set(users.map(u => `${u.namespaceId}/${u.id}`)).size !== users.length) invalid('$.security.users', 'duplicate user');
  if (!users.some(u => u.id === userId && u.namespaceId === namespaceId)) fail('UNKNOWN_PRINCIPAL', '$.security.userId', 'principal does not resolve in this namespace');
  const groups = list(s.groups, '$.security.groups').map(raw => {
    const g = securityObject(raw, ['id', 'namespaceId', 'userIds'], '$.security.groups');
    const group = { id: securityId(g.id, '$.security.groups.id'), namespaceId: securityId(g.namespaceId, '$.security.groups.namespaceId'), userIds: list(g.userIds, '$.security.groups.userIds').map(v => securityId(v, '$.security.groups.userIds')) };
    if (new Set(group.userIds).size !== group.userIds.length || group.userIds.some(id => !users.some(u => u.id === id && u.namespaceId === group.namespaceId))) fail('UNKNOWN_PRINCIPAL', '$.security.groups', 'group membership does not resolve');
    return group;
  });
  if (new Set(groups.map(g => `${g.namespaceId}/${g.id}`)).size !== groups.length) invalid('$.security.groups', 'duplicate group');
  const policy = validatePolicy(s.policy, columns);
  if (policy.namespaceId !== namespaceId || policy.dataSetArn !== dataSetArn) fail('NAMESPACE_ACCESS_DENIED', '$.security.policy', 'policy does not resolve in this namespace and dataset');
  for (const rule of policy.rowRules) for (const p of rule.principals) {
    if (!(p.type === 'user' ? users : groups).some(v => v.id === p.id && v.namespaceId === namespaceId)) fail('UNKNOWN_PRINCIPAL', '$.security.policy', 'rule principal does not resolve');
  }
  if (!policy.rowLevel) return undefined;
  const matches = policy.rowRules.filter(r => r.principals.some(p => p.type === 'user' ? p.id === userId : groups.some(g => g.namespaceId === namespaceId && g.id === p.id && g.userIds.includes(userId))));
  if (!matches.length) fail('ROW_ACCESS_DENIED', '$.security.policy', 'protected dataset has no matching row rule');
  return { any: matches.map(r => r.predicate) };
}
export function rowSecuritySql(predicate: RowPredicate, columns: readonly BoundColumn[], bind: (value: ParameterValue) => string): string {
  const compile = (p: RowPredicate): string => {
    if ('all' in p) return `(${p.all.map(compile).join(' AND ')})`;
    if ('any' in p) return `(${p.any.map(compile).join(' OR ')})`;
    const column = q(p.column), type = columns.find(c => c.name === p.column)!.scalarType;
    const parameter = (v: ParameterValue) => type === 'datetime' ? `CAST(${bind(v)} AS TIMESTAMP)` : bind(v);
    if (p.operator === 'is-null' || p.operator === 'is-not-null') return `${column} IS ${p.operator === 'is-null' ? '' : 'NOT '}NULL`;
    if (p.operator === 'in') return `${column} IN (${p.values.map(parameter).join(', ')})`;
    if ('value' in p) return `${column} ${{ eq: '=', ne: '<>', lt: '<', lte: '<=', gt: '>', gte: '>=' }[p.operator]} ${parameter(p.value)}`;
    return fail('INVALID_SECURITY_POLICY', '$.security', 'unsupported predicate');
  };
  return compile(predicate);
}
