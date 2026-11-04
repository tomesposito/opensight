import { randomBytes } from 'node:crypto';
import { MetadataError } from './metadata-db.js';
import { identifier, object } from './metadata-resources.js';
import type { Schedule } from './schedule.js';

export interface DigestSpec {
  kind: 'digest'; destination: 'self' | 'shared'; metricId: string; subscriberId: string; cadence: 'weekly' | 'daily';
  timeColumn: string; dimensions: string[]; recipients: string[]; enabled: boolean;
  schedule: Schedule; unsubscribeToken: string;
}
const field = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > 512 || /[\x00-\x1f]/.test(value)) throw new MetadataError('DIGEST_FIELD_INVALID', 400);
  return value;
};
export type DigestDestination = { kind: 'self' } | { kind: 'shared'; recipientIds: string[] };
function recipientIds(raw: unknown): string[] {
  if (!Array.isArray(raw) || !raw.length || raw.length > 50 || new Set(raw).size !== raw.length) throw new MetadataError('DIGEST_SHARED_RECIPIENT_INVALID', 422);
  try { return raw.map(identifier); }
  catch { throw new MetadataError('DIGEST_SHARED_RECIPIENT_INVALID', 422); }
}
export function digestInput(raw: unknown): { cadence: DigestSpec['cadence']; timeColumn: string; dimensions: string[]; destination: DigestDestination } {
  const b = object(raw, ['cadence', 'timeColumn', 'dimensions', 'destination']);
  const cadence = b.cadence ?? 'weekly';
  if (cadence !== 'weekly' && cadence !== 'daily') throw new MetadataError('DIGEST_CADENCE_INVALID', 400);
  if (!Array.isArray(b.dimensions) || b.dimensions.length > 20 || new Set(b.dimensions).size !== b.dimensions.length) throw new MetadataError('DIGEST_DIMENSIONS_INVALID', 400);
  const timeColumn = field(b.timeColumn), dimensions = b.dimensions.map(field);
  if (dimensions.includes(timeColumn)) throw new MetadataError('DIGEST_DIMENSIONS_INVALID', 400);
  const d = object(b.destination ?? { kind: 'self' });
  let destination: DigestDestination;
  if (d.kind === 'self') { object(d, ['kind']); destination = { kind: 'self' }; }
  else if (d.kind === 'shared') { object(d, ['kind', 'recipientIds']); destination = { kind: 'shared', recipientIds: recipientIds(d.recipientIds) }; }
  else throw new MetadataError('DIGEST_DESTINATION_INVALID', 422);
  return { cadence, timeColumn, dimensions, destination };
}
export function digestSchedule(cadence: DigestSpec['cadence']): Schedule {
  return cadence === 'weekly' ? { kind: 'weekly', at: '09:00', timeZone: 'UTC', weekday: 1 } : { kind: 'daily', at: '09:00', timeZone: 'UTC' };
}
export function newDigest(metricId: string, subscriberId: string, raw: unknown): DigestSpec {
  const { cadence, timeColumn, dimensions, destination } = digestInput(raw);
  return { kind: 'digest', destination: destination.kind, metricId: identifier(metricId), subscriberId: identifier(subscriberId), cadence, timeColumn, dimensions,
    recipients: destination.kind === 'shared' ? destination.recipientIds : [subscriberId], enabled: true, schedule: digestSchedule(cadence), unsubscribeToken: randomBytes(32).toString('hex') };
}
/** Stored specs cannot smuggle arbitrary schedules, personal recipients or destinations. */
export function digestSpec(raw: unknown): DigestSpec {
  const b = object(raw, ['kind', 'destination', 'metricId', 'subscriberId', 'cadence', 'timeColumn', 'dimensions', 'recipients', 'enabled', 'schedule', 'unsubscribeToken']);
  const input = digestInput({ cadence: b.cadence, timeColumn: b.timeColumn, dimensions: b.dimensions });
  const subscriberId = identifier(b.subscriberId), schedule = digestSchedule(input.cadence);
  // Existing personal subscriptions predate the explicit discriminator.
  const destination = b.destination ?? 'self';
  if (destination !== 'self' && destination !== 'shared') throw new MetadataError('DIGEST_SUBSCRIPTION_INVALID', 400);
  const recipients = destination === 'shared' ? recipientIds(b.recipients) : b.recipients;
  if (b.kind !== 'digest' || b.enabled !== true || !Array.isArray(recipients) || destination === 'self' && (recipients.length !== 1 || recipients[0] !== subscriberId)
    || JSON.stringify(b.schedule) !== JSON.stringify(schedule) || typeof b.unsubscribeToken !== 'string' || !/^[a-f0-9]{64}$/.test(b.unsubscribeToken)) throw new MetadataError('DIGEST_SUBSCRIPTION_INVALID', 400);
  return { kind: 'digest', destination, metricId: identifier(b.metricId), subscriberId, cadence: input.cadence, timeColumn: input.timeColumn, dimensions: input.dimensions,
    recipients, enabled: true, schedule, unsubscribeToken: b.unsubscribeToken };
}
