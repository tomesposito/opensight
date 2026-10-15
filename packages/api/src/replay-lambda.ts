import { MetadataError } from './metadata-db.js';
import { createPrivateRuntime } from './runtime-private.js';
import { replayCommand } from './replay-command.js';
import { InvocationAws, awsEnvironment } from './runtime-aws.js';
import { InvocationScope, invocationDeadline, type InvocationContext } from './runtime-scope.js';

/** Dedicated numeric Lambda version; no function URL, API route or DDL credential. */
export async function handler(raw: unknown, context: InvocationContext) {
  replayCommand(raw); // Reject invalid calls before constructing AWS/SQL resources.
  try {
    return await new InvocationScope(invocationDeadline(context, Date.now(), 110000)).run(async scope => {
      const env = await awsEnvironment(new InvocationAws(scope, process.env), process.env);
      return createPrivateRuntime(() => env).replay(raw, context);
    });
  } catch (error) { throw new MetadataError(error instanceof MetadataError ? error.code : 'DISPATCH_REPLAY_FAILED', 503); }
}
