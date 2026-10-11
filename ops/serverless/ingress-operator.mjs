#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, lstatSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { owned, privateDirectory } from './operator.mjs';
import { checkFailedSubscriptionStack, checkFreeSubscription, checkIngressPlan, checkReceipt, frontendFiles, sha256 } from './ingress-policy.mjs';
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

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
    catch (error) { write('ingress.failed.log', `${error.stdout ?? ''}${error.stderr ?? ''}`); throw Error('INGRESS_COMMAND_FAILED'); }
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
    const tofu = args => command('tofu', ['-chdir=ops/serverless/ingress', ...args], { TF_IN_AUTOMATION: '1', TF_DATA_DIR: path('tofu-ingress') });
    const init = () => {
      const lockfile = join(repository, 'ops/serverless/ingress/.terraform.lock.hcl'), before = sha256(readFileSync(lockfile));
      write('ingress.init.log', tofu(['init', '-input=false', '-reconfigure', `-backend-config=${path('ingress.backend.hcl')}`]));
      if (sha256(readFileSync(lockfile)) !== before) throw Error('PROVIDER_LOCK_CHANGED');
    };
    const source = () => {
      if (command('git', ['status', '--porcelain']).trim()) throw Error('CLEAN_SOURCE_REQUIRED');
      return sha256(command('git', ['rev-parse', 'HEAD']).trim());
    };
    const configuration = () => sha256(Buffer.concat(['ingress.tfvars.json', 'ingress.backend.hcl', 'ingress-release.json'].map(file)));
    const state = () => {
      const key = 'ingress/terraform.tfstate', bucketArgs = ['--bucket', bootstrap.state_bucket, '--expected-bucket-owner', account];
      const result = aws('s3api', 'list-objects-v2', [...bucketArgs, '--prefix', key]);
      if (!(result.Contents ?? []).some(object => object.Key === key)) return null;
      const metadata = aws('s3api', 'get-object', [...bucketArgs, '--key', key, path('ingress.remote-state.json')]);
      const saved = read('ingress.remote-state.json');
      if (!metadata.VersionId || !saved.lineage || !Number.isSafeInteger(saved.serial)) throw Error('REMOTE_STATE_INVALID');
      return { version: metadata.VersionId, lineage: saved.lineage, serial: saved.serial };
    };
    const inventory = () => JSON.parse(tofu(['output', '-json', 'inventory']));
    const verifyFree = current => {
      const inputs = read('ingress.tfvars.json');
      checkFreeSubscription(aws('pricing-plan-manager', 'get-subscription', ['--arn', current.subscription_arn]).subscription,
        [current.distribution_arn, current.web_acl_arn, `arn:aws:route53:::hostedzone/${inputs.zone_id}`]);
    };
    const acceptance = () => {
      const record = read('ingress-acceptance.json'), release = read('ingress-release.json');
      if (record.version !== 1 || record.account !== account || record.deployment !== deployment || record.publicOrigin !== operator.public_origin
        || record.imageUri !== release.image_uri || record.requestVersion !== release.request_function_version || record.manifestSha256 !== release.frontend_manifest_sha256
        || !Number.isSafeInteger(record.completedAt) || Date.now() < record.completedAt || Date.now() - record.completedAt > 3600000
        || !['startup', 'testerAuthentication', 'upload', 'ingestion', 'query', 'isolation'].every(key => record.checks?.[key] === true)) throw Error('LIVE_ACCEPTANCE_REQUIRED');
    };
    if (operation === 'prepare') {
      const release = read('ingress-release.json'), existing = read('inventory.json');
      if (existing.deployment !== deployment || !release.image_uri?.startsWith(`${account}.dkr.ecr.us-east-1.amazonaws.com/${deployment}@sha256:`)
        || !/sha256:[a-f0-9]{64}$/.test(release.image_uri) || !/^[1-9][0-9]*$/.test(release.request_function_version ?? '')) throw Error('PINNED_RELEASE_REQUIRED');
      const repoArn = `arn:aws:ecr:us-east-1:${account}:repository/${deployment}`;
      owned(aws('ecr', 'list-tags-for-resource', ['--resource-arn', repoArn]).tags, deployment);
      aws('ecr', 'describe-images', ['--repository-name', deployment, '--image-ids', `imageDigest=${release.image_uri.split('@')[1]}`]);
      const fn = aws('lambda', 'get-function', ['--function-name', existing.functions.request, '--qualifier', release.request_function_version]);
      owned(aws('lambda', 'list-tags', ['--resource', fn.Configuration.FunctionArn.replace(/:[0-9]+$/, '')]).Tags, deployment);
      if (fn.Configuration.Version !== release.request_function_version || fn.Configuration.CodeSha256 !== release.request_code_sha256 || fn.Configuration.State !== 'Active') throw Error('REQUEST_VERSION_CHANGED');
      frontendFiles(release.frontend_directory, release.frontend_manifest_sha256);
      const host = new URL(operator.public_origin).hostname;
      if (`https://${host}` !== operator.public_origin) throw Error('ORIGIN_INVALID');
      const zones = aws('route53', 'list-hosted-zones-by-name', ['--dns-name', `${host}.`]).HostedZones.filter(zone => zone.Name === `${host}.` && !zone.Config.PrivateZone);
      if (zones.length !== 1) throw Error('EXISTING_ZONE_REQUIRED');
      const zoneId = zones[0].Id.replace('/hostedzone/', '');
      owned(aws('secretsmanager', 'describe-secret', ['--secret-id', existing.secrets.operator]).Tags, deployment);
      const secret = JSON.parse(aws('secretsmanager', 'get-secret-value', ['--secret-id', existing.secrets.operator, '--version-stage', 'AWSCURRENT']).SecretString);
      const keys = JSON.parse(secret.ingressKeys);
      if (!Array.isArray(keys) || keys.length !== 1 || !/^[A-Za-z0-9_-]{43,128}$/.test(keys[0].secret)) throw Error('INGRESS_KEY_REVIEW_REQUIRED');
      write('ingress.tfvars.json', { region: operator.region, account_id: account, deployment, public_origin: operator.public_origin, origin_domain: `api.${host}`, zone_id: zoneId,
        frontend_bucket: `${deployment}-frontend-${sha256(account).slice(0, 10)}`, request_function_name: existing.functions.request, request_function_version: release.request_function_version,
        image_uri: release.image_uri, ingress_key_id: keys[0].id, ingress_secret: keys[0].secret, publish_site: false });
      write('ingress.backend.hcl', `bucket = "${bootstrap.state_bucket}"\nkey = "ingress/terraform.tfstate"\nregion = "us-east-1"\nencrypt = true\nuse_lockfile = true\nkms_key_id = "alias/${deployment}-state"\nallowed_account_ids = ["${account}"]\n`);
      console.log('Private ingress inputs prepared; public DNS remains gated.'); return;
    }
    const inputs = read('ingress.tfvars.json');
    if (inputs.account_id !== account || inputs.deployment !== deployment) throw Error('ACCOUNT_MISMATCH');
    if (operation === 'repair-subscription') {
      source();
      const name = `${deployment}-free-edge`, stack = aws('cloudformation', 'describe-stacks', ['--stack-name', name]).Stacks[0];
      owned(stack.Tags, deployment, 'public-ingress');
      const distributions = aws('cloudfront', 'list-distributions').DistributionList.Items ?? [];
      const matching = distributions.filter(item => item.Aliases?.Items?.includes(new URL(inputs.public_origin).hostname));
      if (matching.length !== 1) throw Error('RESOURCE_NOT_OWNED');
      const distribution = matching[0];
      owned(aws('cloudfront', 'list-tags-for-resource', ['--resource', distribution.ARN]).Tags.Items, deployment, 'public-ingress');
      const resources = aws('cloudformation', 'list-stack-resources', ['--stack-name', stack.StackId]).StackResourceSummaries;
      const subscriptions = aws('pricing-plan-manager', 'list-subscriptions').subscriptionSummaries;
      checkFailedSubscriptionStack(stack, resources, subscriptions, name, [distribution.ARN, distribution.WebACLId]);
      write('ingress-subscription-repair.json', { inspectedAt: Date.now(), stack, resources, subscriptions });
      aws('cloudformation', 'delete-stack', ['--stack-name', stack.StackId]);
      console.log('Empty rolled-back subscription stack deletion requested. Retained ingress is unchanged; replan after deletion completes.'); return;
    }
    if (operation === 'plan') {
      const sourceDigest = source(), configDigest = configuration();
      init();
      if (inputs.publish_site) { acceptance(); verifyFree(inventory()); }
      const before = state();
      write('ingress.plan.log', tofu(['plan', '-input=false', '-no-color', `-var-file=${path('ingress.tfvars.json')}`, `-out=${path('ingress.tfplan')}`]));
      const plan = JSON.parse(tofu(['show', '-json', path('ingress.tfplan')]));
      write('ingress.plan.json', plan);
      const review = checkIngressPlan(plan, inputs), planDigest = sha256(file('ingress.tfplan'));
      if (JSON.stringify(before) !== JSON.stringify(state()) || sourceDigest !== source() || configDigest !== configuration()) throw Error('PLAN_CONTEXT_CHANGED');
      write('ingress.receipt.json', { version: 1, createdAt: Date.now(), account, deployment, state: before, source: sourceDigest, configuration: configDigest, plan: planDigest });
      console.log(JSON.stringify({ ...review, planSha256: planDigest })); return;
    }
    if (operation === 'apply') {
      const receipt = read('ingress.receipt.json');
      if (selection !== receipt.plan) throw Error('REVIEWED_PLAN_REQUIRED');
      checkReceipt(receipt, { account, deployment, state: state(), source: source(), configuration: configuration(), plan: sha256(file('ingress.tfplan')) });
      checkIngressPlan(JSON.parse(tofu(['show', '-json', path('ingress.tfplan')])), inputs);
      if (inputs.publish_site) { acceptance(); verifyFree(inventory()); }
      write('ingress.apply.log', tofu(['apply', '-input=false', '-no-color', path('ingress.tfplan')]));
      const current = inventory(); write('ingress-inventory.json', current); verifyFree(current);
      console.log('Reviewed ingress plan applied; active Free subscription verified.'); return;
    }
    if (operation === 'verify') {
      const current = inventory(); verifyFree(current); write('ingress-inventory.json', current);
      console.log(JSON.stringify({ activeFreePlan: true, publicDns: current.public_dns })); return;
    }
    if (operation === 'cutover') {
      acceptance(); verifyFree(inventory()); write('ingress.tfvars.json', { ...inputs, publish_site: true });
      console.log('Live acceptance recorded. Create and review a new DNS plan before applying.'); return;
    }
    if (operation === 'frontend') {
      const release = read('ingress-release.json'), files = frontendFiles(release.frontend_directory, release.frontend_manifest_sha256), current = inventory();
      verifyFree(current);
      owned(aws('s3api', 'get-bucket-tagging', ['--bucket', current.frontend_bucket, '--expected-bucket-owner', account]).TagSet, deployment, 'public-ingress');
      const bucketArgs = ['--bucket', current.frontend_bucket, '--expected-bucket-owner', account];
      // First inspect every collision. No asset is written until the whole set
      // is proven immutable, and conditional writes also close concurrent races.
      const pending = [];
      for (const item of files) {
        const key = `frontend/${item.key}`, listed = aws('s3api', 'list-objects-v2', [...bucketArgs, '--prefix', key]);
        if ((listed.Contents ?? []).some(object => object.Key === key)) {
          const metadata = aws('s3api', 'get-object', [...bucketArgs, '--key', key, path('ingress-object-check.bin')]);
          const identical = sha256(file('ingress-object-check.bin')) === item.sha256;
          if (item.immutable && !identical) throw Error('IMMUTABLE_ASSET_COLLISION');
          if (identical) continue;
          pending.push({ ...item, key, condition: ['--if-match', metadata.ETag] });
        } else pending.push({ ...item, key, condition: ['--if-none-match', '*'] });
      }
      const types = { js: 'text/javascript', css: 'text/css', html: 'text/html', png: 'image/png', svg: 'image/svg+xml', woff2: 'font/woff2' };
      for (const item of pending) {
        if (sha256(readFileSync(item.path)) !== item.sha256) throw Error('FRONTEND_BYTES_CHANGED');
        aws('s3api', 'put-object', [...bucketArgs, '--key', item.key, '--body', item.path, '--content-type', types[item.key.split('.').at(-1)], '--cache-control', item.immutable ? 'public,max-age=31536000,immutable' : 'no-store', '--server-side-encryption', 'AES256', '--checksum-algorithm', 'SHA256', '--checksum-sha256', Buffer.from(item.sha256, 'hex').toString('base64'), ...item.condition]);
      }
      write('ingress-frontend.json', { manifestSha256: release.frontend_manifest_sha256, completedAt: Date.now(), files: files.length });
      console.log(JSON.stringify({ uploaded: pending.length, verified: files.length })); return;
    }
    throw Error('INGRESS_COMMAND_INVALID');
  } finally { closeSync(lock); unlinkSync(path('operator.lock')); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => {
  console.error(/^[A-Z][A-Z0-9_:,-]{1,200}$/.test(error.message) ? error.message : 'INGRESS_OPERATOR_FAILED'); process.exitCode = 1;
});
