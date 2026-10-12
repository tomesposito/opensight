import test from 'node:test';
import assert from 'node:assert/strict';
import { ciConfig, ciSubject, ciTrust, ciPolicy, ciDeny, ciClosedTrust, ciSessionRevocation } from '../ops/serverless/ci-policy.mjs';
import { disableCi, enableCi } from '../ops/serverless/ci-access.mjs';
const c = { version: 1, account: '000000000000', region: 'us-east-1', deployment: 'synthetic', operationsBucket: 'synthetic-state', frontendBucket: 'synthetic-web',
  kmsKey: 'arn:aws:kms:us-east-1:000000000000:key/00000000-0000-0000-0000-000000000000', distribution: 'SYNTHETICDIST',
  eventMappings: ['00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002'], privateRepository: 'example/deployment',
  repositoryId: '123', ownerId: '456', workflowCommit: 'a'.repeat(40) };
test('SR4c OIDC fixes immutable repository identity, ref, event and pinned workflow', () => {
  const subject = ciSubject(c), condition = ciTrust(c).Statement[0].Condition;
  assert.equal(condition.StringEquals['token.actions.githubusercontent.com:sub'], subject);
  assert.equal(condition.StringEquals['token.actions.githubusercontent.com:aud'], 'sts.amazonaws.com');
  for (const patch of [{ repositoryId: '124' }, { ownerId: '457' }, { workflowCommit: 'b'.repeat(40) }]) assert.notEqual(ciSubject({ ...c, ...patch }), subject);
  for (const patch of [{ workflowCommit: 'master' }, { privateRepository: '*' }, { account: 'unknown' }]) assert.throws(() => ciConfig({ ...c, ...patch }));
  assert.ok(subject.includes('ref:refs/heads/master:event_name:workflow_dispatch:job_workflow_ref:'));
});
test('SR4c deployment policy excludes administration, state and tenant data; preflight has no mutation grants', () => {
  const read = ciPolicy(c, 'read'), deploy = ciPolicy(c, 'deploy');
  assert.ok(read.Statement.filter(s => s.Effect === 'Allow').every(s => [s.Action].flat().every(a => /:(Get|Decrypt)/.test(a))));
  const allowed = deploy.Statement.filter(s => s.Effect === 'Allow');
  assert.ok(!JSON.stringify(allowed).includes('-migration'));
  assert.ok(!JSON.stringify(allowed).includes('secretsmanager:'));
  assert.deepEqual(allowed.filter(s => [s.Action].flat().some(a => a.startsWith('iam:'))).map(s => s.Action), ['iam:PassRole']);
  assert.ok(allowed.find(s => s.Action === 'iam:PassRole').Resource.endsWith('/synthetic-ci-watchdog-invoke'));
  assert.deepEqual(allowed.find(s => s.Action === 'iam:PassRole').Condition, { StringEquals: { 'iam:PassedToService': 'scheduler.amazonaws.com' } });
  assert.ok(!JSON.stringify(allowed).includes('UpdateFunctionConfiguration'));
  assert.deepEqual(allowed.filter(s => s.Resource === '*').map(s => s.Action), ['ecr:GetAuthorizationToken']);
  assert.ok(allowed.filter(s => [s.Action].flat().some(a => a.startsWith('s3:'))).every(s => !JSON.stringify(s.Resource).includes('terraform.tfstate')));
});
test('SR4c emergency disable denies existing sessions before removing new trust and preserves partial shutdown', async () => {
  const calls = [];
  const aws = async (service, action, args) => {
    calls.push({ service, action, args });
    if (action === 'get-role-policy') return { PolicyDocument: ciDeny };
    if (action === 'get-role') return { Role: { AssumeRolePolicyDocument: ciClosedTrust(c) } };
    return {};
  };
  const result = await disableCi(aws, c);
  assert.equal(result.activeSessionAndFreshFederationVerificationRequired, true);
  assert.deepEqual(calls.slice(0, 4).map(c => c.action), ['put-role-policy', 'put-role-policy', 'update-assume-role-policy', 'update-assume-role-policy']);
  assert.ok(calls.every(c => /-ci-(read|deploy)$/.test(c.args['role-name'])));
  let count = 0; await assert.rejects(disableCi(async () => { if (++count === 3) throw Error('synthetic'); return {}; }, c), /synthetic/);
  assert.equal(count, 3);
});
test('SR4c access recovery verifies session cutoff and exact trust before removing emergency denial', async () => {
  const calls = [];let cutoff;
  await assert.rejects(enableCi(async (service, action, args) => {
    calls.push(action);
    if(action==='put-role-policy')cutoff=JSON.parse(args['policy-document']);
    if(action==='get-role-policy')return {PolicyDocument:cutoff};
    return action==='get-role'?{Role:{AssumeRolePolicyDocument:{Statement:[]}}}:{};
  }, c), /CI_TRUST_UNVERIFIED/);
  assert.ok(!calls.includes('delete-role-policy'));
  const calls2=[];
  const result=await enableCi(async(service,action,args)=>{
    calls2.push({action,args});
    if(action==='put-role-policy')cutoff=JSON.parse(args['policy-document']);
    if(action==='get-role-policy')return {PolicyDocument:cutoff};
    if(action==='get-role')return {Role:{AssumeRolePolicyDocument:ciTrust(c)}};
    return {};
  },c);
  assert.ok(Date.parse(result.revokedBefore)<=Date.now());
  assert.ok(calls2.findIndex(v=>v.action==='get-role-policy')<calls2.findIndex(v=>v.action==='update-assume-role-policy'));
  assert.ok(calls2.filter(v=>v.action==='delete-role-policy').every(v=>v.args['policy-name']==='OpenSightEmergencyDeny'));
});
test('SR4c recovery retains an explicit issue-time deny for old sessions',()=>{
  const now=Date.now(),policy=ciSessionRevocation(now),cutoff=policy.Statement[0].Condition.DateLessThan['aws:TokenIssueTime'];
  assert.equal(policy.Statement[0].Effect,'Deny');assert.equal(policy.Statement[0].Action,'*');
  assert.ok(new Date(now-1000).toISOString()<cutoff);
  assert.ok(!(new Date(now+1000).toISOString()<cutoff));
});
