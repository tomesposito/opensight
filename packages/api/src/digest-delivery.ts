import { checksum } from './metadata-operator.js';
import type { Occurrence, JobSpec } from './job-schema.js';
/** The occurrence stores the completed-period boundary, so a delayed or retried
 * send cannot silently advance to the week/day in which the worker resumed. */
export const occurrenceTime = (run: Occurrence) => new Date(run.spec.kind === 'digest' ? run.due : run.createdAt);
export const deliveryKey = (run: Occurrence, recipient: string) => checksum([run.tenantId, run.namespaceId, run.jobId, run.spec.kind === 'digest' ? run.due : run.id, run.spec.kind === 'digest' && run.spec.destination === 'shared' ? 'shared' : recipient]);

/** The owner is only the durable FK anchor; shared addresses come from the
 * current resolved audience, never from this recipient_id. */
export const deliveryRecipients = (spec: JobSpec): string[] => spec.kind === 'refresh' ? [] : spec.kind === 'digest' && spec.destination === 'shared' ? [spec.subscriberId] : spec.recipients;
