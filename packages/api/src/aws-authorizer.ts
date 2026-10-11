import { authorizeIngress } from './runtime-ingress.js';
import { InvocationAws } from './runtime-aws.js';
import { InvocationScope, invocationDeadline, type InvocationContext } from './runtime-scope.js';

/** Secret-only IAM role, public Lambda network, no database or membership construction. */
export async function handler(event: unknown, context: InvocationContext) {
  try {
    if (!event || typeof event !== 'object' || !('headers' in event) || !event.headers || typeof event.headers !== 'object') return { isAuthorized: false };
    const headers = event.headers as Record<string, unknown>;
    if (typeof headers['x-opensight-ingress-secret'] !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(headers['x-opensight-ingress-secret'])
      || typeof headers['x-opensight-ingress-key-id'] !== 'string') return { isAuthorized: false };
    return await new InvocationScope(invocationDeadline(context, Date.now(), 8000)).run(async scope => {
      const aws = new InvocationAws(scope, process.env, 4);
      const secret = await aws.secret(process.env.OPENSIGHT_INGRESS_SECRET_ARN, ['ingressKeys']);
      return authorizeIngress(event, { ...process.env, OPENSIGHT_INGRESS_KEYS: secret.ingressKeys });
    });
  } catch { return { isAuthorized: false }; }
}
