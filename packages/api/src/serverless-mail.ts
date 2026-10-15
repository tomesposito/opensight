import { MailError, smtpFromEnvironment, type MailTransport, type SmtpInvocationOptions } from './mail.js';
import type { InvocationAws } from './runtime-aws.js';
import { egressEndpoints } from './egress.js';

/** This factory has no test-stub branch. Credentials are fetched afresh per attempt. */
export function serverlessMail(aws: InvocationAws, env: NodeJS.ProcessEnv,
  factory: (env: NodeJS.ProcessEnv, options: SmtpInvocationOptions) => MailTransport = smtpFromEnvironment): MailTransport {
  const hosts = egressEndpoints(env, aws.region);
  if (env.OPENSIGHT_WORKER_SMTP_CAPABILITY !== undefined && env.OPENSIGHT_WORKER_SMTP_CAPABILITY !== 'configured') throw new MailError('SMTP_CONFIG_INVALID');
  const configured = !!env.OPENSIGHT_SMTP_HOST && !!env.OPENSIGHT_SMTP_FROM && !!env.OPENSIGHT_SMTP_SECRET_ARN;
  return { configured, deliveryConfigured: env.OPENSIGHT_WORKER_SMTP_CAPABILITY === 'configured' || configured, async send(message, authorize) {
    if (!configured) throw new MailError('SMTP_NOT_CONFIGURED');
    const secret = await aws.secret(env.OPENSIGHT_SMTP_SECRET_ARN, ['username', 'password']);
    const transport = factory({ OPENSIGHT_SMTP_HOST: hosts.smtp, OPENSIGHT_SMTP_PORT: '465', OPENSIGHT_SMTP_FROM: env.OPENSIGHT_SMTP_FROM,
      OPENSIGHT_SMTP_USER: secret.username, OPENSIGHT_SMTP_PASSWORD: secret.password }, {
      family: 6, signal: aws.scope.signal, timeoutMs: Math.min(30000, aws.scope.remaining()), ownSocket: socket => {
        const closed = new Promise<void>(resolve => socket.once('close', () => resolve()));
        aws.scope.own({ force: () => socket.destroy(), close: async () => { socket.destroy(); await closed; } });
        socket.once('secureConnect', () => { if (socket.remoteFamily !== 'IPv6') socket.destroy(new MailError('SMTP_SEND_FAILED')); });
      },
    });
    if (!transport.configured) throw new MailError('SMTP_NOT_CONFIGURED');
    await transport.send(message, authorize);
  } };
}
