import { readFile } from 'node:fs/promises';
import { MetadataError } from './metadata-db.js';
import { inspectPostgres, storageScope } from './storage-inspection.js';
import { InvocationAws, databaseUrl, operatorFields } from './runtime-aws.js';
import { InvocationScope, invocationDeadline, type InvocationContext } from './runtime-scope.js';

/** Temporary private IAM-only operator runner. No HTTP integration or arbitrary SQL/event fields. */
export async function handler(event: unknown, context: InvocationContext) {
  if (!event || typeof event !== 'object' || Array.isArray(event) || Object.keys(event).sort().join() !== 'namespaceId,tenantId') throw new MetadataError('STORAGE_INSPECT_USAGE', 400);
  const input = event as { tenantId: string; namespaceId: string };
  const scope = storageScope({ ...input, deployment: process.env.OPENSIGHT_DEPLOYMENT ?? '' });
  try {
    return await new InvocationScope(invocationDeadline(context, Date.now(), 55000)).run(async invocation => {
      const aws = new InvocationAws(invocation, process.env);
      const login = await aws.secret(process.env.OPENSIGHT_OPERATOR_SECRET_ARN, operatorFields);
      const ca = await readFile(process.env.OPENSIGHT_POSTGRES_CA_FILE ?? '/var/task/rds-ca.pem', 'utf8');
      return inspectPostgres(databaseUrl(process.env, login), ca, scope);
    });
  } catch (error) { throw new MetadataError(error instanceof MetadataError ? error.code : 'STORAGE_INSPECTION_FAILED', 503); }
}
