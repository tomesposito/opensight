import { MetadataError } from './metadata-db.js';
import { identifier } from './metadata-resources.js';

export interface HostedConfig {
  readonly origin: string; readonly issuer: string; readonly audience: string;
  readonly sessionSeconds: number; readonly invitationSeconds: number;
  readonly keyId: string; readonly signingKey: Buffer; readonly encryptionKey: Buffer;
  readonly operatorKey: Buffer;
}
export function configError(): never { throw new MetadataError('HOSTED_CONFIG_INVALID', 503); }
export function secretKey(value: string | undefined): Buffer {
  if (!value) configError();
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length !== 32 || bytes.toString('base64') !== value) configError();
  return bytes;
}
function seconds(value: string | undefined, maximum: number, minimum = 1): number {
  if (!value || !/^[1-9]\d*$/.test(value) || Number(value) < minimum || Number(value) > maximum) configError();
  return Number(value);
}
/** All secrets and deployment configuration enter through environment configuration. */
export function hostedConfig(env: NodeJS.ProcessEnv = process.env): HostedConfig {
  const origin = env.OPENSIGHT_PUBLIC_ORIGIN;
  try {
    const url = new URL(origin ?? '');
    // Loopback http origins are permitted for local development only. The origin check is
    // CSRF protection: it stops a remote site from driving the API with the victim's browser.
    // A loopback origin cannot be exploited remotely — only code already running on this machine
    // can present Origin: http://localhost — and sessions are Bearer <redacted> memory, never cookies,
    // so there is no ambient credential to ride on. This mirrors RFC 8252 section 7.3, which treats
    // http://localhost redirect URIs as safe for the same reason. Everything else still requires https.
    const loopbackHttp = url.protocol === 'http:' && url.port !== '' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !loopbackHttp) configError();
    if (url.origin !== origin || url.username || url.password) configError();
  } catch { configError(); }
  const issuer = env.OPENSIGHT_AUTH_ISSUER, audience = env.OPENSIGHT_AUTH_AUDIENCE;
  if (!issuer || !audience || [issuer, audience].some(v => v.length > 512 || /[\s\x00-\x1f]/.test(v))) configError();
  const keyId = env.OPENSIGHT_AUTH_KEY_ID;
  try { identifier(keyId); } catch { configError(); }
  const signingKey = secretKey(env.OPENSIGHT_AUTH_SIGNING_KEY), encryptionKey = secretKey(env.OPENSIGHT_AUTH_ENCRYPTION_KEY), operatorKey = secretKey(env.OPENSIGHT_OPERATOR_KEY);
  if (signingKey.equals(encryptionKey) || signingKey.equals(operatorKey) || encryptionKey.equals(operatorKey)) configError();
  return Object.freeze({ origin: origin!, issuer, audience, keyId: keyId!, signingKey, encryptionKey, operatorKey,
    sessionSeconds: seconds(env.OPENSIGHT_SESSION_SECONDS, 36000, 900), invitationSeconds: seconds(env.OPENSIGHT_INVITATION_SECONDS, 604800) });
}
