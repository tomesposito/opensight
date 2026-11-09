import { checksum } from './metadata-operator.js';
import type { Occurrence, JobSpec } from './job-schema.js';
/** The occurrence stores the completed-period boundary, so a delayed or retried
 * send cannot silently advance to the week/day in which the worker resumed. */
export const occurrenceTime = (run: Occurrence) => new Date(run.spec.kind === 'digest' ? run.due : run.createdAt);
export const deliveryKey = (run: Occurrence, recipient: string) => checksum([run.tenantId, run.namespaceId, run.jobId, run.spec.kind === 'digest' ? run.due : run.id, run.spec.kind === 'digest' && run.spec.destination === 'shared' ? 'shared' : recipient]);

/** The owner is only the durable FK anchor; shared addresses come from the
 * current resolved audience, never from this recipient_id. */
export const deliveryRecipients = (spec: JobSpec): string[] => spec.kind === 'refresh' ? [] : spec.kind === 'digest' && spec.destination === 'shared' ? [spec.subscriberId] : spec.recipients;

/** Bounded delivery retries (#233): delivery stays at-least-once (HQ-13), but
 * one retry sequence ends after this many attempts. The delivery then lands
 * in the terminal `dead` state instead of rescheduling forever, its
 * occurrence settles, later periods are admitted again, and an operator can
 * start a new sequence for the same delivery via the retry action. */
export const MAX_DELIVERY_ATTEMPTS = 10;
/** Transient delivery outcomes that earn another attempt within a sequence. */
export const DELIVERY_RETRYABLE_CODES = ['SMTP_SEND_FAILED', 'SMTP_NOT_CONFIGURED', 'WORKER_EXECUTION_FAILED', 'TENANT_BUDGET_EXCEEDED', 'NODE_BUDGET_EXCEEDED', 'EXECUTION_CANCELLED', 'QUEUE_WAIT_EXCEEDED'];
export const isRetryableDeliveryError = (code: string): boolean => DELIVERY_RETRYABLE_CODES.includes(code);
