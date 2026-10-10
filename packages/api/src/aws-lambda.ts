import { createRuntime } from './runtime.js';
import { createPrivateRuntime } from './runtime-private.js';
import { runtimeError } from './runtime-ingress.js';
import { MetadataError } from './metadata-db.js';
import { InvocationScope, invocationDeadline, type InvocationContext } from './runtime-scope.js';
import { InvocationAws, awsEnvironment } from './runtime-aws.js';

export async function handler(event: unknown, context: InvocationContext) {
  try { return await new InvocationScope(invocationDeadline(context)).run(async scope => {
    const env = await awsEnvironment(new InvocationAws(scope, process.env), process.env);
    return createRuntime(() => env).lambda(event, context);
  }); } catch (error) { return runtimeError(error); }
}
export async function scheduler(event: unknown, context: InvocationContext) {
  try { return await new InvocationScope(invocationDeadline(context, Date.now(), 110000)).run(async scope => {
    const env = await awsEnvironment(new InvocationAws(scope, process.env), process.env);
    return createPrivateRuntime(() => env).scheduler(event, context);
  }); } catch (error) { throw error instanceof MetadataError ? error : new MetadataError('AWS_RUNTIME_FAILED', 503); }
}
export async function migration(event: unknown, context: InvocationContext) {
  try { return await new InvocationScope(invocationDeadline(context, Date.now(), 110000)).run(async scope => {
    const env = await awsEnvironment(new InvocationAws(scope, process.env), process.env, true);
    return createPrivateRuntime(() => env).migration(event, context);
  }); } catch (error) { throw error instanceof MetadataError ? error : new MetadataError('AWS_RUNTIME_FAILED', 503); }
}
