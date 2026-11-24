import type { Database } from './metadata-db.js';
import { MetadataError } from './metadata-db.js';
import type { TenantContext } from './metadata.js';
import { appendOperatorAudit } from './operator-audit.js';
import { v1AuditOperations } from './v1-audit-operations.js';

const routes = v1AuditOperations.map(operation => ({ ...operation,
  parts: operation.path.split('/'),
})).sort((a, b) => a.parts.filter(p => p.startsWith('{')).length - b.parts.filter(p => p.startsWith('{')).length);

/** Only contract literals and validated resource IDs enter the log, never raw URLs. */
export function workspaceAuditAction(method: string, path: string): { action: string; operationId?: string; subject?: string } | undefined {
  if (!path.startsWith('/api/v1/')) return undefined;
  if (method === 'GET' && path === '/api/v1/workspace/action-history') return undefined;
  const parts = path.slice('/api/v1'.length).split('/');
  const matches = routes.filter(route => route.parts.length === parts.length && route.parts.every((part, index) =>
    part.startsWith('{') ? /^[A-Za-z0-9_-]{1,512}$/.test(parts[index]!) : part === parts[index]));
  const route = matches.find(candidate => candidate.method === method) ?? matches[0];
  // Unknown routes have no trusted template; do not copy arbitrary caller text.
  const safeMethod = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(method) ? method : 'OTHER';
  if (!route) return { action: `${safeMethod} /api/v1/{unmatched}` };
  const index = route.parts.indexOf('{id}');
  const subject = index < 0 ? undefined : parts[index];
  return { action: route.method === method ? route.operationId : `${safeMethod} /api/v1${route.path}`,
    ...(route.method === method ? { operationId: route.operationId } : {}), ...(subject ? { subject } : {}) };
}

/** A separate transaction also retains denied/rolled-back attempts. Never change the action response. */
export async function recordWorkspaceAction(db: Database, context: TenantContext,
  action: NonNullable<ReturnType<typeof workspaceAuditAction>>, method: string, status: number): Promise<void> {
  try {
    await db.transaction(c => appendOperatorAudit(c, { actor: context.userId, tenantId: context.tenantId,
      action: action.action, subject: action.subject,
      detail: { ...(action.operationId ? { operationId: action.operationId } : {}),
        method: /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(method) ? method : 'OTHER',
        outcome: status < 400 ? 'success' : status < 500 ? 'denied' : 'failed', status },
    }));
  } catch (error) {
    // Startup verifies the migration. Later storage failures stay observable,
    // with no database error text, SQL, credentials or request contents logged.
    const code = error instanceof MetadataError && ['AUDIT_SCHEMA_NOT_MIGRATED', 'AUDIT_SCHEMA_MISMATCH'].includes(error.code)
      ? error.code : 'AUDIT_APPEND_FAILED';
    console.error('WORKSPACE_AUDIT_APPEND_FAILED', code);
  }
}
