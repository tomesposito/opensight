import { configurationFingerprint } from './release-safety.mjs';

export const sourcePattern = /^[a-f0-9]{40}$/;
export const manifestPattern = /^[a-f0-9]{64}$/;
export function requestSelection(source, manifest) {
  if (!sourcePattern.test(source ?? '') || !manifestPattern.test(manifest ?? '')) throw Error('REQUEST_SELECTION_INVALID');
  return { source, manifest };
}
export function requestBody(source, manifest) {
  return { ref: source, task: 'opensight:request', environment: 'production', auto_merge: false,
    required_contexts: [], production_environment: true, transient_environment: false,
    description: 'Requested; independent operator approval required',
    payload: { version: 1, kind: 'opensight-release-request', ...requestSelection(source, manifest) } };
}
export function validateRequest(d, repository) {
  let p; try { p = typeof d?.payload === 'string' ? JSON.parse(d.payload) : d?.payload; } catch { throw Error('REQUEST_INVALID'); }
  if (!Number.isSafeInteger(d?.id) || d.id < 1 || d.task !== 'opensight:request' || d.environment !== 'production'
    || d.repository_url !== `https://api.github.com/repos/${repository}` || p?.version !== 1 || p.kind !== 'opensight-release-request'
    || Object.keys(p).sort().join() !== 'kind,manifest,source,version' || d.sha !== p.source || d.ref !== p.source) throw Error('REQUEST_INVALID');
  return { id: d.id, ...requestSelection(p.source, p.manifest) };
}
export function requestRunName(token) {
  if (!/^request-[1-9][0-9]*-[a-f0-9-]{36}$/.test(token ?? '')) throw Error('REQUEST_TOKEN_INVALID');
  return 'release-request ' + token;
}
export function matchedRun(runs, receipt) {
  const matches = runs.filter(r => r.display_title === requestRunName(receipt.token));
  if (matches.length > 1) throw Error('DUPLICATE_REQUEST_RUNS');
  const r = matches[0];
  if (r && (r.event !== 'workflow_dispatch' || r.head_branch !== 'master' || r.path !== '.github/workflows/deploy.yml'
    || r.run_attempt !== 1 || !Number.isSafeInteger(r.id) || !Number.isFinite(Date.parse(r.created_at))
    || Date.parse(r.created_at) < receipt.attemptedAt - 5000)) throw Error('REQUEST_RUN_INVALID');
  return r;
}
export function observedProduction(current, evidence, now = Date.now()) {
  if (!sourcePattern.test(current?.source ?? '') || !sourcePattern.test(current.marketing?.source ?? current.source)
    || !Number.isSafeInteger(now) || !evidence.etag || evidence.etag !== evidence.finalEtag || evidence.activeOperation
    || evidence.functions?.length !== 4 || evidence.mappings?.length !== 2
    || evidence.alias?.FunctionVersion !== current.requestVersion) throw Error('PRODUCTION_UNVERIFIED');
  const roles = ['request', 'work', 'recovery', 'ingress'];
  for (const [i, f] of evidence.functions.entries()) {
    if (f.role !== roles[i] || !f.configuration?.FunctionName?.endsWith('-' + roles[i])
      || f.configuration.State !== 'Active' || f.configuration.LastUpdateStatus !== 'Successful'
      || f.image !== current.imageUri || !Number.isSafeInteger(f.concurrency) || f.concurrency < 1 || f.concurrency > 4
      || configurationFingerprint(f.configuration) !== current.configuration?.[f.configuration.FunctionName]) throw Error('PRODUCTION_UNVERIFIED');
  }
  for (const [i, m] of evidence.mappings.entries()) {
    if (m.State !== 'Enabled' || !m.FunctionArn?.endsWith(':' + evidence.functions[i + 1].configuration.FunctionName)) throw Error('PRODUCTION_UNVERIFIED');
  }
  return { version: 1, kind: 'opensight-production-observation', runtimeSource: current.source,
    marketingSource: current.marketing?.source ?? current.source, observedAt: new Date(now).toISOString() };
}
export function publicStatus(stage, observation) {
  const states = { requested: 'pending', approved: 'queued', deploying: 'in_progress', deployed: 'success', failed: 'failure', blocked: 'error' };
  const descriptions = { requested: 'Requested; independent operator approval required', approved: 'Approved; awaiting private dispatch',
    deploying: 'Dispatch attempted; awaiting verified outcome', deployed: 'Deployed; AWS control plane verified',
    failed: 'Private deployment failed; operator reconciliation required', blocked: 'Blocked; operator compatibility or state review required' };
  if (!states[stage]) throw Error('PUBLIC_STATUS_INVALID');
  if (observation && (!sourcePattern.test(observation.runtimeSource ?? '') || !sourcePattern.test(observation.marketingSource ?? ''))) throw Error('PUBLIC_STATUS_INVALID');
  const description = observation ? `${stage}; runtime ${observation.runtimeSource}; marketing ${observation.marketingSource}` : descriptions[stage];
  return { state: states[stage], description, auto_inactive: false };
}
