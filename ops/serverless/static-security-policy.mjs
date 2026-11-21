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
export function attachStaticCspFunction(distribution, functionArn) {
  if (!/^arn:aws:cloudfront::[0-9]{12}:function\/[A-Za-z0-9_-]{1,64}$/.test(functionArn)) throw Error('CSP_FUNCTION_ARN_INVALID');
  const next = structuredClone(distribution);
  const behaviors = [next.DefaultCacheBehavior, ...(next.CacheBehaviors?.Items ?? [])];
  const frontend = behaviors.filter(b => b.TargetOriginId === 'frontend');
  if (frontend.length !== 2 || next.DefaultCacheBehavior.TargetOriginId !== 'frontend'
    || !next.CacheBehaviors.Items.some(b => b.PathPattern === '/assets/*' && b.TargetOriginId === 'frontend')) throw Error('CSP_BEHAVIOR_SCOPE_INVALID');
  for (const behavior of frontend) {
    const items = behavior.FunctionAssociations?.Items ?? [];
    if (items.some(item => item.EventType === 'viewer-response' && item.FunctionARN !== functionArn)
      || (behavior.LambdaFunctionAssociations?.Items ?? []).some(item => item.EventType === 'viewer-response')) throw Error('CSP_RESPONSE_FUNCTION_CONFLICT');
    if (!items.some(item => item.EventType === 'viewer-response')) items.push({ FunctionARN: functionArn, EventType: 'viewer-response' });
    behavior.FunctionAssociations = { Quantity: items.length, Items: items };
  }
  return next;
}
