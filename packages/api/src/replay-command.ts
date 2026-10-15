import { MetadataError } from './metadata-db.js';
import { object } from './metadata-resources.js';
import { dispatchEnvelope, type DispatchEnvelope } from './dispatch.js';

/** IAM is the caller boundary; no migration, body, scope or resource override. */
export function replayCommand(raw: unknown): { event: DispatchEnvelope; acceptAmbiguous: boolean } {
  const input = object(raw, ['version', 'event', 'acceptAmbiguous']);
  if (input.version !== 1 || typeof input.acceptAmbiguous !== 'boolean') throw new MetadataError('DISPATCH_REPLAY_DENIED', 409);
  const event = dispatchEnvelope(input.event);
  if (event.kind === 'recover') throw new MetadataError('DISPATCH_REPLAY_DENIED', 409);
  return { event, acceptAmbiguous: input.acceptAmbiguous };
}
