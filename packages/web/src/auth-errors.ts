import { ApiError } from './api-client.js';

export interface AuthNotice { message: string; code?: string }
const messages: Readonly<Record<string, string>> = {
  AUTHENTICATION_FAILED: 'Invalid email or password. Check your sign-in details and authenticator code. If you still cannot sign in, contact your administrator.',
  AUTH_RATE_LIMITED: 'Too many sign-in attempts. Wait 15 minutes before trying again.',
  AUTH_KEY_REVOKED: 'This session is no longer valid. Sign in again. If the problem continues, contact your administrator.',
  SESSION_EXPIRED: 'Your session has expired. Sign in again to continue.',
  BUILTIN_AUTH_UNAVAILABLE: 'Email and password sign-in is not available on this server. Contact your administrator.',
  HOSTED_REQUEST_INVALID: 'The server could not accept the sign-in request. Contact your administrator.',
  UNTRUSTED_ORIGIN: 'This workspace address is not trusted by the server. Use the address provided by your administrator.',
  FORGED_PRINCIPAL: 'The server rejected the request identity. Contact your administrator.',
  EMAIL_INVALID: 'Enter a valid email address.',
  PASSWORD_INVALID: 'Enter your password using at least 15 characters and no more than 1,024 bytes.',
  METADATA_INVALID: 'Check the workspace ID from your invitation.',
  PRINCIPAL_REQUIRED: 'Sign in to access your workspace.',
  UNKNOWN_PRINCIPAL: 'Your account cannot access this workspace. Contact your administrator.',
  TENANT_UNAVAILABLE: 'This workspace is unavailable. Contact your administrator.',
  AUTHORIZATION_REVISED: 'Your access has changed. Sign in again to continue.',
  AUTH_RESPONSE_INVALID: 'The server returned an invalid sign-in response. Contact your administrator.',
  AUTH_REQUEST_SUPERSEDED: 'Sign-in was cancelled. Please try again.',
};
export function authNotice(error: unknown): AuthNotice {
  if (error instanceof ApiError) {
    const code = error.errorCode;
    return { message: code && messages[code] || (error.status === 401 || error.status === 403
      ? 'Your session is no longer valid. Sign in again to continue.'
      : 'Unable to complete sign-in. Check your connection and try again.'),
    ...(code && /^[A-Z][A-Z0-9_]{0,79}$/.test(code) ? { code } : {}) };
  }
  return { message: 'Unable to reach your workspace. Check your connection and try again.' };
}
