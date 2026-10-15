import { readFile } from 'node:fs/promises';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { MetadataError } from './metadata-db.js';
import { InvocationAws, awsEnvironment } from './runtime-aws.js';
import { InvocationScope, invocationDeadline, type InvocationContext } from './runtime-scope.js';
import { invocationDatabases } from './runtime-postgres.js';
import { pilotPlan, pilotRelease, pilotDigest, type PilotAuthority, type PilotCommand } from './pilot-release.js';

/** One temporary IAM-only, version-pinned runner. No SQL, resource names or plan overrides in the event. */
export async function handler(event: unknown, context: InvocationContext) {
  try {
    if (!event || typeof event !== 'object' || Array.isArray(event) || Object.keys(event).join() !== 'command') throw new MetadataError('PILOT_COMMAND_INVALID', 503);
    const command = (event as { command: PilotCommand }).command;
    const plan = pilotPlan(JSON.parse(process.env.OPENSIGHT_PILOT_PLAN ?? '{}'));
    return await new InvocationScope(invocationDeadline(context, Date.now(), 105000)).run(async scope => {
      const aws = new InvocationAws(scope, process.env);
      const env = await awsEnvironment(aws, { ...process.env, OPENSIGHT_POSTGRES_CA: await readFile('/var/task/rds-ca.pem', 'utf8') }, true);
      let authority: PilotAuthority | undefined;
      const get = async (key: string) => aws.call(async signal => {
        const r = await aws.s3.send(new GetObjectCommand({ Bucket: env.OPENSIGHT_OPERATIONS_BUCKET, Key: key }), { abortSignal: signal });
        return JSON.parse(await r.Body!.transformToString()) as Record<string, unknown>;
      });
      if (command !== 'inspect') {
        const lock = await get('ci/operations/active.json'), epoch = await get('maintenance/epoch.json');
        if (lock.operationId !== plan.operationId || lock.planDigest !== pilotDigest(plan) || epoch.operationId !== plan.operationId
          || epoch.planDigest !== lock.planDigest || epoch.epoch !== plan.expectedEpoch + 1) throw new MetadataError('PILOT_AUTHORITY_MISMATCH', 503);
        authority = { planDigest: String(lock.planDigest), epoch: Number(epoch.epoch), phase: String(lock.phase) };
        if (command !== 'freeze') {
          const backup = await get(`maintenance/${plan.operationId}/backup.json`);
          if (backup.operationId !== plan.operationId || backup.planDigest !== lock.planDigest || backup.status !== 'available'
            || backup.restoreEligibility !== 'held' || backup.encrypted !== true || backup.emptyObjects !== true
            || !Array.isArray(backup.keyVersions) || !backup.keyVersions.length || Number(backup.expiresAt) <= Date.now()) throw new MetadataError('PILOT_BACKUP_MISMATCH', 503);
          authority.backup = pilotDigest(backup); authority.preserved = String(backup.preserved);
        }
      }
      return pilotRelease(invocationDatabases(scope, env, 20000).membership, env, plan, command, authority);
    });
  } catch (error) { throw new MetadataError(error instanceof MetadataError ? error.code : 'PILOT_RELEASE_FAILED', 503); }
}
