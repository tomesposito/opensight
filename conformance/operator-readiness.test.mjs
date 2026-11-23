import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { staticCsp, staticHeadersPolicy, attachStaticPolicy } from '../ops/serverless/static-security-policy.mjs';
import { hostedDemo } from '../ops/serverless/package-sites.mjs';
import { forwardingTemplate } from '../ops/serverless/mail-forwarder-template.mjs';
const { forward, settings, rawMessage, MAX_INPUT } = createRequire(import.meta.url)('../ops/serverless/mail-forwarder.cjs');
const env = { MAIL_SUPPORT: 'support@example.org', MAIL_PRIVACY: 'privacy@example.org', MAIL_SENDER: 'support@example.org', MAIL_DESTINATION: 'owner@example.net', MAIL_BUCKET: 'example-mail' };
const event = () => ({ Records: [{ eventSource: 'aws:ses', ses: { mail: { messageId: 'test-message-1' }, receipt: { recipients: ['privacy@example.org'], spamVerdict: { status: 'PASS' }, virusVerdict: { status: 'PASS' } } } }] });
function harness() {
  let stored, sends = 0; const body = Buffer.from('From: adversary@example.net\r\nBcc: stolen@example.net\r\nSubject: forged\r\n\r\nHello');
  const io = { size: async () => body.length, read: async () => body, claim: async (_,__,v) => { if(stored)return false;stored=v;return true; }, receipt: async()=>stored,
    send: async (from,to,raw) => { sends++;assert.equal(from,env.MAIL_SENDER);assert.equal(to,env.MAIL_DESTINATION);assert.deepEqual(Buffer.from(/Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)\r\n--/.exec(raw.toString())[1].replace(/\s/g,''),'base64'),body);return 'sent-id'; }, complete:async(_,__,v)=>{stored=v;} };
  return { io, sends:()=>sends, body };
}
test('contact forwarding sends once to its fixed recipient and preserves the original bytes', async()=>{
  const h=harness();assert.deepEqual(await forward(event(),env,h.io),{state:'sent'});assert.deepEqual(await forward(event(),env,h.io),{state:'duplicate'});assert.equal(h.sends(),1);
  const raw=rawMessage(h.body,settings(env),['privacy@example.org']).toString();assert.doesNotMatch(raw,/^Bcc:/m);assert.doesNotMatch(raw,/^Subject: forged/m);assert.match(raw,/Subject: OpenSight inbound contact/);
});
test('contact forwarding rejects other recipients, malformed events and failed verdicts before storage access',async()=>{
  for(const change of [e=>e.Records[0].ses.receipt.recipients.push('other@example.org'),e=>e.Records[0].ses.mail.messageId='../private',e=>e.Records[0].ses.receipt.spamVerdict.status='FAIL',e=>e.Records[0].ses.receipt.virusVerdict.status='FAIL',e=>e.Records.push(e.Records[0])]){
    const e=event();change(e);await assert.rejects(forward(e,env,{size:()=>{throw Error('unexpected storage read');}}),/MAIL_(EVENT_INVALID|ENVELOPE_DENIED|QUARANTINED)/);
  }
  assert.throws(()=>settings({...env,MAIL_DESTINATION:'victim@example.net\r\nBcc: thief@example.net'}),/MAIL_CONFIGURATION_INVALID/);
});
test('contact size is bounded before download and detects changed objects',async()=>{
  await assert.rejects(forward(event(),env,{size:async()=>MAX_INPUT+1,read:()=>assert.fail('downloaded oversized mail')}),/MAIL_SIZE_LIMIT/);
  const h=harness();h.io.size=async()=>1;await assert.rejects(forward(event(),env,h.io),/MAIL_OBJECT_CHANGED/);assert.equal(h.sends(),0);
});
test('contact ambiguous sends remain claimed and never retry sending',async()=>{
  const h=harness();let calls=0;h.io.send=async()=>{calls++;throw Error('provider may have accepted');};
  await assert.rejects(forward(event(),env,h.io),/MAIL_SEND_RECONCILIATION_REQUIRED/);await assert.rejects(forward(event(),env,h.io),/MAIL_RECONCILIATION_REQUIRED/);assert.equal(calls,1);
});
test('contact concurrent duplicate claims allow only one provider send',async()=>{
  const h=harness();const r=await Promise.allSettled([forward(event(),env,h.io),forward(event(),env,h.io)]);assert.equal(h.sends(),1);assert.ok(r.some(x=>x.status==='fulfilled'&&x.value.state==='sent'));
});
test('forwarding infrastructure scopes receipt authority and retains private mail',()=>{
  const t=forwardingTemplate(),r=t.Resources;assert.equal(t.Parameters.Destination.NoEcho,true);assert.equal(r.Function.Properties.ReservedConcurrentExecutions,1);assert.equal(r.Retry.Properties.MaximumRetryAttempts,0);
  assert.equal(r.MailBucket.DeletionPolicy,'Retain');assert.equal(r.MailBucket.Properties.PublicAccessBlockConfiguration.BlockPublicPolicy,true);
  const policy=r.Role.Properties.Policies[0].PolicyDocument.Statement.find(x=>Array.isArray(x.Action)&&x.Action.includes('ses:SendRawEmail'));assert.deepEqual(policy.Action,['ses:SendEmail','ses:SendRawEmail']);assert.deepEqual(policy.Condition['ForAllValues:StringEquals']['ses:Recipients'],[{Ref:'Destination'}]);
  assert.deepEqual(policy.Resource, [{'Fn::Sub':'arn:${AWS::Partition}:ses:${AWS::Region}:${AWS::AccountId}:identity/${Domain}'},{'Fn::Sub':'arn:${AWS::Partition}:ses:${AWS::Region}:${AWS::AccountId}:identity/${Destination}'}]);
  assert.equal(r.Permission.Properties.Principal,'ses.amazonaws.com');assert.ok(r.Permission.Properties.SourceArn);assert.equal(r.Rule.Properties.Rule.Recipients.length,2);
});
test('static CSP rejects unreviewed origins and permits only exact bounded connect endpoints',()=>{
  const inputs={appOrigin:'https://app.example.org',artifactOrigins:['https://example.s3.us-east-1.amazonaws.com']};const c=staticCsp(inputs);
  assert.match(c,/script-src 'self';/);assert.doesNotMatch(c,/unsafe-eval|script-src[^;]*unsafe-inline|https:\/\/\*/);assert.match(c,/object-src 'none'/);
  for(const origin of ['http://app.example.org','https://user@app.example.org','https://app.example.org/path','https://*.example.org','https://app.example.org:8443'])assert.throws(()=>staticCsp({...inputs,appOrigin:origin}));
  assert.throws(()=>staticCsp({...inputs,transitionScriptHashes:['sha256-injected; unsafe-inline']}));
  assert.equal(staticHeadersPolicy('example-policy',inputs).SecurityHeadersConfig.ContentSecurityPolicy.Override,true);
});
test('static policy attaches exclusively to frontend while preserving dynamic embed responses',()=>{
  const d={DefaultCacheBehavior:{TargetOriginId:'frontend'},CacheBehaviors:{Items:[{PathPattern:'/assets/*',TargetOriginId:'frontend'},{PathPattern:'/api/*',TargetOriginId:'api'},{PathPattern:'/embed/sessions/*',TargetOriginId:'api'}]}};
  const n=attachStaticPolicy(d,'00000000-0000-0000-0000-000000000000');assert.equal(n.CacheBehaviors.Items[1].ResponseHeadersPolicyId,undefined);assert.equal(n.CacheBehaviors.Items[2].ResponseHeadersPolicyId,undefined);assert.equal(d.DefaultCacheBehavior.ResponseHeadersPolicyId,undefined);
});
test('hosted demo splits its exact executable bytes without permitting extra or external scripts',()=>{
  const source=Buffer.from('<html><script type="module">const x=1;</script><style>body{}</style></html>'),r=hostedDemo(source);
  assert.equal(r.script.toString(),'const x=1;');assert.match(r.html.toString(),/src="\.\/app.js"/);assert.ok(source.includes('const x=1;'));
  for(const html of ['<html></html>','<script src="https://other.example/a.js"></script>','<script type="module">x()</script><script>alert(1)</script>'])assert.throws(()=>hostedDemo(Buffer.from(html)),/DEMO_SCRIPT_INVALID/);
});
