// The managed Node 24 runtime supplies AWS SDK v3. No SDK is bundled here.
// The guard never receives tester credentials or connects to the database.
export async function guard(event, io, config) {
  if (!/^[a-f0-9-]{36}$/.test(event?.operationId ?? '')) throw Error('WATCHDOG_OPERATION_INVALID');
  const record = await io.read();
  if (!record || record.operationId !== event.operationId || ['complete', 'rolled-back'].includes(record.phase)) return { stopped: false };
  const stopped = await Promise.allSettled(config.functions.map(name => io.stop(name)));
  const disabled = await Promise.allSettled(config.mappings.map(id => io.disable(id)));
  if ([...stopped, ...disabled].some(r => r.status === 'rejected')) throw Error('WATCHDOG_STOP_INCOMPLETE');
  return { stopped: true };
}
export async function handler(event) {
  const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const { LambdaClient, PutFunctionConcurrencyCommand, UpdateEventSourceMappingCommand } = await import('@aws-sdk/client-lambda');
  const config = JSON.parse(process.env.OPENSIGHT_GUARD_CONFIG);
  const s3 = new S3Client({ maxAttempts: 3 }), lambda = new LambdaClient({ maxAttempts: 3 });
  return guard(event, {
    async read() {
      try { const r = await s3.send(new GetObjectCommand({ Bucket: config.bucket, Key: 'ci/operations/active.json' })); return JSON.parse(await r.Body.transformToString()); }
      catch (e) { if (e.name === 'NoSuchKey') return null; throw Error('WATCHDOG_RECORD_UNAVAILABLE'); }
    },
    stop: name => lambda.send(new PutFunctionConcurrencyCommand({ FunctionName: name, ReservedConcurrentExecutions: 0 })),
    disable: id => lambda.send(new UpdateEventSourceMappingCommand({ UUID: id, Enabled: false })),
  }, config);
}
