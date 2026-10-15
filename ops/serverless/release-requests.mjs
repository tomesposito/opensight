import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, lstatSync, existsSync, renameSync, rmSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { privateDirectory } from './operator.mjs';
import { ciConfig } from './ci-policy.mjs';
import { digest, validateManifest } from './release-manifest.mjs';
import { sourcePattern, manifestPattern, validateRequest, observedProduction } from './release-request-policy.mjs';
import { releaseRequest } from './release-request-flow.mjs';

process.umask(0o077);
const exec = promisify(execFile), [action, selection] = process.argv.slice(2);
const gh = process.env.OPENSIGHT_GH_BINARY ?? 'gh';
const root = mkdtempSync(join(tmpdir(), 'opensight-request-'));
let unlock;
async function run(binary, args, options = {}) {
  try { return (await exec(binary, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 90000, ...options })).stdout; }
  catch (e) {
    if (binary === 'aws' && /\(NoSuchKey\)/.test(String(e.stderr))) throw Error('OBJECT_NOT_FOUND');
    throw Error(binary === 'aws' ? 'AWS_REQUEST_FAILED' : 'RELEASE_REQUEST_COMMAND_FAILED');
  }
}
async function api(method, path, body) {
  const args = ['api', '--method', method, path];
  if (body !== undefined) {
    const path = join(root, 'github-input.json'); writeFileSync(path, JSON.stringify(body)); args.push('--input', path);
  }
  return JSON.parse(await run(gh, args) || 'null');
}
function privateFile(path) {
  const s = lstatSync(path);
  if (!s.isFile() || s.isSymbolicLink() || s.mode & 0o077 || s.uid !== process.getuid()) throw Error('PRIVATE_FILE_UNSAFE');
  return readFileSync(path);
}
try {
  if (!['request', 'list', 'approve', 'dispatch', 'reconcile', 'observe'].includes(action)) throw Error('REQUEST_COMMAND_INVALID');
  const operator = !['request', 'list'].includes(action);
  const directory = operator ? privateDirectory(process.env.OPENSIGHT_OPERATOR_DIR) : undefined;
  const configBytes = operator ? privateFile(join(directory, 'ci-config.json')) : undefined;
  const c = operator ? ciConfig(JSON.parse(configBytes)) : undefined;
  const repository = c?.publicRepository ?? process.env.OPENSIGHT_PUBLIC_REPOSITORY;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '')) throw Error('PUBLIC_REPOSITORY_REQUIRED');
  if (['approve', 'dispatch', 'reconcile'].includes(action) && !/^[1-9][0-9]*$/.test(selection ?? '')) throw Error('REQUEST_ID_REQUIRED');
  const endpoint = `/repos/${repository}`;
  let sequence = 0;
  async function aws(service, command, input, extra = []) {
    // get-object's streaming CLI customization requires explicit required flags.
    const args = service === 's3api' && command === 'get-object'
      ? ['--bucket', input.Bucket, '--key', input.Key] : ['--cli-input-json', JSON.stringify(input)];
    return JSON.parse(await run('aws', [service, command, '--region', c.region, '--no-cli-pager', '--output', 'json',
      '--cli-connect-timeout', '5', '--cli-read-timeout', '20', ...args, ...extra],
    { env: { ...process.env, AWS_MAX_ATTEMPTS: '2' } }) || '{}');
  }
  async function object(key) {
    const path = join(root, `aws-${sequence++}.json`);
    const meta = await aws('s3api', 'get-object', { Bucket: c.operationsBucket, Key: key }, [path]);
    return { value: JSON.parse(readFileSync(path)), bytes: readFileSync(path), etag: meta.ETag };
  }
  async function activeOperation() {
    try { await object('ci/operations/active.json'); return true; }
    catch (e) { if (e.message === 'OBJECT_NOT_FOUND') return false; throw e; }
  }
  if (operator) {
    const lock = join(directory, 'release-requests.lock');
    const fd = openSync(lock, 'wx', 0o600); writeFileSync(fd, JSON.stringify({ pid: process.pid, action, startedAt: Date.now() })); closeSync(fd);
    unlock = () => unlinkSync(lock);
    const identity = await aws('sts', 'get-caller-identity', {});
    if (identity.Account !== c.account || /:assumed-role\/[^/]*-ci-(read|deploy)\//.test(identity.Arn)) throw Error('INDEPENDENT_OPERATOR_REQUIRED');
  }
  const receiptPath = id => join(directory, `release-request-${id}.json`);
  const io = {
    repository,
    async verify(source, expected) {
      if (!sourcePattern.test(source ?? '') || expected !== undefined && !manifestPattern.test(expected)) throw Error('REQUEST_SELECTION_INVALID');
      const dir = join(root, 'release-' + source); mkdirSync(dir, { recursive: true });
      for (const name of ['release.json', 'provenance.jsonl']) await run(gh, ['release', 'download', 'build-' + source, '--repo', repository, '--pattern', name, '--dir', dir, '--clobber']);
      const path = join(dir, 'release.json'), bytes = readFileSync(path), manifest = validateManifest(JSON.parse(bytes)), hash = digest(bytes);
      if (manifest.source !== source || manifest.repository !== repository || expected !== undefined && expected !== hash) throw Error('REQUEST_MANIFEST_CHANGED');
      await run(gh, ['attestation', 'verify', path, '--bundle', join(dir, 'provenance.jsonl'), '--repo', repository,
        '--signer-workflow', repository + '/.github/workflows/ci.yml', '--signer-digest', source, '--source-digest', source,
        '--source-ref', 'refs/heads/master', '--deny-self-hosted-runners']);
      return { manifest, digest: hash };
    },
    createRequest: body => api('POST', endpoint + '/deployments', body),
    getRequest: id => api('GET', endpoint + '/deployments/' + id),
    status: (id, body) => api('POST', endpoint + '/deployments/' + id + '/statuses', body),
    async load(id) { return existsSync(receiptPath(id)) ? JSON.parse(privateFile(receiptPath(id))) : undefined; },
    async save(id, receipt) {
      const path = receiptPath(id); if (existsSync(path)) privateFile(path);
      const temp = path + '.new'; const fd = openSync(temp, 'wx', 0o600);
      try { writeFileSync(fd, JSON.stringify(receipt) + '\n'); } finally { closeSync(fd); }
      renameSync(temp, path);
    },
    async authority() {
      const remote = await object('ci/config/deployment.json');
      if (digest(remote.bytes) !== digest(configBytes) || await activeOperation()) throw Error('AUTHORITY_CHANGED');
      return { current: (await object('ci/releases/current.json')).value, configuration: digest(configBytes) };
    },
    approval: async manifest => (await object(`ci/approvals/${manifest}.json`)).value,
    async approve(request) {
      await run(process.execPath, [fileURLToPath(new URL('./ci-release-operator.mjs', import.meta.url)), 'approve', request.source],
        { env: { ...process.env, OPENSIGHT_RELEASE_MANIFEST: request.manifest, AWS_MAX_ATTEMPTS: '2' } });
    },
    async checkDispatcher() {
      const f = await api('GET', `/repos/${c.privateRepository}/contents/.github/workflows/deploy.yml?ref=master`);
      const text = Buffer.from(f.content, 'base64').toString('utf8');
      if (!text.includes('run-name: release-request ${{ inputs.request }}') || !text.includes('      request:')
        || !text.includes(`/.github/workflows/controller.yml@${c.workflowCommit}`)) throw Error('REQUEST_DISPATCHER_NOT_ACTIVE');
    },
    dispatch: (request, token) => api('POST', `/repos/${c.privateRepository}/actions/workflows/deploy.yml/dispatches`, {
      ref: 'master', inputs: { mode: 'deploy', role: 'read', source: request.source, manifest: request.manifest, request: token },
    }),
    async runs(receipt) {
      const result = [], date = encodeURIComponent('>=' + new Date(receipt.attemptedAt - 60000).toISOString());
      for (let page = 1; page <= 3; page++) {
        const r = await api('GET', `/repos/${c.privateRepository}/actions/workflows/deploy.yml/runs?event=workflow_dispatch&branch=master&created=${date}&per_page=100&page=${page}`);
        result.push(...r.workflow_runs);
        if (result.length >= r.total_count) return result;
      }
      throw Error('REQUEST_RUN_SCAN_LIMIT');
    },
    async observe() {
      await io.authority();
      const before = await object('ci/releases/current.json');
      const roles = ['request', 'work', 'recovery', 'ingress'];
      const functions = await Promise.all(roles.map(async role => {
        const FunctionName = `${c.deployment}-${role}`;
        const [f, concurrency] = await Promise.all([aws('lambda', 'get-function', { FunctionName }), aws('lambda', 'get-function-concurrency', { FunctionName })]);
        return { role, configuration: f.Configuration, image: f.Code.ResolvedImageUri, concurrency: concurrency.ReservedConcurrentExecutions };
      }));
      const mappings = await Promise.all(c.eventMappings.map(UUID => aws('lambda', 'get-event-source-mapping', { UUID })));
      const alias = await aws('lambda', 'get-alias', { FunctionName: `${c.deployment}-request`, Name: 'live' });
      const active = await activeOperation(), after = await object('ci/releases/current.json');
      const observation = observedProduction(before.value, { etag: before.etag, finalEtag: after.etag, functions, mappings, alias, activeOperation: active });
      return { current: before.value, observation };
    },
    async publishObservation({ observation }) {
      // Construct every public field explicitly. Never serialize the AWS record.
      const safe = { version: 1, kind: 'opensight-production-observation', runtimeSource: observation.runtimeSource,
        marketingSource: observation.marketingSource, observedAt: observation.observedAt };
      const d = await api('POST', endpoint + '/deployments', { ref: safe.runtimeSource, task: 'opensight:observe', environment: 'production-observed',
        auto_merge: false, required_contexts: [], production_environment: true, transient_environment: false,
        description: 'AWS control-plane observation; not continuous health monitoring', payload: safe });
      await io.status(d.id, { state: 'success', description: `Observed runtime ${safe.runtimeSource}; marketing ${safe.marketingSource}`, auto_inactive: false });
      return safe;
    },
  };
  if (action === 'list') {
    const requests = await api('GET', endpoint + '/deployments?task=opensight%3Arequest&per_page=20');
    const records = [];
    for (const d of requests) {
      try {
        const request = validateRequest(d, repository), statuses = await api('GET', endpoint + '/deployments/' + d.id + '/statuses?per_page=1');
        const state = ['pending', 'queued', 'in_progress', 'success', 'failure', 'error', 'inactive'].includes(statuses[0]?.state) ? statuses[0].state : 'unknown';
        records.push({ ...request, state });
      } catch { records.push({ state: 'unverified-record' }); }
    }
    const observed = await api('GET', endpoint + '/deployments?task=opensight%3Aobserve&per_page=1');
    let production;
    if (observed[0]) {
      const d = observed[0], p = d.payload, statuses = await api('GET', endpoint + '/deployments/' + d.id + '/statuses?per_page=1');
      if (statuses[0]?.state === 'success' && p?.version === 1 && p.kind === 'opensight-production-observation'
        && sourcePattern.test(p.runtimeSource) && sourcePattern.test(p.marketingSource) && Number.isFinite(Date.parse(p.observedAt))) {
        production = { runtimeSource: p.runtimeSource, marketingSource: p.marketingSource, observedAt: new Date(p.observedAt).toISOString() };
      }
    }
    console.log(JSON.stringify({ requests: records, production, informationalOnly: true }, null, 2));
  } else console.log(JSON.stringify(await releaseRequest(action, selection, io), null, 2));
} catch (e) {
  const allowed = new Set(['REQUEST_COMMAND_INVALID', 'PUBLIC_REPOSITORY_REQUIRED', 'REQUEST_ID_REQUIRED', 'REQUEST_SELECTION_INVALID',
    'REQUEST_INVALID', 'REQUEST_MANIFEST_CHANGED', 'REQUEST_RECEIPT_MISMATCH', 'REQUEST_APPROVAL_REQUIRED', 'DISPATCH_RECEIPT_REQUIRED',
    'DISPATCH_ALREADY_ATTEMPTED', 'DUPLICATE_REQUEST_RUNS', 'REQUEST_RUN_INVALID', 'REQUEST_NOT_CURRENT', 'REQUEST_RUN_SCAN_LIMIT',
    'REQUEST_DISPATCHER_NOT_ACTIVE', 'COMPATIBILITY_REVIEW_REQUIRED', 'RELEASE_APPROVAL_REQUIRED', 'AUTHORITY_CHANGED',
    'PRODUCTION_UNVERIFIED', 'INDEPENDENT_OPERATOR_REQUIRED', 'AWS_REQUEST_FAILED', 'OBJECT_NOT_FOUND', 'RELEASE_REQUEST_COMMAND_FAILED']);
  console.error(allowed.has(e.message) ? e.message : e.code === 'EEXIST' ? 'OPERATOR_LOCK_OR_RECEIPT_EXISTS' : 'RELEASE_REQUEST_FAILED');
  process.exitCode = 1;
} finally { if (unlock) unlock(); rmSync(root, { recursive: true, force: true }); }
