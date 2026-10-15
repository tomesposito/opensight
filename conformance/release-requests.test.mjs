import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseRequest } from '../ops/serverless/release-request-flow.mjs';
import { requestBody, validateRequest, requestRunName, matchedRun, observedProduction, publicStatus } from '../ops/serverless/release-request-policy.mjs';
import { configurationFingerprint } from '../ops/serverless/release-safety.mjs';

const source = 'a'.repeat(40), manifest = 'b'.repeat(64), compatibility = 'c'.repeat(64), repository = 'example/opensight';
const request = () => ({ ...requestBody(source, manifest), id: 12, sha: source, repository_url: `https://api.github.com/repos/${repository}` });
function fixture() {
  const calls = [], receipts = new Map();
  const current = { id: 'before', compatibility }, configuration = 'private-configuration-fingerprint';
  const approval = { version: 1, source, manifest, current: 'before', configuration, expiresAt: Date.now() + 3600000 };
  const io = { repository,
    verify: async (s, hash) => { assert.equal(s, source); if (hash) assert.equal(hash, manifest); calls.push('verify'); return { manifest: { source, compatibility }, digest: manifest }; },
    createRequest: async body => { assert.equal(body.auto_merge, false); calls.push('create'); return request(); },
    getRequest: async () => request(),
    status: async (id, value) => { assert.equal(id, 12); calls.push(value.state); },
    load: async id => receipts.get(id), save: async (id, value) => { calls.push('save'); receipts.set(id, value); },
    authority: async () => { calls.push('authority'); return { current, configuration }; },
    approve: async () => { calls.push('approve'); }, approval: async () => approval,
    checkDispatcher: async () => calls.push('dispatcher'),
    dispatch: async () => { assert.ok(receipts.get(12).token); calls.push('dispatch'); },
    runs: async () => [],
    observe: async () => ({ current: { id: manifest, source }, observation: { runtimeSource: source, marketingSource: source, observedAt: new Date().toISOString() } }),
    publishObservation: async value => { calls.push('observation'); return value.observation; },
  };
  return { io, calls, receipts, current, approval };
}
test('release requests verify artifacts without consulting AWS or private receipts', async () => {
  const { io, calls } = fixture();
  assert.equal((await releaseRequest('request', source, io)).stage, 'requested');
  assert.deepEqual(calls, ['verify', 'create', 'pending']);
  io.verify = async () => { throw Error('INVALID_ATTESTATION'); };
  await assert.rejects(releaseRequest('request', source, io), /INVALID_ATTESTATION/);
  assert.equal(calls.filter(c => c === 'create').length, 1);
});
test('requests reject mutable refs, changed digests, cross-repository and extra payload fields', () => {
  assert.deepEqual(validateRequest(request(), repository), { id: 12, source, manifest });
  for (const patch of [{ ref: 'master' }, { sha: 'd'.repeat(40) }, { repository_url: 'https://api.github.com/repos/other/opensight' },
    { environment: 'staging' }, { task: 'opensight:observe' }, { payload: { ...request().payload, approved: true } }, { payload: '{' }]) {
    assert.throws(() => validateRequest({ ...request(), ...patch }, repository));
  }
  assert.throws(() => requestBody('master', manifest)); assert.throws(() => requestBody(source, 'latest'));
});
test('approval repeats artifact and AWS authority verification before reporting queued', async () => {
  const { io, calls, receipts } = fixture();
  await releaseRequest('approve', '12', io);
  assert.deepEqual(calls, ['verify', 'authority', 'approve', 'authority', 'save', 'queued']);
  assert.equal(receipts.get(12).current, 'before');
});
test('compatibility mismatch blocks before writing approval and never blesses a new baseline', async () => {
  const { io, current, calls } = fixture(); current.compatibility = 'd'.repeat(64);
  await assert.rejects(releaseRequest('approve', '12', io), /COMPATIBILITY_REVIEW_REQUIRED/);
  assert.deepEqual(calls, ['verify', 'authority', 'error']);
});
test('an unverified approval or authority race never produces an approved receipt', async () => {
  const { io, approval, receipts, calls } = fixture(); approval.current = 'different';
  await assert.rejects(releaseRequest('approve', '12', io), /RELEASE_APPROVAL_REQUIRED/);
  assert.equal(receipts.size, 0); assert.ok(!calls.includes('queued'));
});
test('dispatch requires a private receipt and an unexpired current-bound AWS approval', async () => {
  const { io, receipts, approval } = fixture();
  await assert.rejects(releaseRequest('dispatch', '12', io), /REQUEST_APPROVAL_REQUIRED/);
  await releaseRequest('approve', '12', io);
  approval.expiresAt = Date.now() - 1;
  await assert.rejects(releaseRequest('dispatch', '12', io), /RELEASE_APPROVAL_REQUIRED/);
  assert.equal(receipts.get(12).token, undefined);
});
test('dispatch persists single-use intent before calling GitHub; response loss cannot repeat it', async () => {
  const { io, receipts, calls } = fixture(); await releaseRequest('approve', '12', io);
  io.dispatch = async () => { assert.ok(receipts.get(12).token); calls.push('dispatch'); throw Error('RESPONSE_LOST'); };
  await assert.rejects(releaseRequest('dispatch', '12', io), /RESPONSE_LOST/);
  await assert.rejects(releaseRequest('dispatch', '12', io), /DISPATCH_ALREADY_ATTEMPTED/);
  await assert.rejects(releaseRequest('approve', '12', io), /DISPATCH_ALREADY_ATTEMPTED/);
  assert.equal(calls.filter(c => c === 'dispatch').length, 1);
  assert.equal((await releaseRequest('reconcile', '12', io)).outcome, 'dispatch-unconfirmed');
});
test('public status failure does not roll back or repeat an independent approval', async () => {
  const { io, receipts } = fixture(); io.status = async () => { throw Error('PUBLIC_STATUS_UNAVAILABLE'); };
  await assert.rejects(releaseRequest('approve', '12', io), /PUBLIC_STATUS_UNAVAILABLE/);
  assert.equal(receipts.get(12).stage, 'approved');
});
function run(receipt, patch = {}) { return { id: 99, display_title: requestRunName(receipt.token), event: 'workflow_dispatch',
  head_branch: 'master', path: '.github/workflows/deploy.yml', run_attempt: 1,
  created_at: new Date(receipt.attemptedAt).toISOString(), status: 'completed', conclusion: 'success', ...patch }; }
test('run correlation rejects duplicate runs, reruns, wrong branch, event or workflow', async () => {
  const { io, receipts } = fixture(); await releaseRequest('approve', '12', io); await releaseRequest('dispatch', '12', io);
  const receipt = receipts.get(12);
  assert.equal(matchedRun([run(receipt)], receipt).id, 99);
  assert.throws(() => matchedRun([run(receipt), run(receipt)], receipt), /DUPLICATE/);
  for (const patch of [{ run_attempt: 2 }, { event: 'push' }, { head_branch: 'other' }, { path: 'other.yml' }, { created_at: '2000-01-01' }, { created_at: 'invalid' }]) {
    assert.throws(() => matchedRun([run(receipt, patch)], receipt), /REQUEST_RUN_INVALID/);
  }
});
test('successful run still requires matching verified AWS authority before public success', async () => {
  const { io, receipts, calls } = fixture(); await releaseRequest('approve', '12', io); await releaseRequest('dispatch', '12', io);
  io.runs = async () => [run(receipts.get(12))];
  io.observe = async () => ({ current: { id: 'different', source } });
  await assert.rejects(releaseRequest('reconcile', '12', io), /REQUEST_NOT_CURRENT/);
  assert.ok(!calls.includes('success'));
  io.observe = async () => { throw Error('PRODUCTION_UNVERIFIED'); };
  await assert.rejects(releaseRequest('reconcile', '12', io), /PRODUCTION_UNVERIFIED/);
  assert.ok(!calls.includes('success'));
});
test('reconciliation publishes sanitized success only after run and AWS verification', async () => {
  const { io, receipts, calls } = fixture(); await releaseRequest('approve', '12', io); await releaseRequest('dispatch', '12', io);
  io.runs = async () => [run(receipts.get(12))];
  const result = await releaseRequest('reconcile', '12', io);
  assert.equal(result.stage, 'deployed'); assert.deepEqual(calls.slice(-3), ['observation', 'success', 'save']);
  assert.equal(receipts.get(12).stage, 'deployed');
});
test('failed private runs remain failures and do not claim an AWS production observation', async () => {
  const { io, receipts, calls } = fixture(); await releaseRequest('approve', '12', io); await releaseRequest('dispatch', '12', io);
  io.runs = async () => [run(receipts.get(12), { conclusion: 'cancelled' })];
  assert.equal((await releaseRequest('reconcile', '12', io)).stage, 'failed'); assert.ok(!calls.includes('observation'));
});
function cloud() {
  const functions = ['request', 'work', 'recovery', 'ingress'].map(role => ({ role, image: 'private-image', concurrency: 2,
    configuration: { FunctionName: 'synthetic-' + role, State: 'Active', LastUpdateStatus: 'Successful', Timeout: 120,
      Environment: { Variables: { PRIVATE_VALUE: 'must-not-appear' } } } }));
  const current = { source, marketing: { source: 'd'.repeat(40) }, imageUri: 'private-image', requestVersion: '2',
    configuration: Object.fromEntries(functions.map(f => [f.configuration.FunctionName, configurationFingerprint(f.configuration)])) };
  const evidence = { etag: 'before', finalEtag: 'before', activeOperation: false, functions, alias: { FunctionVersion: '2' },
    mappings: functions.slice(1, 3).map(f => ({ State: 'Enabled', FunctionArn: 'synthetic:' + f.configuration.FunctionName })) };
  return { current, evidence };
}
test('AWS observation preserves distinct sources and cannot publish private runtime fields', () => {
  const { current, evidence } = cloud(), result = observedProduction(current, evidence);
  assert.equal(result.runtimeSource, source); assert.equal(result.marketingSource, 'd'.repeat(40));
  assert.deepEqual(Object.keys(result).sort(), ['kind', 'marketingSource', 'observedAt', 'runtimeSource', 'version']);
  assert.ok(!JSON.stringify(result).includes('private')); assert.ok(!JSON.stringify(result).includes('must-not-appear'));
  assert.ok(publicStatus('deployed', result).description.length <= 140);
});
test('AWS observation fails on alias, image, config, concurrency, mappings, lock or pointer drift', () => {
  for (const mutate of [e => e.finalEtag = 'after', e => e.activeOperation = true, e => e.alias.FunctionVersion = '3',
    e => e.functions[0].image = 'different', e => e.functions[1].concurrency = 0, e => e.functions[0].configuration.Timeout = 1,
    e => e.functions[2].configuration.State = 'Pending', e => e.mappings[0].State = 'Disabled',
    e => e.mappings[1].FunctionArn = 'synthetic:synthetic-work', e => e.functions.pop()]) {
    const { current, evidence } = cloud(); mutate(evidence); assert.throws(() => observedProduction(current, evidence), /PRODUCTION_UNVERIFIED/);
  }
});
test('public request workflow is manual, master-only and has no AWS or private-dispatch credential', () => {
  const workflow = readFileSync(new URL('../.github/workflows/request-release.yml', import.meta.url), 'utf8');
  assert.match(workflow, /workflow_dispatch:/); assert.match(workflow, /github.ref == 'refs\/heads\/master'/);
  assert.match(workflow, /deployments: write/); assert.match(workflow, /contents: read/);
  assert.doesNotMatch(workflow, /id-token:|secrets\.|pull_request|workflow_run|configure-aws|repository_dispatch/);
});
test('operator CLI observes streaming S3 and Lambda evidence and publishes only allowed fields', () => {
  const dir = mkdtempSync(join(tmpdir(), 'opensight-request-test-'));
  try {
    const { current, evidence } = cloud();
    const config = { version: 1, account: '000000000000', region: 'us-east-1', deployment: 'synthetic',
      operationsBucket: 'synthetic-operations', frontendBucket: 'synthetic-frontend',
      kmsKey: 'arn:aws:kms:us-east-1:000000000000:key/' + '0'.repeat(36), distribution: 'SYNTHETIC',
      eventMappings: ['1'.repeat(36), '2'.repeat(36)], privateRepository: 'example/deploy', publicRepository: repository,
      repositoryId: '1', ownerId: '2', workflowCommit: source };
    const put = (name, value, mode = 0o600) => writeFileSync(join(dir, name), typeof value === 'string' ? value : JSON.stringify(value), { mode });
    put('ci-config.json', config); put('fixture.json', { current, evidence }); mkdirSync(join(dir, 'bin'));
    // This executable emulates the actual CLI boundary, including S3's explicit
    // flags requirement and outfile; a JSON-only request must fail this test.
    put('bin/aws', `#!/usr/bin/env node
const fs=require('node:fs'),p=require('node:path'),root=process.env.OPENSIGHT_OPERATOR_DIR;
const c=JSON.parse(fs.readFileSync(p.join(root,'ci-config.json'))),f=JSON.parse(fs.readFileSync(p.join(root,'fixture.json'))),a=process.argv.slice(2);
const flag=k=>a[a.indexOf(k)+1]; const out=v=>console.log(JSON.stringify(v));
if(a[0]==='sts')out({Account:c.account,Arn:'synthetic-operator'});
else if(a[0]==='s3api'){
 if(!a.includes('--bucket')||!a.includes('--key'))process.exit(2);
 const key=flag('--key');if(key==='ci/operations/active.json'){console.error('(NoSuchKey)');process.exit(1);}
 fs.writeFileSync(a.at(-1),key==='ci/config/deployment.json'?fs.readFileSync(p.join(root,'ci-config.json')):JSON.stringify(f.current));out({ETag:'before'});
}else if(a[0]==='lambda'){
 const i=JSON.parse(flag('--cli-input-json'));
 if(a[1]==='get-event-source-mapping')out(f.evidence.mappings[c.eventMappings.indexOf(i.UUID)]);
 else if(a[1]==='get-alias')out(f.evidence.alias);
 else {const v=f.evidence.functions.find(v=>v.configuration.FunctionName===i.FunctionName);
 out(a[1]==='get-function'?{Configuration:v.configuration,Code:{ResolvedImageUri:v.image}}:{ReservedConcurrentExecutions:v.concurrency});}
}else process.exit(3);
`, 0o700);
    put('bin/gh', `#!/usr/bin/env node
const fs=require('node:fs'),p=require('node:path'),a=process.argv.slice(2),v=JSON.parse(fs.readFileSync(a[a.indexOf('--input')+1]));
fs.appendFileSync(p.join(process.env.OPENSIGHT_OPERATOR_DIR,'published.jsonl'),JSON.stringify(v)+'\\n');console.log(JSON.stringify({id:12}));
`, 0o700);
    const output = execFileSync(process.execPath, [fileURLToPath(new URL('../ops/serverless/release-requests.mjs', import.meta.url)), 'observe'], {
      encoding: 'utf8', env: { ...process.env, OPENSIGHT_OPERATOR_DIR: dir, OPENSIGHT_GH_BINARY: join(dir, 'bin/gh'), PATH: join(dir, 'bin') + ':' + process.env.PATH },
    });
    assert.equal(JSON.parse(output).runtimeSource, source);
    const published = readFileSync(join(dir, 'published.jsonl'), 'utf8');
    for (const forbidden of ['must-not-appear', 'private-image', config.account, config.operationsBucket, config.privateRepository]) assert.ok(!published.includes(forbidden));
    assert.equal(published.trim().split('\n').length, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
