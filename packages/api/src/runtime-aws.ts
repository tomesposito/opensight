import { Agent } from 'node:https';
import { readFile } from 'node:fs/promises';
import { S3Client } from '@aws-sdk/client-s3';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { SQSClient } from '@aws-sdk/client-sqs';
import { SchedulerClient } from '@aws-sdk/client-scheduler';
import { MetadataError } from './metadata-db.js';
import { secretKey } from './hosted-config.js';
import { InvocationScope } from './runtime-scope.js';

const fail = (code = 'AWS_CONFIG_INVALID'): never => { throw new MetadataError(code, 503); };
export function awsRegion(env: NodeJS.ProcessEnv): string {
  const region = env.AWS_REGION;
  if (!region || !/^(?:us|eu|ap|ca|sa|me|af|il|mx)-(?:[a-z]+-)+\d$/.test(region)) return fail();
  return region;
}
export function secretArn(value: string | undefined, region: string): string {
  if (!value || !new RegExp(`^arn:aws:secretsmanager:${region}:\\d{12}:secret:[A-Za-z0-9/_+=.@-]{1,512}$`).test(value)) return fail();
  return value;
}
/** Strict JSON and bounded values; neither prototype keys nor ignored fields survive. */
export function secretObject(raw: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, string> {
  try {
    if (typeof raw !== 'string' || Buffer.byteLength(raw) > 65536) throw Error();
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
    const fields = Object.entries(value);
    if (fields.some(([key, val]) => ![...required, ...optional].includes(key) || typeof val !== 'string' || !val.length || val.length > 4096 || /[\x00-\x1f\x7f]/.test(val))) throw Error();
    if (required.some(key => !Object.hasOwn(value, key))) throw Error();
    return Object.assign(Object.create(null) as Record<string, string>, value);
  } catch { return fail('AWS_SECRET_INVALID'); }
}

/** One owner per invocation. No default endpoint discovery, retries or warm sockets. */
export class InvocationAws {
  readonly region: string;
  readonly hosts: { secrets: string; sqs: string; scheduler: string; s3: string; smtp: string };
  readonly secrets: SecretsManagerClient;
  readonly s3: S3Client;
  readonly sqs: SQSClient;
  readonly scheduler: SchedulerClient;
  private readonly agents: Agent[] = [];
  private readonly controllers = new Set<AbortController>();
  private closed = false;
  private closing?: Promise<void>;
  constructor(readonly scope: InvocationScope, env: NodeJS.ProcessEnv) {
    this.region = awsRegion(env);
    this.hosts = { secrets: `secretsmanager.${this.region}.amazonaws.com`, sqs: `sqs.${this.region}.api.aws`,
      scheduler: `scheduler.${this.region}.api.aws`, s3: `s3.${this.region}.amazonaws.com`, smtp: `email-smtp.${this.region}.api.aws` };
    const options = (host: string, family: 4 | 6) => {
      const httpsAgent = new Agent({ family, keepAlive: false, maxSockets: 2, maxFreeSockets: 0, rejectUnauthorized: true, minVersion: 'TLSv1.2' });
      this.agents.push(httpsAgent);
      return { region: this.region, endpoint: `https://${host}`, maxAttempts: 1,
        requestHandler: { httpsAgent, connectionTimeout: 2000, requestTimeout: 5000, throwOnRequestTimeout: true } };
    };
    this.secrets = new SecretsManagerClient(options(this.hosts.secrets, 6));
    this.s3 = new S3Client({ ...options(this.hosts.s3, 4), forcePathStyle: true, followRegionRedirects: false });
    this.sqs = new SQSClient({ ...options(this.hosts.sqs, 6), useQueueUrlAsEndpoint: false });
    this.scheduler = new SchedulerClient(options(this.hosts.scheduler, 6));
    scope.own(this);
  }
  async call<T>(work: (signal: AbortSignal) => Promise<T>, maximumMs = 6000): Promise<T> {
    this.scope.check(); if (this.closed) return fail('AWS_INVOCATION_CLOSED');
    const controller = new AbortController(); this.controllers.add(controller);
    try { return await this.scope.stage(() => work(controller.signal), maximumMs, () => controller.abort(), 'AWS_REQUEST_TIMEOUT'); }
    catch (error) {
      if (error instanceof MetadataError) throw error;
      return fail('AWS_REQUEST_FAILED');
    } finally { controller.abort(); this.controllers.delete(controller); }
  }
  async secret(arn: string | undefined, required: readonly string[], optional: readonly string[] = []): Promise<Record<string, string>> {
    const id = secretArn(arn, this.region);
    const response = await this.call(signal => this.secrets.send(new GetSecretValueCommand({ SecretId: id, VersionStage: 'AWSCURRENT' }), { abortSignal: signal }));
    if (response.SecretBinary !== undefined || !response.VersionStages?.includes('AWSCURRENT') || response.ARN !== id) return fail('AWS_SECRET_INVALID');
    return secretObject(response.SecretString, required, optional);
  }
  force = (): void => {
    this.closed = true;
    for (const controller of this.controllers) controller.abort();
    for (const client of [this.secrets, this.s3, this.sqs, this.scheduler]) client.destroy();
    for (const agent of this.agents) agent.destroy();
  };
  close(): Promise<void> {
    return this.closing ??= (async () => {
      // Subscribe before destroying: destruction is not proof of socket closure.
      const sockets = new Set(this.agents.flatMap(agent => [...Object.values(agent.sockets), ...Object.values(agent.freeSockets)].flatMap(v => v ?? [])));
      const closures = [...sockets].map(socket => new Promise<void>(resolve => socket.once('close', () => resolve())));
      this.force(); await Promise.all(closures);
    })();
  }
}

export function databaseUrl(env: NodeJS.ProcessEnv, login: Record<string, string>): string {
  const host = env.OPENSIGHT_DB_HOST, port = env.OPENSIGHT_DB_PORT ?? '5432', name = env.OPENSIGHT_DB_NAME;
  if (!host || !/^[a-z0-9][a-z0-9.-]{1,252}$/.test(host) || !/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535
    || !name || !/^[a-z][a-z0-9_]{0,62}$/.test(name) || !login.username || !/^[a-z][a-z0-9_]{0,62}$/.test(login.username) || !login.password) return fail('AWS_SECRET_INVALID');
  return `postgresql://${encodeURIComponent(login.username)}:${encodeURIComponent(login.password)}@${host}:${port}/${name}`;
}
export const operatorFields = ['username', 'password', 'operatorKey', 'signingKey', 'encryptionKey', 'ingressKeys'] as const;
/** A fresh environment object is private to this invocation; no process.env mutation. */
export async function awsEnvironment(aws: InvocationAws, source: NodeJS.ProcessEnv, bootstrap = false): Promise<NodeJS.ProcessEnv> {
  const [operator, tenant] = await Promise.all([
    aws.secret(source.OPENSIGHT_OPERATOR_SECRET_ARN, operatorFields), aws.secret(source.OPENSIGHT_TENANT_SECRET_ARN, ['username', 'password']),
  ]);
  if (operator.username === tenant.username) return fail('AWS_SECRET_INVALID');
  const keys = [operator.operatorKey, operator.signingKey, operator.encryptionKey].map(secretKey);
  if (new Set(keys.map(k => k.toString('base64'))).size !== 3) return fail('AWS_SECRET_INVALID');
  let ca = source.OPENSIGHT_POSTGRES_CA;
  if (!ca) ca = await readFile('/var/task/ops/serverless/rds-ca.pem', 'utf8');
  const env = { ...source, OPENSIGHT_POSTGRES_CA: ca,
    OPENSIGHT_POSTGRES_OPERATOR_URL: databaseUrl(source, operator), OPENSIGHT_POSTGRES_TENANT_URL: databaseUrl(source, tenant),
    OPENSIGHT_OPERATOR_KEY: operator.operatorKey, OPENSIGHT_AUTH_SIGNING_KEY: operator.signingKey, OPENSIGHT_AUTH_ENCRYPTION_KEY: operator.encryptionKey,
    OPENSIGHT_INGRESS_KEYS: operator.ingressKeys };
  if (bootstrap) {
    const owner = await aws.secret(source.OPENSIGHT_BOOTSTRAP_SECRET_ARN, ['username', 'password']);
    if ([operator.username, tenant.username].includes(owner.username)) return fail('AWS_SECRET_INVALID');
    env.OPENSIGHT_POSTGRES_OPERATOR_URL = databaseUrl(source, owner);
  }
  return env;
}
