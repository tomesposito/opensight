#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { closeSync, existsSync, lstatSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { owned, privateDirectory } from './operator.mjs';
import { checkReceipt, sha256 } from './ingress-policy.mjs';
import { checkPlan } from './plan-policy.mjs';
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function initialCredentials(ownerEmail, agentEmail = 'automation@example.invalid') {
  const emails = [ownerEmail, agentEmail].map(value => typeof value === 'string' ? value.trim().toLowerCase() : '');
  if (emails.some(value => !/^[^ @]+@[^ @]+\.[^ @]+$/.test(value)) || emails[0] === emails[1]) throw Error('TESTER_EMAIL_INVALID');
  return { version: 1, operationId: randomUUID(), testers: emails.map((email, index) => ({ tenantId: randomUUID(), namespaceId: randomUUID(), userId: randomUUID(), subject: randomUUID(),
    email, name: index === 0 ? 'Workspace owner' : 'Automation tester', password: randomBytes(32).toString('base64url'), totpSecret: randomBytes(20).toString('base64') })) };
}
export function safeInitialResult(command, value, expectedBudgetVersion) {
  if (command === 'extend-pilot-execution' && (!Number.isSafeInteger(expectedBudgetVersion) || expectedBudgetVersion < 2 || expectedBudgetVersion >= 2147483647)) throw Error('INITIAL_RESULT_INVALID');
  const expected = { 'extend-pilot-execution': { state: 'budgets-configured', epoch: 1, budgetVersion: expectedBudgetVersion + 1 }, migrate: { state: 'migrated', maintenance: true }, 'bootstrap-initial': { state: 'bootstrapped', epoch: 1, tenants: 2 }, 'activate-initial': { state: 'active', epoch: 1 }, 'repair-initial-locks': { state: 'locks-repaired', epoch: 1 }, 'tune-initial-budgets': { state: 'budgets-configured', epoch: 1, budgetVersion: 2 } }[command];
  if (!expected || !value || Object.keys(value).sort().join() !== Object.keys(expected).sort().join() || Object.entries(expected).some(([key, field]) => value[key] !== field)) throw Error('INITIAL_RESULT_INVALID');
  return expected;
}
export function initialBudgetChange(value) {
  if (!value || Object.keys(value).sort().join() !== 'previousBudgetDigest,targetBudgetDigest'
    || !Object.values(value).every(v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v))
    || value.previousBudgetDigest === value.targetBudgetDigest) throw Error('INITIAL_BUDGET_CHANGE_INVALID');
  return { previousBudgetDigest: value.previousBudgetDigest, targetBudgetDigest: value.targetBudgetDigest };
}
export function executionBudgetChange(value) {
  if (!value || Object.keys(value).sort().join() !== 'expectedBudgetVersion,previousBudgetDigest,targetBudgetDigest'
    || !Number.isSafeInteger(value.expectedBudgetVersion) || value.expectedBudgetVersion < 2 || value.expectedBudgetVersion >= 2147483647) throw Error('INITIAL_BUDGET_CHANGE_INVALID');
  return { expectedBudgetVersion: value.expectedBudgetVersion, ...initialBudgetChange({ previousBudgetDigest: value.previousBudgetDigest, targetBudgetDigest: value.targetBudgetDigest }) };
}
export function activationRequired(record, release, account, deployment, operationId, patch) {
  if (record?.version !== 1 || record.account !== account || record.deployment !== deployment || record.imageUri !== (patch?.activationImageUri ?? release.image_uri) || record.operationId !== operationId
    || record.result?.state !== 'active' || record.result.epoch !== 1) throw Error('INITIAL_ACTIVATION_REQUIRED');
  if (patch) {
    if (Object.keys(patch).sort().join() !== 'account,activationImageUri,deployment,imageUri,operationId,purpose,sourceCommit,version'
      || patch.version !== 1 || patch.account !== account || patch.deployment !== deployment || patch.operationId !== operationId
      || patch.purpose !== 'release-idle-preflight-clients' || patch.imageUri !== release.image_uri || patch.sourceCommit !== release.source_commit
      || !/^[a-f0-9]{40}$/.test(patch.sourceCommit ?? '') || patch.activationImageUri === patch.imageUri) throw Error('INITIAL_CONNECTION_REPAIR_INVALID');
    for (const image_uri of [patch.activationImageUri, patch.imageUri]) administrationImage({ image_uri }, account, deployment);
  }
}
export function administrationImage(release, account, deployment) {
  if (!new RegExp(`^${account}\\.dkr\\.ecr\\.us-east-1\\.amazonaws\\.com/${deployment}@sha256:[a-f0-9]{64}$`).test(release?.image_uri ?? '')) throw Error('PINNED_ADMINISTRATION_REQUIRED');
  return release.image_uri;
}
export async function main(args = process.argv.slice(2), environment = process.env) {
  process.umask(0o077);
  const [operation, selection] = args, directory = privateDirectory(environment.OPENSIGHT_OPERATOR_DIR), path = name => join(directory, name);
  const file = name => {
    const target = path(name), stat = lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077 || stat.uid !== process.getuid?.()) throw Error('PRIVATE_FILE_UNSAFE');
    return readFileSync(target);
  };
  const read = name => JSON.parse(file(name));
  const write = (name, value) => {
    if (existsSync(path(name))) file(name);
    writeFileSync(path(name), typeof value === 'string' || Buffer.isBuffer(value) ? value : `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  };
  const command = (binary, args, extra = {}) => {
    try { return execFileSync(binary, args, { cwd: repository, env: { ...environment, ...extra }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (error) { write('pilot.failed.log', `${error.stdout ?? ''}${error.stderr ?? ''}`); throw Error('PILOT_COMMAND_FAILED'); }
  };
  let lock;
  try { lock = openSync(path('operator.lock'), 'wx', 0o600); } catch { throw Error('OPERATOR_BUSY'); }
  try {
    const operator = read('operator.json'), bootstrap = read('bootstrap.tfvars.json'), deployment = operator.deployment;
    if (operator.region !== 'us-east-1' || !/^[a-z][a-z0-9-]{0,35}$/.test(deployment ?? '')) throw Error('CONFIGURATION_INVALID');
    const aws = (service, action, extra = []) => JSON.parse(command('aws', [service, action, '--region', operator.region, '--output', 'json', '--no-cli-pager', ...extra], { AWS_MAX_ATTEMPTS: '1', AWS_RETRY_MODE: 'standard' }) || '{}');
    const account = aws('sts', 'get-caller-identity').Account;
    if (!/^\d{12}$/.test(account) || account !== bootstrap.account_id || deployment !== bootstrap.deployment) throw Error('ACCOUNT_MISMATCH');
    owned(aws('s3api', 'get-bucket-tagging', ['--bucket', bootstrap.state_bucket, '--expected-bucket-owner', account]).TagSet, deployment, 'protected-state');
    const cluster = aws('rds', 'describe-db-clusters', ['--db-cluster-identifier', deployment]).DBClusters[0];
    const tags = aws('rds', 'list-tags-for-resource', ['--resource-name', cluster.DBClusterArn]).TagList;
    owned(tags, deployment);
    const pilot = tags.some(tag => tag.Key === 'OpenSightStage' && tag.Value === 'pilot');
    const tofu = args => command('tofu', ['-chdir=ops/serverless/validation', ...args], { TF_IN_AUTOMATION: '1', TF_DATA_DIR: path('tofu-validation') });
    const source = () => {
      if (command('git', ['status', '--porcelain']).trim()) throw Error('CLEAN_SOURCE_REQUIRED');
      return sha256(command('git', ['rev-parse', 'HEAD']).trim());
    };
    const init = () => {
      const lockfile = join(repository, 'ops/serverless/validation/.terraform.lock.hcl'), before = sha256(readFileSync(lockfile));
      write('pilot.init.log', tofu(['init', '-input=false', '-reconfigure', `-backend-config=${path('validation.backend.hcl')}`]));
      if (sha256(readFileSync(lockfile)) !== before) throw Error('PROVIDER_LOCK_CHANGED');
    };
    const configuration = () => sha256(Buffer.concat(['pilot.tfvars.json', 'validation.backend.hcl', 'pilot-release.json',
      ...(read('pilot.tfvars.json').administration_image_uri ? ['pilot-administration-release.json'] : []),
      ...(existsSync(path('pilot-connection-repair.json')) ? ['pilot-connection-repair.json'] : []),
      ...(existsSync(path('pilot-execution-change.json')) ? ['pilot-execution-change.json'] : [])].map(file)));
    const state = () => {
      const metadata = aws('s3api', 'get-object', ['--bucket', bootstrap.state_bucket, '--expected-bucket-owner', account, '--key', 'validation/terraform.tfstate', path('pilot.remote-state.json')]);
      const saved = read('pilot.remote-state.json');
      if (!metadata.VersionId || !saved.lineage || !Number.isSafeInteger(saved.serial)) throw Error('REMOTE_STATE_INVALID');
      return { version: metadata.VersionId, lineage: saved.lineage, serial: saved.serial };
    };
    const inventory = () => JSON.parse(tofu(['output', '-json', 'inventory']));
    const release = read('pilot-release.json');
    if (!new RegExp(`^${account}\\.dkr\\.ecr\\.us-east-1\\.amazonaws\\.com/${deployment}@sha256:[a-f0-9]{64}$`).test(release.image_uri ?? '')) throw Error('PINNED_RELEASE_REQUIRED');
    const activation = () => activationRequired(read('pilot-activation.json'), release, account, deployment, read('initial-testers.json').operationId,
      existsSync(path('pilot-connection-repair.json')) ? read('pilot-connection-repair.json') : undefined);
    if (operation === 'prepare') {
      source();
      if (!['dependencies', 'runtime', 'consumers', 'administration', 'connection-repair'].includes(selection)) throw Error('PILOT_STAGE_REQUIRED');
      if (selection !== 'dependencies' && !pilot) throw Error('PILOT_DEPENDENCIES_REQUIRED');
      if (selection === 'consumers') activation();
      const current = inventory();
      if (selection === 'connection-repair') {
        activation();
        if (existsSync(path('pilot-connection-repair.json'))) throw Error('INITIAL_CONNECTION_REPAIR_ALREADY_SELECTED');
        const selected = read('pilot.tfvars.json'), ingress = read('ingress.tfvars.json'), candidate = read('pilot-connection-repair-release.json');
        if (current.deployment !== deployment || !current.pilot_runtime || !current.consumers || selected.image_uri !== release.image_uri
          || selected.account_id !== account || selected.deployment !== deployment || ingress.publish_site) throw Error('INITIAL_CONNECTION_REPAIR_INVALID');
        const apex = `${new URL(operator.public_origin).hostname}.`;
        if (aws('route53', 'list-resource-record-sets', ['--hosted-zone-id', ingress.zone_id]).ResourceRecordSets.some(r => r.Name === apex && ['A', 'AAAA'].includes(r.Type))) throw Error('INITIAL_DNS_ALREADY_PUBLISHED');
        const image = administrationImage(candidate, account, deployment);
        if (image === release.image_uri || !/^[a-f0-9]{40}$/.test(candidate.source_commit ?? '')) throw Error('INITIAL_CONNECTION_REPAIR_INVALID');
        command('git', ['merge-base', '--is-ancestor', candidate.source_commit, 'HEAD']);
        owned(aws('ecr', 'list-tags-for-resource', ['--resource-arn', `arn:aws:ecr:us-east-1:${account}:repository/${deployment}`]).tags, deployment);
        aws('ecr', 'describe-images', ['--repository-name', deployment, '--image-ids', `imageDigest=${image.split('@')[1]}`]);
        for (const name of ['request', 'work', 'recovery']) {
          const fn = aws('lambda', 'get-function', ['--function-name', `${deployment}-${name}`]); owned(fn.Tags, deployment);
          if (fn.Code.ResolvedImageUri !== release.image_uri || fn.Configuration.State !== 'Active' || fn.Configuration.LastUpdateStatus !== 'Successful') throw Error('INITIAL_CONNECTION_REPAIR_INVALID');
        }
        const patch = { version: 1, purpose: 'release-idle-preflight-clients', account, deployment, operationId: read('initial-testers.json').operationId,
          activationImageUri: release.image_uri, imageUri: image, sourceCommit: candidate.source_commit };
        const next = { image_uri: image, source_commit: candidate.source_commit };
        activationRequired(read('pilot-activation.json'), next, account, deployment, patch.operationId, patch);
        write('pilot-connection-repair.json', patch); write('pilot-release.json', next); write('pilot.tfvars.json', { ...selected, image_uri: image });
        console.log('Initial connection repair selected; original activation evidence and SQL state are preserved. Review a fresh plan.'); return;
      }
      if (selection === 'administration') {
        activation();
        if (current.deployment !== deployment || !current.pilot_runtime) throw Error('PILOT_DEPENDENCIES_REQUIRED');
        const image = administrationImage(read('pilot-administration-release.json'), account, deployment), selected = read('pilot.tfvars.json');
        if (selected.account_id !== account || selected.deployment !== deployment || selected.image_uri !== release.image_uri || !selected.enable_pilot_runtime) throw Error('ACCOUNT_MISMATCH');
        owned(aws('ecr', 'list-tags-for-resource', ['--resource-arn', `arn:aws:ecr:us-east-1:${account}:repository/${deployment}`]).tags, deployment);
        aws('ecr', 'describe-images', ['--repository-name', deployment, '--image-ids', `imageDigest=${image.split('@')[1]}`]);
        write('pilot.tfvars.json', { ...selected, administration_image_uri: image });
        console.log('Private administration artifact selected; application and consumers are preserved. Review a fresh plan.'); return;
      }
      if (current.deployment !== deployment || selection === 'dependencies' && current.pilot_runtime || selection === 'runtime' && current.consumers) throw Error('PILOT_STAGE_REGRESSION');
      const base = read('validation.tfvars.json'), ingress = read('ingress-inventory.json');
      if (base.account_id !== account || base.deployment !== deployment || ingress.deployment !== deployment || ingress.public_origin !== operator.public_origin) throw Error('ACCOUNT_MISMATCH');
      const runtime = selection !== 'dependencies';
      if (runtime) {
        owned(aws('ecr', 'list-tags-for-resource', ['--resource-arn', `arn:aws:ecr:us-east-1:${account}:repository/${deployment}`]).tags, deployment);
        aws('ecr', 'describe-images', ['--repository-name', deployment, '--image-ids', `imageDigest=${release.image_uri.split('@')[1]}`]);
      }
      write('pilot.tfvars.json', { ...base, deployment_profile: 'pilot', enable_runtime: true, enable_pilot_runtime: runtime, enable_consumers: selection === 'consumers',
        ...(runtime && existsSync(path('pilot.tfvars.json')) ? { administration_image_uri: read('pilot.tfvars.json').administration_image_uri ?? null } : {}),
        image_uri: runtime ? release.image_uri : base.image_uri, runtime_environment: runtime ? { ...base.runtime_environment, ...ingress.runtime_environment } : base.runtime_environment });
      console.log('Private pilot inputs prepared. Create and review a saved plan before applying.'); return;
    }
    const inputs = read('pilot.tfvars.json');
    if (inputs.account_id !== account || inputs.deployment !== deployment || inputs.deployment_profile !== 'pilot') throw Error('ACCOUNT_MISMATCH');
    if (inputs.enable_pilot_runtime && inputs.image_uri !== release.image_uri) throw Error('PINNED_RELEASE_REQUIRED');
    if (inputs.administration_image_uri && inputs.administration_image_uri !== administrationImage(read('pilot-administration-release.json'), account, deployment)) throw Error('PINNED_ADMINISTRATION_REQUIRED');
    if (operation === 'plan') {
      const sourceDigest = source(), configDigest = configuration(); init();
      if (inputs.enable_consumers) activation();
      const before = state();
      write('pilot.plan.log', tofu(['plan', '-input=false', '-no-color', `-var-file=${path('pilot.tfvars.json')}`, `-out=${path('pilot.tfplan')}`]));
      const plan = JSON.parse(tofu(['show', '-json', path('pilot.tfplan')])); write('pilot.plan.json', plan);
      const review = checkPlan(plan, { allowPilot: true }), planDigest = sha256(file('pilot.tfplan'));
      if (JSON.stringify(before) !== JSON.stringify(state()) || sourceDigest !== source() || configDigest !== configuration()) throw Error('PLAN_CONTEXT_CHANGED');
      write('pilot.receipt.json', { version: 1, createdAt: Date.now(), account, deployment, state: before, source: sourceDigest, configuration: configDigest, plan: planDigest });
      console.log(JSON.stringify({ ...review, planSha256: planDigest })); return;
    }
    if (operation === 'apply') {
      const receipt = read('pilot.receipt.json');
      if (selection !== receipt.plan) throw Error('REVIEWED_PLAN_REQUIRED');
      checkReceipt(receipt, { account, deployment, state: state(), source: source(), configuration: configuration(), plan: sha256(file('pilot.tfplan')) });
      checkPlan(JSON.parse(tofu(['show', '-json', path('pilot.tfplan')])), { allowPilot: true });
      if (inputs.enable_consumers) activation();
      write('pilot.apply.log', tofu(['apply', '-input=false', '-no-color', path('pilot.tfplan')]));
      write('inventory.json', inventory());
      console.log('Reviewed pilot plan applied. Public DNS remains separately gated.'); return;
    }
    if (operation === 'testers') {
      if (existsSync(path('initial-testers.json'))) throw Error('TESTER_CREDENTIALS_EXIST');
      write('initial-testers.json', initialCredentials(operator.alert_email, operator.agent_email));
      console.log('Two independent tester credentials saved privately. No email was sent.'); return;
    }
    const verifyFunction = name => {
      const fn = aws('lambda', 'get-function', ['--function-name', `${deployment}-${name}`]); owned(fn.Tags, deployment);
      const expectedImage = name === 'migration' ? inputs.administration_image_uri ?? release.image_uri : release.image_uri;
      if (fn.Configuration.State !== 'Active' || fn.Configuration.LastUpdateStatus !== 'Successful' || fn.Code.ResolvedImageUri !== expectedImage
        || fn.Configuration.Environment?.Variables?.OPENSIGHT_RELEASE_DIGEST !== release.image_uri.split('@')[1]) throw Error('PILOT_FUNCTION_NOT_READY');
      return fn;
    };
    if (operation === 'invoke') {
      source();
      if (existsSync(path('pilot-connection-repair.json')) && selection !== 'extend-pilot-execution') throw Error('INITIAL_COMMANDS_CLOSED');
      if (!pilot || !inputs.enable_pilot_runtime || !['migrate', 'bootstrap-initial', 'activate-initial', 'repair-initial-locks', 'tune-initial-budgets', 'extend-pilot-execution'].includes(selection)) throw Error('INITIAL_COMMAND_INVALID');
      if (['repair-initial-locks', 'tune-initial-budgets', 'extend-pilot-execution'].includes(selection)) activation();
      const fn = verifyFunction('migration');
      if (fn.Configuration.ImageConfigResponse?.ImageConfig?.Command?.join() !== 'packages/api/dist/aws-lambda.administration') throw Error('INITIAL_HANDLER_REQUIRED');
      const current = inventory(), secretArn = current.secrets.operator;
      owned(aws('secretsmanager', 'describe-secret', ['--secret-id', secretArn]).Tags, deployment);
      const secret = JSON.parse(aws('secretsmanager', 'get-secret-value', ['--secret-id', secretArn, '--version-stage', 'AWSCURRENT']).SecretString);
      const key = Buffer.from(secret.operatorKey, 'base64'); if (key.length !== 32) throw Error('OPERATOR_KEY_INVALID');
      const testers = selection === 'migrate' ? null : read('initial-testers.json');
      const input = { command: selection, authorization: `Operator ${key.toString('base64url')}`, ...(testers ? { version: 1, operationId: testers.operationId,
        ...(selection === 'bootstrap-initial' ? { testers: testers.testers } : { expectedEpoch: 1, releaseDigest: release.image_uri.split('@')[1] }),
        ...(selection === 'tune-initial-budgets' ? initialBudgetChange(read('pilot-budget-change.json')) : {}),
        ...(selection === 'extend-pilot-execution' ? { ...executionBudgetChange(read('pilot-execution-change.json')), activationReleaseDigest: read('pilot-activation.json').imageUri.split('@')[1] } : {}) } : {}) };
      write('pilot-command.json', input);
      try {
        const response = aws('lambda', 'invoke', ['--function-name', fn.Configuration.FunctionArn, '--invocation-type', 'RequestResponse', '--cli-connect-timeout', '10', '--cli-read-timeout', '130', '--cli-binary-format', 'raw-in-base64-out', '--payload', `file://${path('pilot-command.json')}`, path('pilot-response.json')]);
        const result = read('pilot-response.json');
        if (response.FunctionError) throw Error(/^[A-Z][A-Z0-9_]{1,79}$/.test(result.errorMessage ?? '') ? result.errorMessage : 'INITIAL_COMMAND_FAILED');
        const safe = safeInitialResult(selection, result, input.expectedBudgetVersion), record = { version: 1, account, deployment, imageUri: release.image_uri, administrationImageUri: fn.Code.ResolvedImageUri, operationId: testers?.operationId, completedAt: Date.now(), result: safe };
        write(selection === 'activate-initial' ? 'pilot-activation.json' : `pilot-${selection}.json`, record);
        console.log(JSON.stringify(safe)); return;
      } finally { unlinkSync(path('pilot-command.json')); }
    }
    if (operation === 'publish-request') {
      source(); activation();
      const current = inventory(); if (!current.consumers) throw Error('CONSUMERS_REQUIRED');
      const fn = verifyFunction('request');
      const published = aws('lambda', 'publish-version', ['--function-name', fn.Configuration.FunctionArn, '--code-sha256', fn.Configuration.CodeSha256, '--revision-id', fn.Configuration.RevisionId]);
      if (!/^[1-9][0-9]*$/.test(published.Version)) throw Error('PUBLISHED_VERSION_REQUIRED');
      write('pilot-request-version.json', { image_uri: release.image_uri, request_function_version: published.Version, request_code_sha256: published.CodeSha256, authorizer_concurrency: 4 });
      console.log('Pinned request version published. Select it through the separate ingress operator.'); return;
    }
    throw Error('PILOT_COMMAND_INVALID');
  } finally { closeSync(lock); unlinkSync(path('operator.lock')); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => {
  console.error(/^[A-Z][A-Z0-9_:,-]{1,200}$/.test(error.message) ? error.message : 'PILOT_OPERATOR_FAILED'); process.exitCode = 1;
});
