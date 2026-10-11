import test from 'node:test';
import assert from 'node:assert/strict';
import { InvocationAws } from '../dist/runtime-aws.js';
import { handler } from '../dist/aws-authorizer.js';
import { runtimeEnv, event, context } from './runtime-helpers.mjs';
const secretArn = 'arn:aws:secretsmanager:us-east-1:000000000000:secret:synthetic';
function environment(t) {
  const before = process.env; process.env = { ...before, ...runtimeEnv(), OPENSIGHT_INGRESS_SECRET_ARN: secretArn, AWS_REGION: 'us-east-1', AWS_ACCESS_KEY_ID: 'synthetic', AWS_SECRET_ACCESS_KEY: 'synthetic', AWS_SESSION_TOKEN: 'synthetic' };
  t.after(() => { process.env = before; });
}
test('SR4a authorizer fetches only the current ingress secret over IPv4 and closes its invocation clients', async t => {
  environment(t); let secrets = 0, instance;
  t.mock.method(InvocationAws.prototype, 'secret', async function(arn, required, optional) {
    instance = this; secrets++; assert.equal(arn, secretArn); assert.deepEqual(required, ['ingressKeys']); assert.equal(optional, undefined);
    const config = await this.secrets.config.requestHandler.configProvider;
    assert.equal(config.httpsAgent.options.family, 4); assert.equal(config.httpsAgent.options.rejectUnauthorized, true); assert.equal(await this.secrets.config.maxAttempts(), 1);
    return { ingressKeys: runtimeEnv().OPENSIGHT_INGRESS_KEYS };
  });
  assert.equal((await handler(event(), context)).isAuthorized, true); assert.equal(secrets, 1);
  await assert.rejects(instance.call(async () => 'late'));
  assert.equal((await handler(event(), context)).isAuthorized, true); assert.equal(secrets, 2, 'no cross-invocation key cache');
});
test('SR4a missing ingress headers avoid secret lookup; secret/config/service failures deny safely', async t => {
  environment(t); let calls = 0;
  t.mock.method(InvocationAws.prototype, 'secret', async () => { calls++; throw Error('private details'); });
  for (const raw of [null, {}, { headers: {} }, { headers: { 'x-opensight-ingress-secret': 'short' } }]) assert.deepEqual(await handler(raw, context), { isAuthorized: false });
  assert.equal(calls, 0); assert.deepEqual(await handler(event(), context), { isAuthorized: false }); assert.equal(calls, 1);
});
