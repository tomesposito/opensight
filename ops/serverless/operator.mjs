#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync, lstatSync, readFileSync, writeFileSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkPlan } from './plan-policy.mjs';
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export function privateDirectory(path, repo = repository) {
  if (!path || !isAbsolute(path)) throw Error('PRIVATE_PATH_REQUIRED');
  const resolved = realpathSync(path), stat = lstatSync(path), relation = relative(realpathSync(repo), resolved);
  if (stat.isSymbolicLink() || !stat.isDirectory() || !relation.startsWith('..') || (stat.mode & 0o077) || stat.uid !== process.getuid?.()) throw Error('PRIVATE_PATH_UNSAFE');
  return resolved;
}
export function reserveInvocation(ledger, command, now = Date.now()) {
  if (!['network', 'mail', 'bootstrap', 'database', 'native', 'startup'].includes(command)) throw Error('PROBE_COMMAND_INVALID');
  if (!Number.isSafeInteger(ledger.startedAt) || now < ledger.startedAt || now - ledger.startedAt >= 72 * 3600000 || ledger.retired) throw Error('EXPERIMENT_EXPIRED');
  if (!Number.isSafeInteger(ledger.invocations) || ledger.invocations < 0 || ledger.invocations >= 1000) throw Error('INVOCATION_BUDGET_EXHAUSTED');
  const mailAttempts = ledger.mailAttempts ?? 0;
  if (!Number.isSafeInteger(mailAttempts) || mailAttempts < 0 || command === 'mail' && mailAttempts >= 20) throw Error('MAIL_BUDGET_EXHAUSTED');
  return { ...ledger, invocations: ledger.invocations + 1, mailAttempts: mailAttempts + (command === 'mail' ? 1 : 0) };
}
export function owned(tags, deployment, purpose = 'isolated-validation') {
  const map = Array.isArray(tags) ? Object.fromEntries(tags.map(t => [t.Key, t.Value])) : tags;
  if (map?.OpenSightDeployment !== deployment || map.OpenSightPurpose !== purpose) throw Error('RESOURCE_NOT_OWNED');
}
export function safeProbeResult(response) {
  if (response?.passed !== true || response.version !== 1 || !Number.isSafeInteger(response.durationMs) || response.durationMs < 0 || !['network', 'mail', 'bootstrap', 'database', 'native', 'startup'].includes(response.command)
    || Object.keys(response).sort().join() !== 'command,durationMs,passed,version') throw Error('PROBE_FAILED');
  return response;
}
/** AWS's documented regional SMTP derivation; the IAM signing key is never stored. */
export function smtpPassword(secret, region) {
  if (typeof secret !== 'string' || secret.length < 16 || region !== 'us-east-1') throw Error('SMTP_KEY_INVALID');
  let key = Buffer.from(`AWS4${secret}`);
  for (const value of ['11111111', region, 'ses', 'aws4_request', 'SendRawEmail']) key = createHmac('sha256', key).update(value).digest();
  return Buffer.concat([Buffer.from([4]), key]).toString('base64');
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function command(binary, args, env = process.env) {
  try { return execFileSync(binary, args, { encoding: 'utf8', env, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch { throw Error(`${binary === 'aws' ? 'AWS' : 'TOFU'}_COMMAND_FAILED`); }
}
export async function main(args = process.argv.slice(2), environment = process.env) {
  process.umask(0o077);
  const [operation, selection] = args, directory = privateDirectory(environment.OPENSIGHT_OPERATOR_DIR);
  const path = name => join(directory, name);
  const read = name => {
    const stat = lstatSync(path(name));
    if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077 || stat.uid !== process.getuid?.()) throw Error('PRIVATE_FILE_UNSAFE');
    return JSON.parse(readFileSync(path(name), 'utf8'));
  };
  const write = (name, value) => {
    const target = path(name);
    if (existsSync(target) && (lstatSync(target).isSymbolicLink() || lstatSync(target).mode & 0o077)) throw Error('PRIVATE_FILE_UNSAFE');
    writeFileSync(target, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  };
  let lock;
  try { lock = openSync(path('operator.lock'), 'wx', 0o600); } catch { throw Error('OPERATOR_BUSY'); }
  try {
    const operator = read('operator.json');
    if (operator.region !== 'us-east-1') throw Error('REGION_UNVALIDATED');
    const aws = (service, action, extra = []) => JSON.parse(command('aws', [service, action, '--region', operator.region, '--output', 'json', '--no-cli-pager', ...extra]) || '{}');
    const account = aws('sts', 'get-caller-identity').Account;
    if (!/^\d{12}$/.test(account)) throw Error('ACCOUNT_INVALID');
    const deployment = operator.deployment;
    if (!/^[a-z][a-z0-9-]{0,35}$/.test(deployment ?? '')) throw Error('DEPLOYMENT_REQUIRED');
    const tagMap = { OpenSightDeployment: deployment, OpenSightPurpose: 'isolated-validation', ManagedBy: 'OpenTofu' };
    const tags = Object.entries(tagMap).map(([Key, Value]) => ({ Key, Value }));
    const stateTags = tags.map(t => t.Key === 'OpenSightPurpose' ? { ...t, Value: 'protected-state' } : t);
    const stateBucket = `${deployment}-state-${sha(account).slice(0, 10)}`, keyAlias = `alias/${deployment}-state`;
    const root = name => join(repository, 'ops/serverless', name);
    const tofu = (name, args) => command('tofu', [`-chdir=${root(name)}`, ...args], { ...environment, TF_IN_AUTOMATION: '1', TF_DATA_DIR: path(`tofu-${name}`) });
    const vars = name => `-var-file=${path(`${name}.tfvars.json`)}`;
    const init = name => {
      // OpenTofu 1.13.1 adds a synthetic predecessor-registry entry in memory,
      // making -lockfile=readonly fail for an explicitly pinned terraform.io source.
      // Its installer still verifies existing hashes. Require identical bytes
      // afterward before any plan/import/apply may proceed.
      const lockfile = join(root(name), '.terraform.lock.hcl'), before = sha(readFileSync(lockfile));
      const result = tofu(name, ['init', '-input=false', '-reconfigure', `-backend-config=${path(`${name}.backend.hcl`)}`]);
      if (sha(readFileSync(lockfile)) !== before) throw Error('PROVIDER_LOCK_CHANGED');
      return result;
    };
    const ledger = () => existsSync(path('ledger.json')) ? read('ledger.json') : { version: 1, account, deployment, startedAt: Date.now(), invocations: 0, retired: false };
    const inventory = () => JSON.parse(tofu('validation', ['output', '-json', 'inventory']));
    if (existsSync(path('ledger.json'))) {
      const recorded = ledger();
      if (recorded.account !== account || recorded.deployment !== deployment) throw Error('FOREIGN_EXPERIMENT');
      if (['bootstrap', 'repository', 'apply', 'secrets'].includes(operation) && (recorded.retired || Date.now() - recorded.startedAt >= 72 * 3600000)) throw Error('EXPERIMENT_EXPIRED');
    }
    if (operation === 'prepare') {
      if (!operator.image_uri?.startsWith(`${account}.dkr.ecr.${operator.region}.amazonaws.com/${deployment}@sha256:`) || !/sha256:[a-f0-9]{64}$/.test(operator.image_uri)) throw Error('PINNED_IMAGE_REQUIRED');
      if (!/^[^ @]+@[^ @]+\.[^ @]+$/.test(operator.alert_email ?? '') || !operator.public_origin?.startsWith('https://')) throw Error('OPERATOR_CONFIG_INVALID');
      const zones = aws('ec2', 'describe-availability-zones', ['--filters', 'Name=state,Values=available']).AvailabilityZones.filter(z => z.ZoneType === 'availability-zone').map(z => z.ZoneName).sort().slice(0, 2);
      const tenant = { running: 1, queued: 4, executionMs: 10000, queueMs: 30000, sourceRows: 100000, resultBytes: 1048576, workingBytes: 16777216, cacheBytes: 16777216, workerRssBytes: 536870912, workerHeapMb: 128, duckdbMemoryMb: 64, cellChars: 16384 };
      const runtime = { OPENSIGHT_PUBLIC_ORIGIN: operator.public_origin, OPENSIGHT_INGRESS_DOMAIN: 'validation-ingress.invalid', OPENSIGHT_INGRESS_API_ID: 'validation', OPENSIGHT_INGRESS_STAGE: '$default',
        OPENSIGHT_AUTH_ISSUER: operator.public_origin, OPENSIGHT_AUTH_AUDIENCE: 'opensight', OPENSIGHT_AUTH_KEY_ID: 'validation', OPENSIGHT_SESSION_SECONDS: '900', OPENSIGHT_INVITATION_SECONDS: '86400',
        OPENSIGHT_TENANT_LIMIT_DEFAULTS: JSON.stringify(tenant), OPENSIGHT_NODE_LIMITS: JSON.stringify({ ...tenant, running: 3, queued: 12, refreshSlots: 1, workingBytes: 67108864, cacheBytes: 67108864, workerRssBytes: 1610612736 }) };
      write('bootstrap.tfvars.json', { region: operator.region, account_id: account, deployment, state_bucket: stateBucket });
      write('validation.tfvars.json', { region: operator.region, account_id: account, deployment, availability_zones: zones, artifact_bucket: `${deployment}-artifacts-${sha(account).slice(0, 10)}`, image_uri: operator.image_uri, alert_email: operator.alert_email, runtime_environment: runtime });
      for (const name of ['bootstrap', 'validation']) write(`${name}.backend.hcl`, `bucket = "${stateBucket}"\nkey = "${name}/terraform.tfstate"\nregion = "${operator.region}"\nencrypt = true\nuse_lockfile = true\nkms_key_id = "${keyAlias}"\nallowed_account_ids = ["${account}"]\n`);
      console.log('Private inputs prepared. No AWS resource was created.'); return;
    }
    // Check account binding before every mutation; stale private inputs cannot target a different account.
    if (read('bootstrap.tfvars.json').account_id !== account) throw Error('ACCOUNT_MISMATCH');
    if (operation === 'bootstrap') {
      write('ledger.json', ledger());
      let alias = aws('kms', 'list-aliases').Aliases.find(a => a.AliasName === keyAlias), key;
      if (alias) {
        owned(aws('kms', 'list-resource-tags', ['--key-id', alias.TargetKeyId]).Tags.map(t => ({ Key: t.TagKey, Value: t.TagValue })), deployment, 'protected-state');
        key = aws('kms', 'describe-key', ['--key-id', alias.TargetKeyId]).KeyMetadata;
      } else if (existsSync(path('state-key.json'))) {
        const recorded = read('state-key.json');
        owned(aws('kms', 'list-resource-tags', ['--key-id', recorded.id]).Tags.map(t => ({ Key: t.TagKey, Value: t.TagValue })), deployment, 'protected-state');
        key = aws('kms', 'describe-key', ['--key-id', recorded.id]).KeyMetadata;
        aws('kms', 'create-alias', ['--alias-name', keyAlias, '--target-key-id', key.KeyId]);
      } else {
        key = aws('kms', 'create-key', ['--description', 'OpenSight protected deployment state', '--tags', JSON.stringify(stateTags.map(t => ({ TagKey: t.Key, TagValue: t.Value })))]).KeyMetadata;
        write('state-key.json', { arn: key.Arn, id: key.KeyId });
        aws('kms', 'create-alias', ['--alias-name', keyAlias, '--target-key-id', key.KeyId]);
      }
      aws('kms', 'enable-key-rotation', ['--key-id', key.KeyId]);
      const buckets = aws('s3api', 'list-buckets').Buckets;
      if (buckets.some(b => b.Name === stateBucket)) owned(aws('s3api', 'get-bucket-tagging', ['--bucket', stateBucket, '--expected-bucket-owner', account]).TagSet, deployment, 'protected-state');
      else {
        aws('s3api', 'create-bucket', ['--bucket', stateBucket, '--object-ownership', 'BucketOwnerEnforced']);
        aws('s3api', 'put-bucket-tagging', ['--bucket', stateBucket, '--expected-bucket-owner', account, '--tagging', JSON.stringify({ TagSet: stateTags })]);
      }
      const bucketArgs = ['--bucket', stateBucket, '--expected-bucket-owner', account];
      aws('s3api', 'put-public-access-block', [...bucketArgs, '--public-access-block-configuration', JSON.stringify({ BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true })]);
      aws('s3api', 'put-bucket-versioning', [...bucketArgs, '--versioning-configuration', 'Status=Enabled']);
      aws('s3api', 'put-bucket-encryption', [...bucketArgs, '--server-side-encryption-configuration', JSON.stringify({ Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'aws:kms', KMSMasterKeyID: key.Arn }, BucketKeyEnabled: true }] })]);
      aws('s3api', 'put-bucket-policy', [...bucketArgs, '--policy', JSON.stringify({ Version: '2012-10-17', Statement: [{ Sid: 'RequireTLS', Effect: 'Deny', Principal: '*', Action: 's3:*', Resource: [`arn:aws:s3:::${stateBucket}`, `arn:aws:s3:::${stateBucket}/*`], Condition: { Bool: { 'aws:SecureTransport': 'false' } } }] })]);
      init('bootstrap');
      const current = new Set(tofu('bootstrap', ['state', 'list']).trim().split('\n'));
      for (const [address, id] of [['aws_kms_key.state', key.KeyId], ['aws_kms_alias.state', keyAlias], ...['aws_s3_bucket', 'aws_s3_bucket_public_access_block', 'aws_s3_bucket_versioning', 'aws_s3_bucket_server_side_encryption_configuration', 'aws_s3_bucket_policy'].map(type => [`${type}.state`, stateBucket])]) {
        if (!current.has(address)) tofu('bootstrap', ['import', '-input=false', vars('bootstrap'), address, id]);
      }
      console.log('Protected remote state bootstrapped and imported. State, KMS key and evidence are retained by cleanup.'); return;
    }
    if (operation === 'repository') {
      const existing = aws('ecr', 'describe-repositories').repositories.find(r => r.repositoryName === deployment);
      if (existing) owned(aws('ecr', 'list-tags-for-resource', ['--resource-arn', existing.repositoryArn]).tags.map(t => ({ Key: t.Key ?? t.key, Value: t.Value ?? t.value })), deployment);
      else aws('ecr', 'create-repository', ['--repository-name', deployment, '--image-tag-mutability', 'IMMUTABLE', '--image-scanning-configuration', 'scanOnPush=true', '--tags', JSON.stringify(tags)]);
      init('validation');
      if (!tofu('validation', ['state', 'list']).split('\n').includes('aws_ecr_repository.runtime')) tofu('validation', ['import', '-input=false', vars('validation'), 'aws_ecr_repository.runtime', deployment]);
      console.log('Owned immutable image repository is ready. Push the reviewed image digest before planning functions.'); return;
    }
    if (operation === 'plan') {
      init('validation');
      write('validation.plan.log', tofu('validation', ['plan', '-input=false', '-no-color', vars('validation'), `-out=${path('validation.tfplan')}`]));
      const bytes = readFileSync(path('validation.tfplan')); write('validation.tfplan', bytes);
      const plan = JSON.parse(tofu('validation', ['show', '-json', path('validation.tfplan')]));
      write('validation.plan.json', plan);
      console.log(JSON.stringify({ ...checkPlan(plan), planSha256: sha(bytes) })); return;
    }
    if (operation === 'apply') {
      if (ledger().retired) throw Error('EXPERIMENT_RETIRED');
      const bytes = readFileSync(path('validation.tfplan'));
      if (!/^[a-f0-9]{64}$/.test(selection ?? '') || selection !== sha(bytes)) throw Error('REVIEWED_PLAN_REQUIRED');
      checkPlan(JSON.parse(tofu('validation', ['show', '-json', path('validation.tfplan')])));
      write('ledger.json', ledger());
      write('validation.apply.log', tofu('validation', ['apply', '-input=false', '-no-color', path('validation.tfplan')]));
      write('inventory.json', inventory()); console.log('Reviewed validation plan applied. Maintenance remains frozen.'); return;
    }
    const state = inventory();
    if (state.deployment !== deployment) throw Error('RESOURCE_NOT_OWNED');
    if (operation === 'secrets') {
      for (const kind of ['operator', 'tenant']) {
        const arn = state.secrets[kind], description = aws('secretsmanager', 'describe-secret', ['--secret-id', arn]);
        owned(description.Tags, deployment);
        if (Object.values(description.VersionIdsToStages ?? {}).some(stages => stages.includes('AWSCURRENT'))) continue;
        const value = { username: `${deployment.replaceAll('-', '_')}_${kind}`, password: randomBytes(36).toString('base64url') };
        if (kind === 'operator') Object.assign(value, { operatorKey: randomBytes(32).toString('base64'), signingKey: randomBytes(32).toString('base64'), encryptionKey: randomBytes(32).toString('base64'), ingressKeys: JSON.stringify([{ id: 'validation', secret: randomBytes(32).toString('base64url') }]) });
        const temporary = `${kind}-secret.json`;
        write(temporary, value);
        try { aws('secretsmanager', 'put-secret-value', ['--secret-id', arn, '--secret-string', `file://${path(temporary)}`]); }
        finally { unlinkSync(path(temporary)); }
      }
      const smtp = aws('secretsmanager', 'describe-secret', ['--secret-id', state.secrets.smtp]);
      owned(smtp.Tags, deployment);
      if (!Object.values(smtp.VersionIdsToStages ?? {}).some(stages => stages.includes('AWSCURRENT'))) {
        const user = aws('iam', 'get-user', ['--user-name', state.smtp_user]).User; owned(user.Tags, deployment);
        if (aws('iam', 'list-access-keys', ['--user-name', state.smtp_user]).AccessKeyMetadata.length) throw Error('SMTP_CREDENTIALS_REPAIR_REQUIRED');
        const key = aws('iam', 'create-access-key', ['--user-name', state.smtp_user]).AccessKey;
        write('smtp-key-reference.json', { user: state.smtp_user, id: key.AccessKeyId });
        write('smtp-secret.json', { username: key.AccessKeyId, password: smtpPassword(key.SecretAccessKey, operator.region) });
        try { aws('secretsmanager', 'put-secret-value', ['--secret-id', state.secrets.smtp, '--secret-string', `file://${path('smtp-secret.json')}`]); }
        catch (error) { aws('iam', 'delete-access-key', ['--user-name', state.smtp_user, '--access-key-id', key.AccessKeyId]); throw error; }
        finally { unlinkSync(path('smtp-secret.json')); }
      }
      console.log('Application and isolated SMTP secrets populated privately. Verify the approved SES email identity before the separate mail probe.'); return;
    }
    if (operation === 'invoke') {
      const next = reserveInvocation(ledger(), selection);
      const fn = aws('lambda', 'get-function', ['--function-name', state.functions.probe]); owned(fn.Tags, deployment);
      if (selection === 'network' && aws('scheduler', 'list-schedules', ['--group-name', state.schedule_group]).Schedules.length >= 20) throw Error('SCHEDULE_BUDGET_EXHAUSTED');
      write('ledger.json', next); // Reserve before dispatch, including ambiguous transport failures.
      write('probe-request.json', { version: 1, command: selection });
      const response = aws('lambda', 'invoke', ['--function-name', state.functions.probe, '--invocation-type', 'RequestResponse', '--cli-binary-format', 'raw-in-base64-out', '--payload', `file://${path('probe-request.json')}`, path('probe-response.json')]);
      const result = read('probe-response.json');
      if (response.FunctionError) {
        const code = /^[A-Z][A-Z0-9_]{1,79}$/.test(result.errorMessage ?? '') ? result.errorMessage : 'PROBE_FAILED';
        write(`invocation-${next.invocations}.json`, { command: selection, passed: false, code }); throw Error(code);
      }
      const safe = safeProbeResult(result); write(`invocation-${next.invocations}.json`, safe); console.log(JSON.stringify(safe)); return;
    }
    if (operation === 'observe') {
      const end = new Date(), start = new Date(end.getTime() - 3600000);
      const metrics = aws('cloudwatch', 'get-metric-statistics', ['--namespace', 'AWS/RDS', '--metric-name', 'ServerlessDatabaseCapacity', '--dimensions', `Name=DBInstanceIdentifier,Value=${state.writer}`, '--start-time', start.toISOString(), '--end-time', end.toISOString(), '--period', '60', '--statistics', 'Minimum', 'Maximum']);
      write(`capacity-${end.getTime()}.json`, metrics);
      console.log(JSON.stringify({ samples: metrics.Datapoints.length, pausedSamples: metrics.Datapoints.filter(p => p.Maximum === 0).length, maximumACU: Math.max(0, ...metrics.Datapoints.map(p => p.Maximum)) })); return;
    }
    if (operation === 'cleanup') {
      if (!['schedules', 'objects', 'compute', 'database', 'credentials'].includes(selection)) throw Error('CLEANUP_SELECTION_REQUIRED');
      if (selection === 'credentials') {
        const user = aws('iam', 'get-user', ['--user-name', state.smtp_user]).User; owned(user.Tags, deployment);
        for (const key of aws('iam', 'list-access-keys', ['--user-name', state.smtp_user]).AccessKeyMetadata) aws('iam', 'delete-access-key', ['--user-name', state.smtp_user, '--access-key-id', key.AccessKeyId]);
      } else if (selection === 'schedules') {
        const group = aws('scheduler', 'get-schedule-group', ['--name', state.schedule_group]);
        owned(aws('scheduler', 'list-tags-for-resource', ['--resource-arn', group.Arn]).Tags, deployment);
        for (const schedule of aws('scheduler', 'list-schedules', ['--group-name', state.schedule_group]).Schedules) aws('scheduler', 'delete-schedule', ['--group-name', state.schedule_group, '--name', schedule.Name]);
      } else if (selection === 'objects') {
        owned(aws('s3api', 'get-bucket-tagging', ['--bucket', state.bucket, '--expected-bucket-owner', account]).TagSet, deployment);
        const versions = aws('s3api', 'list-object-versions', ['--bucket', state.bucket, '--prefix', 'probe/', '--expected-bucket-owner', account]);
        for (const object of [...(versions.Versions ?? []), ...(versions.DeleteMarkers ?? [])]) {
          if (!/^probe\/[a-f0-9-]{36}$/.test(object.Key)) throw Error('CLEANUP_OBJECT_UNEXPECTED');
          aws('s3api', 'delete-object', ['--bucket', state.bucket, '--key', object.Key, '--version-id', object.VersionId, '--expected-bucket-owner', account]);
        }
      } else if (selection === 'compute') {
        for (const name of Object.values(state.functions)) {
          owned(aws('lambda', 'get-function', ['--function-name', name]).Tags, deployment);
          aws('lambda', 'put-function-concurrency', ['--function-name', name, '--reserved-concurrent-executions', '0']);
          aws('lambda', 'delete-function', ['--function-name', name]);
        }
        write('ledger.json', { ...ledger(), retired: true });
      } else {
        const cluster = aws('rds', 'describe-db-clusters', ['--db-cluster-identifier', state.cluster]).DBClusters[0];
        owned(aws('rds', 'list-tags-for-resource', ['--resource-name', cluster.DBClusterArn]).TagList, deployment);
        if (cluster.DBClusterMembers.length !== 1 || cluster.DBClusterMembers[0].DBInstanceIdentifier !== state.writer) throw Error('CLEANUP_DATABASE_UNEXPECTED');
        aws('rds', 'modify-db-cluster', ['--db-cluster-identifier', state.cluster, '--no-deletion-protection', '--apply-immediately']);
        aws('rds', 'delete-db-instance', ['--db-instance-identifier', state.writer, '--skip-final-snapshot']);
        aws('rds', 'wait', ['db-instance-deleted', '--db-instance-identifier', state.writer]);
        aws('rds', 'delete-db-cluster', ['--db-cluster-identifier', state.cluster, '--final-db-snapshot-identifier', `${deployment}-final`]);
        write('ledger.json', { ...ledger(), retired: true });
      }
      console.log('Selected owned synthetic resources cleaned. Remote state/evidence remain. Retained KMS key, secrets, image/object storage and any final snapshot continue to incur charges; reconcile the retired inventory before any new apply.'); return;
    }
    throw Error('OPERATOR_COMMAND_INVALID');
  } finally { closeSync(lock); unlinkSync(path('operator.lock')); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => {
  // No service response, command line, private path or credential reaches terminal output.
  console.error(/^[A-Z][A-Z0-9_:,-]{1,200}$/.test(error.message) ? error.message : 'OPERATOR_FAILED'); process.exitCode = 1;
});
