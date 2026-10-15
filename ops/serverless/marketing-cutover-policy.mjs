import { canonical, configurationFingerprint, frontendFiles } from './release-safety.mjs';
import { digest } from './release-manifest.mjs';
import { marketingFiles } from './frontend-policy.mjs';
const hash = x => /^[a-f0-9]{64}$/.test(x ?? '');
const sha = x => /^[a-f0-9]{40}$/.test(x ?? '');
export function originPatch(configuration, before, after) {
  if (!/^https:\/\/[a-z0-9][a-z0-9.-]+[a-z0-9]$/.test(before) || after !== before.replace('https://', 'https://app.')
    || configuration.Environment?.Variables?.OPENSIGHT_PUBLIC_ORIGIN !== before || !configuration.RevisionId) throw Error('CUTOVER_ORIGIN_DRIFT');
  return { RevisionId: configuration.RevisionId, Environment: { Variables: { ...configuration.Environment.Variables, OPENSIGHT_PUBLIC_ORIGIN: after } } };
}
// This is a distinct composite release, not an approval of a new runtime or
// compatibility hash. Read every current and selected object and verify its
// declared digest before publishing any of the marketing subtree.
export function cutoverRelease(current, manifest, manifestDigest, frontend, before, after, { requestVersion, completedAt }) {
  if (!sha(current.source) || !hash(current.compatibility) || !sha(manifest.source) || !hash(manifestDigest)
    || !/^[1-9][0-9]*$/.test(requestVersion ?? '') || requestVersion === current.requestVersion
    || current.marketing || !Number.isSafeInteger(completedAt) || completedAt <= 0) throw Error('CUTOVER_RECORD_INVALID');
  frontendFiles({ version: 1, kind: 'frontend', files: current.files }); frontendFiles(frontend, true);
  if (Object.keys(current.files).some(name => name.startsWith('marketing/'))) throw Error('CUTOVER_ALREADY_PRESENT');
  const names = Object.keys(current.configuration).sort();
  if (names.length !== 4 || canonical(Object.keys(before).sort()) !== canonical(names)
    || canonical(Object.keys(after).sort()) !== canonical(names)) throw Error('CUTOVER_RUNTIME_DRIFT');
  if (new Set(names.map(n => before[n].config.Environment?.Variables?.OPENSIGHT_PUBLIC_ORIGIN)).size !== 1
    || new Set(names.map(n => after[n].config.Environment?.Variables?.OPENSIGHT_PUBLIC_ORIGIN)).size !== 1) throw Error('CUTOVER_RUNTIME_DRIFT');
  const configuration = {};
  for (const name of names) {
    const old = before[name], next = after[name];
    if (old.image !== current.imageUri || next.image !== current.imageUri
      || configurationFingerprint(old.config) !== current.configuration[name]) throw Error('CUTOVER_RUNTIME_DRIFT');
    const patch = originPatch(old.config, old.config.Environment?.Variables?.OPENSIGHT_PUBLIC_ORIGIN, next.config.Environment?.Variables?.OPENSIGHT_PUBLIC_ORIGIN);
    const expected = { ...old.config, Environment: patch.Environment };
    if (canonical(next.config.VpcConfig) !== canonical(old.config.VpcConfig) || configurationFingerprint(next.config) !== configurationFingerprint(expected)) throw Error('CUTOVER_RUNTIME_DRIFT');
    configuration[name] = configurationFingerprint(next.config);
  }
  const files = { ...current.files, ...Object.fromEntries(marketingFiles.map(name => [name, frontend.files[name]])) };
  // The operator must supply a newly published and read-back-verified alias.
  return { ...current, id: digest(canonical({ previous: current.id, manifest: manifestDigest, files, configuration })),
    previous: current.id, requestVersion, files, configuration, marketing: { source: manifest.source, manifest: manifestDigest }, completedAt };
}
export function checkCutoverPlan(plan) {
  const allowed = new Map([
    ['aws_cloudfront_distribution.application', 'update'], ['aws_cloudfront_function.static[0]', 'create'],
    ['aws_cloudfront_function.viewer', 'update'], ['aws_lambda_function.authorizer', 'update'],
    ['aws_route53_record.app["A"]', 'create'], ['aws_route53_record.app["AAAA"]', 'create'],
  ]);
  const changes = (plan.resource_changes ?? []).filter(r => r.mode === 'managed' && r.change?.actions?.join() !== 'no-op');
  if (changes.length !== allowed.size || changes.some(r => allowed.get(r.address) !== r.change.actions.join())) throw Error('CUTOVER_PLAN_SCOPE');
  const fn = changes.find(r => r.address === 'aws_lambda_function.authorizer').change;
  if (canonical(fn.after_unknown ?? {}).includes('true')) throw Error('CUTOVER_PLAN_UNKNOWN');
  const patch = originPatch({ Environment: { Variables: fn.before.environment?.[0]?.variables }, RevisionId: 'plan' },
    fn.before.environment?.[0]?.variables?.OPENSIGHT_PUBLIC_ORIGIN, fn.after.environment?.[0]?.variables?.OPENSIGHT_PUBLIC_ORIGIN);
  const expected = { ...fn.before, environment: [{ variables: patch.Environment.Variables }] };
  if (canonical(expected) !== canonical(fn.after)) throw Error('CUTOVER_PLAN_RUNTIME_CHANGE');
  return { updates: 3, additions: 3, replacements: 0, deletions: 0 };
}
