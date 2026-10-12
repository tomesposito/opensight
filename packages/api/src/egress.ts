import { MetadataError } from './metadata-db.js';

export interface EgressEndpoints { secrets: string; sqs: string; scheduler: string; s3: string; smtp: string }
/** Only the D-19 IPv6 candidate is implemented. Route changes require an explicit design. */
export function egressEndpoints(env: NodeJS.ProcessEnv, region: string): EgressEndpoints {
  if ((env.OPENSIGHT_EGRESS_PROFILE ?? 'ipv6') !== 'ipv6') throw new MetadataError('EGRESS_ROUTE_UNSUPPORTED', 503);
  const hosts: EgressEndpoints = { secrets: `secretsmanager.${region}.amazonaws.com`, sqs: `sqs.${region}.api.aws`,
    scheduler: `scheduler.${region}.api.aws`, s3: `s3.${region}.amazonaws.com`, smtp: `email-smtp.${region}.api.aws` };
  for (const [service, host] of Object.entries(hosts)) {
    const input = env[`OPENSIGHT_${service.toUpperCase()}_ENDPOINT`];
    if (input !== undefined && input !== `https://${host}`) throw new MetadataError('EGRESS_ENDPOINT_INVALID', 503);
  }
  if (env.OPENSIGHT_SMTP_HOST !== undefined && env.OPENSIGHT_SMTP_HOST !== hosts.smtp) throw new MetadataError('EGRESS_ENDPOINT_INVALID', 503);
  if (env.OPENSIGHT_SMTP_PORT !== undefined && env.OPENSIGHT_SMTP_PORT !== '465') throw new MetadataError('EGRESS_ROUTE_UNSUPPORTED', 503);
  return hosts;
}
