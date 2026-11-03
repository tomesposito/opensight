import { checksum } from './metadata-operator.js';
import type { Occurrence } from './job-schema.js';
/** The occurrence stores the completed-period boundary, so a delayed or retried
 * send cannot silently advance to the week/day in which the worker resumed. */
export const occurrenceTime = (run: Occurrence) => new Date(run.spec.kind === 'digest' ? run.due : run.createdAt);
export const deliveryKey = (run: Occurrence, recipient: string) => checksum([run.tenantId, run.namespaceId, run.jobId, run.spec.kind === 'digest' ? run.due : run.id, recipient]);
