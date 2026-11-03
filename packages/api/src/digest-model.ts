import { randomBytes } from 'node:crypto';
import { MetadataError } from './metadata-db.js';
import { identifier, object } from './metadata-resources.js';
import type { Schedule } from './schedule.js';

export interface DigestSpec {
  kind: 'digest'; metricId: string; subscriberId: string; cadence: 'weekly' | 'daily';
  timeColumn: string; dimensions: string[]; recipients: string[]; enabled: boolean;
  schedule: Schedule; unsubscribeToken: string;
}
const field = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > 512 || /[\x00-\x1f]/.test(value)) throw new MetadataError('DIGEST_FIELD_INVALID', 400);
  return value;
};
export function digestInput(raw: unknown): { cadence: DigestSpec['cadence']; timeColumn: string; dimensions: string[]; destination: unknown } {
  const b = object(raw, ['cadence', 'timeColumn', 'dimensions', 'destination']);
  const cadence = b.cadence ?? 'weekly';
  if (cadence !== 'weekly' && cadence !== 'daily') throw new MetadataError('DIGEST_CADENCE_INVALID', 400);
  if (!Array.isArray(b.dimensions) || b.dimensions.length > 20 || new Set(b.dimensions).size !== b.dimensions.length) throw new MetadataError('DIGEST_DIMENSIONS_INVALID', 400);
  const timeColumn = field(b.timeColumn), dimensions = b.dimensions.map(field);
  if (dimensions.includes(timeColumn)) throw new MetadataError('DIGEST_DIMENSIONS_INVALID', 400);
  return { cadence, timeColumn, dimensions, destination: b.destination };
}
export function digestSchedule(cadence: DigestSpec['cadence']): Schedule {
  return cadence === 'weekly' ? { kind: 'weekly', at: '09:00', timeZone: 'UTC', weekday: 1 } : { kind: 'daily', at: '09:00', timeZone: 'UTC' };
}
export function newDigest(metricId: string, subscriberId: string, raw: unknown): DigestSpec {
  const { cadence, timeColumn, dimensions } = digestInput(raw);
  return { kind: 'digest', metricId: identifier(metricId), subscriberId: identifier(subscriberId), cadence, timeColumn, dimensions,
    recipients: [subscriberId], enabled: true, schedule: digestSchedule(cadence), unsubscribeToken: randomBytes(32).toString('hex') };
}
/** Stored specs cannot smuggle arbitrary schedules, personal recipients or destinations. */
export function digestSpec(raw: unknown): DigestSpec {
  const b = object(raw, ['kind', 'metricId', 'subscriberId', 'cadence', 'timeColumn', 'dimensions', 'recipients', 'enabled', 'schedule', 'unsubscribeToken']);
  const input = digestInput({ cadence: b.cadence, timeColumn: b.timeColumn, dimensions: b.dimensions });
  const subscriberId = identifier(b.subscriberId), schedule = digestSchedule(input.cadence);
  if (b.kind !== 'digest' || b.enabled !== true || !Array.isArray(b.recipients) || b.recipients.length !== 1 || b.recipients[0] !== subscriberId
    || JSON.stringify(b.schedule) !== JSON.stringify(schedule) || typeof b.unsubscribeToken !== 'string' || !/^[a-f0-9]{64}$/.test(b.unsubscribeToken)) throw new MetadataError('DIGEST_SUBSCRIPTION_INVALID', 400);
  return { kind: 'digest', metricId: identifier(b.metricId), subscriberId, cadence: input.cadence, timeColumn: input.timeColumn, dimensions: input.dimensions,
    recipients: [subscriberId], enabled: true, schedule, unsubscribeToken: b.unsubscribeToken };
}
