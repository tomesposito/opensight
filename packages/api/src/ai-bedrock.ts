import { createHash, createHmac } from 'node:crypto';

export interface AwsIdentity { accessKeyId: string; secretAccessKey: string; sessionToken?: string }
export interface BedrockOptions { region: string; credentials(): Promise<AwsIdentity>; clock?: () => Date }
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const hmac = (key: string | Buffer, text: string) => createHmac('sha256', key).update(text).digest();
const encode = (text: string) => encodeURIComponent(text).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** SigV4 for the fixed Bedrock Converse endpoint. No tenant controls the host. */
export function signConverse(region: string, model: string, body: string, identity: AwsIdentity, now = new Date()) {
  const host = `bedrock-runtime.${region}.amazonaws.com`, path = `/model/${encode(model)}/converse`;
  const date = now.toISOString().replace(/[:-]|\.\d{3}/g, ''), day = date.slice(0, 8);
  const headers: Record<string, string> = { 'content-type': 'application/json', host, 'x-amz-date': date, 'x-amz-content-sha256': hash(body),
    ...(identity.sessionToken ? { 'x-amz-security-token': identity.sessionToken } : {}) };
  const names = Object.keys(headers).sort(), signed = names.join(';');
  // Bedrock uses the standard service URI encoding (double-encode the escaped model ID).
  const canonical = ['POST', path.split('/').map(encode).join('/'), '', names.map(n => `${n}:${headers[n]!.trim()}\n`).join(''), signed, hash(body)].join('\n');
  const scope = `${day}/${region}/bedrock/aws4_request`;
  const signing = hmac(hmac(hmac(hmac(`AWS4${identity.secretAccessKey}`, day), region), 'bedrock'), 'aws4_request');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${identity.accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${hmac(signing, `AWS4-HMAC-SHA256\n${date}\n${scope}\n${hash(canonical)}`).toString('hex')}`;
  return { url: `https://${host}${path}`, headers };
}
