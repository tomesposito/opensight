/** Shared local-file and upload boundary. No AWS client or credential storage. */
export function assertNoCredentials(value: unknown, depth = 0): void {
  if (depth > 100) throw new Error('DEFINITION_INVALID');
  if (typeof value === 'string' && (/(?:AKIA|ASIA)[A-Z0-9]{16}/.test(value) || /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(value)
    || /[a-z][a-z0-9+.-]*:\/\/[^/\s:]+:[^/\s@]+@/i.test(value))) throw new Error('CREDENTIAL_MATERIAL_REFUSED');
  if (Array.isArray(value)) { value.forEach(v => assertNoCredentials(v, depth + 1)); return; }
  if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
    if (/^(?:credentials?|credentialPair|accessKey(?:Id)?|secret(?:AccessKey|Key)?|sessionToken|password|token|authorization|privateKey|clientSecret|apiKey)$/i.test(key)) throw new Error('CREDENTIAL_MATERIAL_REFUSED');
    assertNoCredentials(child, depth + 1);
  }
}
