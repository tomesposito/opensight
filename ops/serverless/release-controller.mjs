import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { ciConfig } from './ci-policy.mjs';
import { validateManifest, digest } from './release-manifest.mjs';
import { configurationFingerprint, approveRelease, frontendFiles } from './release-safety.mjs';
process.umask(0o077);
const mode = process.argv[2], root = resolve(process.env.RUNNER_TEMP ?? '/tmp', 'opensight-release');
mkdirSync(root, { recursive: true, mode: 0o700 });
const sleep = ms => new Promise(r => setTimeout(r, ms));
function run(binary, args, input) {
  try { return execFileSync(binary, args, { input, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }); }
  catch (e) { const missing = /\(NoSuchKey\)/.test(String(e.stderr)); throw Error(missing ? 'OBJECT_NOT_FOUND' : /\(AccessDenied\)|\(AccessDeniedException\)/.test(String(e.stderr)) ? 'ACCESS_DENIED' : 'EXTERNAL_COMMAND_FAILED'); }
}
const region = 'us-east-1';
function aws(service, action, input = {}, extra = []) {
  return JSON.parse(run('aws', [service, action, '--region', region, '--no-cli-pager', '--output', 'json', '--cli-input-json', JSON.stringify(input), ...extra]) || '{}');
}
function get(bucket, key) {
  const path = join(root, randomUUID());
  const meta = aws('s3api', 'get-object', { Bucket: bucket, Key: key }, [path]);
  return { bytes: readFileSync(path), meta, path };
}
const bucket = process.env.OPENSIGHT_OPERATIONS_BUCKET;
if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket ?? '')) throw Error('OPERATIONS_BUCKET_REQUIRED');
const configBytes = get(bucket, 'ci/config/deployment.json').bytes, c = ciConfig(JSON.parse(configBytes));
if (c.operationsBucket !== bucket || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(c.publicRepository ?? '')) throw Error('CONFIGURATION_MISMATCH');
const configurationDigest = digest(configBytes), identity = aws('sts', 'get-caller-identity');
if (identity.Account !== c.account || !identity.Arn.includes(`:assumed-role/${c.deployment}-ci-`)) throw Error('CI_IDENTITY_REQUIRED');
if (mode === 'access-probe' || mode === 'revocation-probe') {
  const current = get(bucket, 'ci/config/sentinel.json');
  if (JSON.parse(current.bytes).version !== 1) throw Error('SENTINEL_INVALID');
  console.log('CI_READ_VERIFIED');
  if (mode === 'revocation-probe') {
    for (let n = 0; n < 18; n++) {
      await sleep(10000);
      try { get(bucket, 'ci/config/sentinel.json'); }
      catch (error) {
        // A denied operation, not GetCallerIdentity (which can succeed despite
        // an explicit deny), is the proof. The operator also checks new federation.
        if (error.message !== 'ACCESS_DENIED') throw error;
        console.log('EXISTING_SESSION_ACCESS_REMOVED'); process.exit(0);
      }
    }
    throw Error('SESSION_REVOCATION_NOT_OBSERVED');
  }
  process.exit(0);
}
function put(key, value, condition = {}) {
  const path = join(root, randomUUID()); writeFileSync(path, JSON.stringify(value) + '\n', { mode: 0o600 });
  return aws('s3api', 'put-object', { Bucket: bucket, Key: key, ServerSideEncryption: 'aws:kms', SSEKMSKeyId: c.kmsKey, BucketKeyEnabled: true, ...condition }, ['--body', path]);
}
function putBytes(targetBucket, key, bytes, options = {}) {
  const path = join(root, randomUUID()); writeFileSync(path, bytes, { mode: 0o600 });
  return aws('s3api', 'put-object', { Bucket: targetBucket, Key: key, ...options }, ['--body', path]);
}
const selected = process.env.OPENSIGHT_RELEASE_SOURCE, selectedDigest = process.env.OPENSIGHT_RELEASE_MANIFEST;
if (!/^[a-f0-9]{40}$/.test(selected ?? '') || !/^[a-f0-9]{64}$/.test(selectedDigest ?? '')) throw Error('RELEASE_SELECTION_INVALID');
const releaseDir = join(root, 'artifacts'); mkdirSync(releaseDir, { recursive: true });
run('gh', ['release', 'download', `build-${selected}`, '--repo', c.publicRepository, '--dir', releaseDir, '--pattern', 'release.json', '--clobber']);
const manifestBytes = readFileSync(join(releaseDir, 'release.json')), m = validateManifest(JSON.parse(manifestBytes));
if (digest(manifestBytes) !== selectedDigest || m.source !== selected || m.repository !== c.publicRepository) throw Error('RELEASE_SELECTION_MISMATCH');
run('gh', ['attestation', 'verify', join(releaseDir, 'release.json'), '--repo', c.publicRepository,
  '--signer-workflow', `${c.publicRepository}/.github/workflows/ci.yml`, '--signer-digest', selected,
  '--source-digest', selected, '--source-ref', 'refs/heads/master', '--deny-self-hosted-runners']);
const currentObject = get(bucket, 'ci/releases/current.json'), current = JSON.parse(currentObject.bytes);
const approval = JSON.parse(get(bucket, `ci/approvals/${selectedDigest}.json`).bytes);
approveRelease(approval, m, selectedDigest, configurationDigest, current);
if (mode === 'preflight') { console.log('RELEASE_PREFLIGHT_VERIFIED'); process.exit(0); }
if (mode !== 'deploy' || !identity.Arn.includes(`:assumed-role/${c.deployment}-ci-deploy/`)) throw Error('DEPLOY_IDENTITY_REQUIRED');
for (const [name, expected] of Object.entries(m.artifacts)) {
  run('gh', ['release', 'download', `build-${selected}`, '--repo', c.publicRepository, '--dir', releaseDir, '--pattern', name, '--clobber']);
  if (digest(readFileSync(join(releaseDir, name))) !== expected) throw Error('ARTIFACT_DIGEST_MISMATCH');
}
const functions = ['request', 'work', 'recovery', 'ingress'].map(n => `${c.deployment}-${n}`);
const snapshot = functions.map(FunctionName => {
  const f = aws('lambda', 'get-function', { FunctionName }), concurrency = aws('lambda', 'get-function-concurrency', { FunctionName }).ReservedConcurrentExecutions;
  if (f.Configuration.State !== 'Active' || f.Configuration.LastUpdateStatus !== 'Successful' || !Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 4 || f.Configuration.Timeout > 120) throw Error('FUNCTION_NOT_READY');
  if (configurationFingerprint(f.Configuration) !== current.configuration?.[FunctionName]) throw Error('RUNTIME_CONFIGURATION_DRIFT');
  return { name: FunctionName, image: f.Code.ResolvedImageUri, revision: f.Configuration.RevisionId, concurrency, timeout: f.Configuration.Timeout };
});
const oldAlias = aws('lambda', 'get-alias', { FunctionName: functions[0], Name: 'live' });
if (oldAlias.FunctionVersion !== current.requestVersion || snapshot.some(f => f.image !== current.imageUri)) throw Error('DEPLOYMENT_DRIFT');
const mappings = c.eventMappings.map(UUID => aws('lambda', 'get-event-source-mapping', { UUID }));
if (mappings.some(m => m.State !== 'Enabled' || !functions.slice(1, 3).some(f => m.FunctionArn.endsWith(':' + f)))) throw Error('MAPPING_DRIFT');
const lockKey = 'ci/operations/active.json', operationId = randomUUID();
let record = { version: 1, operationId, run: process.env.GITHUB_RUN_ID, current, target: selectedDigest, phase: 'prepared', snapshot, oldAlias, mappings: c.eventMappings, at: Date.now() };
let etag = put(lockKey, record, { IfNoneMatch: '*' }).ETag;
function phase(name) { record = { ...record, phase: name, at: Date.now() }; etag = put(lockKey, record, { IfMatch: etag }).ETag; console.log('RELEASE_PHASE_' + name.toUpperCase()); }
async function until(check, milliseconds = 120000) {
  const end = Date.now() + milliseconds;
  while (!check()) { if (Date.now() >= end) throw Error('CONTROL_PLANE_TIMEOUT'); await sleep(3000); }
}
async function quiesce() {
  phase('quiescing');
  aws('lambda', 'put-function-concurrency', { FunctionName: functions[0], ReservedConcurrentExecutions: 0 });
  for (const UUID of c.eventMappings) aws('lambda', 'update-event-source-mapping', { UUID, Enabled: false });
  for (const FunctionName of functions.slice(1)) aws('lambda', 'put-function-concurrency', { FunctionName, ReservedConcurrentExecutions: 0 });
  await until(() => c.eventMappings.every(UUID => aws('lambda', 'get-event-source-mapping', { UUID }).State === 'Disabled'));
  if (!functions.every(FunctionName => aws('lambda', 'get-function-concurrency', { FunctionName }).ReservedConcurrentExecutions === 0)) throw Error('QUIESCENCE_UNCONFIRMED');
  const deadline = Date.now() + (Math.max(...snapshot.map(f => f.timeout)) + 10) * 1000;
  while (Date.now() < deadline) { console.log('Waiting for admitted invocations to exit.'); await sleep(Math.min(30000, deadline - Date.now())); }
  phase('quiescent');
}
async function update(f, image) {
  const previous = aws('lambda', 'get-function', { FunctionName: f.name });
  aws('lambda', 'update-function-code', { FunctionName: f.name, ImageUri: image, RevisionId: previous.Configuration.RevisionId });
  await until(() => {
    const status = aws('lambda', 'get-function', { FunctionName: f.name });
    if (status.Configuration.LastUpdateStatus === 'Failed') throw Error('FUNCTION_UPDATE_FAILED');
    return status.Configuration.LastUpdateStatus === 'Successful' && status.Code.ResolvedImageUri === image;
  });
}
async function reopen() {
  for (const f of snapshot) aws('lambda', 'put-function-concurrency', { FunctionName: f.name, ReservedConcurrentExecutions: f.concurrency });
  for (const UUID of c.eventMappings) aws('lambda', 'update-event-source-mapping', { UUID, Enabled: true });
  await until(() => c.eventMappings.every(UUID => aws('lambda', 'get-event-source-mapping', { UUID }).State === 'Enabled'));
}
const contentType = name => name.endsWith('.html') ? 'text/html' : name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.json') ? 'application/json' : name.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream';
function publishFrontend(files, read) {
  for (const name of Object.keys(files).sort((a, b) => Number(a.endsWith('.html')) - Number(b.endsWith('.html')))) {
    if (!/^[A-Za-z0-9_./-]+$/.test(name) || name.split('/').some(p => !p || p === '.' || p === '..')) throw Error('FRONTEND_PATH_INVALID');
    const bytes = read(name); if (digest(bytes) !== files[name]) throw Error('FRONTEND_DIGEST_MISMATCH');
    putBytes(c.frontendBucket, name, bytes, { ContentType: contentType(name), CacheControl: name.startsWith('assets/') ? 'public,max-age=31536000,immutable' : 'no-store', ServerSideEncryption: 'AES256' });
  }
  aws('cloudfront', 'create-invalidation', { DistributionId: c.distribution, InvalidationBatch: { CallerReference: operationId + '-' + Date.now(), Paths: { Quantity: 1, Items: ['/*'] } } });
}
let changed = false, committed = false, scheduleArmed = false;
const scheduleName = 'release-' + operationId, scheduleGroup = c.deployment + '-ci-release';
function cancelWatchdog() {
  if (scheduleArmed) aws('scheduler', 'delete-schedule', { Name: scheduleName, GroupName: scheduleGroup });
  scheduleArmed = false;
}
function stopAdmission() {
  for (const FunctionName of functions) { try { aws('lambda', 'put-function-concurrency', { FunctionName, ReservedConcurrentExecutions: 0 }); } catch {} }
  for (const UUID of c.eventMappings) { try { aws('lambda', 'update-event-source-mapping', { UUID, Enabled: false }); } catch {} }
}
try {
  // Back up only verified public frontend bytes; no state or tenant objects.
  for (const [name, expected] of Object.entries(current.files)) {
    const object = get(c.frontendBucket, name); if (digest(object.bytes) !== expected) throw Error('FRONTEND_DRIFT');
    putBytes(bucket, `ci/releases/${current.id}/frontend/${name}`, object.bytes, { ServerSideEncryption: 'aws:kms', SSEKMSKeyId: c.kmsKey, BucketKeyEnabled: true });
  }
  const imageUri = `${c.account}.dkr.ecr.${c.region}.amazonaws.com/${c.deployment}@${m.imageDigest}`;
  const registry = imageUri.split('/')[0], password = run('aws', ['ecr', 'get-login-password', '--region', c.region]).trim();
  const authPath = join(root, 'registry-auth.json'); writeFileSync(authPath, JSON.stringify({ auths: { [registry]: { auth: Buffer.from('AWS:' + password).toString('base64') } } }), { mode: 0o600 });
  let existingImage;
  try { existingImage = aws('ecr','describe-images',{ repositoryName:c.deployment,imageIds:[{imageTag:`release-${selected}`}] }).imageDetails?.[0]?.imageDigest; } catch {}
  if (existingImage && existingImage !== m.imageDigest) throw Error('REGISTRY_TAG_DRIFT');
  if (!existingImage) run('docker', ['run', '--rm', '-v', `${releaseDir}:/release:ro`, '-v', `${authPath}:/auth.json:ro`,
    'quay.io/skopeo/stable@sha256:47853bb9fb24202af9110531ebd6e43c5f97701254ca290596640290d17942f4', 'copy', '--preserve-digests', '--authfile', '/auth.json',
    'oci-archive:/release/runtime.oci.tar', `docker://${registry}/${c.deployment}:release-${selected}`]);
  const found = aws('ecr', 'describe-images', { repositoryName: c.deployment, imageIds: [{ imageTag: `release-${selected}` }] });
  if (found.imageDetails?.[0]?.imageDigest !== m.imageDigest) throw Error('REGISTRY_DIGEST_MISMATCH');
  const frontend = join(root, 'frontend');
  run('node', [new URL('./extract-frontend.mjs', import.meta.url).pathname, join(releaseDir, 'frontend.tar.gz'), frontend]);
  const front = JSON.parse(readFileSync(join(frontend, 'manifest.json'), 'utf8'));
  frontendFiles(front);
  phase('staged');
  const deadline = new Date(Date.now() + 15 * 60000).toISOString().slice(0,19);
  aws('scheduler','create-schedule', { Name: scheduleName, GroupName: scheduleGroup, ScheduleExpression: `at(${deadline})`, ScheduleExpressionTimezone: 'UTC', FlexibleTimeWindow: { Mode: 'OFF' }, ActionAfterCompletion: 'DELETE',
    Target: { Arn: `arn:aws:lambda:${c.region}:${c.account}:function:${c.deployment}-ci-watchdog`, RoleArn: `arn:aws:iam::${c.account}:role/${c.deployment}-ci-watchdog-invoke`, Input: JSON.stringify({ operationId }), RetryPolicy: { MaximumEventAgeInSeconds: 300, MaximumRetryAttempts: 2 } } });
  scheduleArmed = true;
  aws('scheduler','get-schedule', { Name: scheduleName, GroupName: scheduleGroup });
  changed = true; await quiesce();
  for (const f of snapshot) await update(f, imageUri);
  const candidate = aws('lambda', 'get-function', { FunctionName: functions[0] });
  const version = aws('lambda', 'publish-version', { FunctionName: functions[0], CodeSha256: candidate.Configuration.CodeSha256, RevisionId: candidate.Configuration.RevisionId });
  const alias = aws('lambda', 'get-alias', { FunctionName: functions[0], Name: 'live' });
  aws('lambda', 'update-alias', { FunctionName: functions[0], Name: 'live', FunctionVersion: version.Version, RevisionId: alias.RevisionId });
  publishFrontend(front.files, name => readFileSync(join(frontend, name)));
  phase('promoted'); await reopen(); phase('verifying');
  if (approval.exerciseRollback === true) throw Error('APPROVED_ROLLBACK_EXERCISE');
  run('node', [new URL('./release-smoke.mjs', import.meta.url).pathname]);
  const next = { version: 1, id: selectedDigest, source: selected, compatibility: m.compatibility, imageUri, requestVersion: version.Version, files: front.files, configuration: current.configuration, previous: current.id, completedAt: Date.now() };
  put(`ci/releases/${selectedDigest}/release.json`, next);
  try { put('ci/releases/current.json', next, { IfMatch: currentObject.meta.ETag }); }
  catch { stopAdmission(); throw Error('RELEASE_COMMIT_AMBIGUOUS'); }
  committed = true; phase('complete'); cancelWatchdog();
  put(`ci/operations/${operationId}.json`, record);
  aws('s3api', 'delete-object', { Bucket: bucket, Key: lockKey, IfMatch: etag });
  console.log('DEPLOYMENT_VERIFIED');
} catch (error) {
  if (committed || error.message === 'RELEASE_COMMIT_AMBIGUOUS') { stopAdmission(); throw Error('RELEASE_RECOVERY_REQUIRED'); }
  if (changed) {
    try {
      await quiesce(); phase('rolling-back');
      for (const f of snapshot) await update(f, f.image);
      const alias = aws('lambda', 'get-alias', { FunctionName: functions[0], Name: 'live' });
      aws('lambda', 'update-alias', { FunctionName: functions[0], Name: 'live', FunctionVersion: oldAlias.FunctionVersion, RevisionId: alias.RevisionId });
      publishFrontend(current.files, name => get(bucket, `ci/releases/${current.id}/frontend/${name}`).bytes);
      await reopen(); run('node', [new URL('./release-smoke.mjs', import.meta.url).pathname]);
      phase('rolled-back'); cancelWatchdog(); put(`ci/operations/${operationId}.json`, record);
      aws('s3api', 'delete-object', { Bucket: bucket, Key: lockKey, IfMatch: etag });
    } catch {
      stopAdmission();
      throw Error('RELEASE_RECOVERY_REQUIRED');
    }
  }
  if (!changed) { phase('rolled-back'); cancelWatchdog(); put(`ci/operations/${operationId}.json`, record); aws('s3api','delete-object',{Bucket:bucket,Key:lockKey,IfMatch:etag}); }
  throw error;
}
