export function staticCsp({ appOrigin, artifactOrigins = [], transitionScriptHashes = [] }) {
  const origin = value => {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password || url.port
      || !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(url.hostname)) throw Error('CSP_ORIGIN_INVALID');
    return value;
  };
  if (!Array.isArray(artifactOrigins) || artifactOrigins.length > 4 || !Array.isArray(transitionScriptHashes)
    || transitionScriptHashes.length > 1 || transitionScriptHashes.some(h => !/^sha256-[A-Za-z0-9+/]{43}=$/.test(h))) throw Error('CSP_INPUT_INVALID');
  const connect = [...new Set([origin(appOrigin), ...artifactOrigins.map(origin)])];
  const script = ["'self'", ...transitionScriptHashes.map(h => `'${h}'`)];
  const csp = ["default-src 'self'", `script-src ${script.join(' ')}`, "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:", "font-src 'self' data:", "media-src 'self' blob:", "frame-src 'self'",
    "worker-src 'self' blob:", "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'self'",
    `connect-src 'self' ${connect.join(' ')}`].join('; ');
  if (csp.length > 1783) throw Error('CSP_TOO_LONG');
  return csp;
}
export function staticHeadersPolicy(name, settings) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(name)) throw Error('CSP_NAME_INVALID');
  return { Name: name, Comment: 'Reviewed static frontend security; dynamic embed responses excluded',
    SecurityHeadersConfig: {
      ContentSecurityPolicy: { ContentSecurityPolicy: staticCsp(settings), Override: true },
      StrictTransportSecurity: { AccessControlMaxAgeSec: 31536000, Override: false },
      ContentTypeOptions: { Override: true }, FrameOptions: { FrameOption: 'SAMEORIGIN', Override: false },
      ReferrerPolicy: { ReferrerPolicy: 'strict-origin-when-cross-origin', Override: false },
    } };
}
export function attachStaticPolicy(distribution, policyId) {
  if (!/^[a-f0-9-]{36}$/.test(policyId)) throw Error('CSP_POLICY_ID_INVALID');
  const next = structuredClone(distribution), behaviors = [next.DefaultCacheBehavior, ...(next.CacheBehaviors?.Items ?? [])];
  let changed = 0;
  for (const behavior of behaviors) {
    if (behavior.TargetOriginId === 'frontend') { behavior.ResponseHeadersPolicyId = policyId; changed++; }
    else if (behavior.ResponseHeadersPolicyId) throw Error('CSP_DYNAMIC_POLICY_PRESENT');
  }
  if (changed !== 2 || next.DefaultCacheBehavior.TargetOriginId !== 'frontend'
    || !next.CacheBehaviors.Items.some(b => b.PathPattern === '/assets/*' && b.TargetOriginId === 'frontend')) throw Error('CSP_BEHAVIOR_SCOPE_INVALID');
  return next;
}
