import type { SqlConnection } from './metadata-db.js';
import { checksum } from './metadata-operator.js';
import type { EventInput } from './dispatch.js';
import type { Job, Occurrence } from './job-schema.js';

/** Immutable mapping avoids shortening caller IDs or reusing a recurring event identity. */
export async function jobDueEvent(c: SqlConnection, deployment: string, job: Job): Promise<EventInput[]> {
  if (job.stopped || !job.spec.enabled || job.spec.kind === 'alert' || !job.nextRun) return [];
  const dueAt = Date.parse(job.nextRun), id = checksum([deployment, job.tenantId, job.namespaceId, job.ownerId, job.id, job.version, dueAt]);
  await c.query('INSERT INTO sr_job_due VALUES (?,?,?,?,?,?,?,?) ON CONFLICT (deployment, due_id) DO NOTHING',
    [deployment, id, job.tenantId, job.namespaceId, job.ownerId, job.id, job.version, dueAt]);
  return [{ aggregateId: id, aggregateRevision: job.version, kind: 'job-due', dueAt, expiresAt: dueAt + 86400000 }];
}
export function jobExecutionEvent(run: Occurrence, now: number): EventInput {
  return { aggregateId: run.id, aggregateRevision: run.jobVersion, kind: 'job-execute', dueAt: now, expiresAt: now + 86400000 };
}
