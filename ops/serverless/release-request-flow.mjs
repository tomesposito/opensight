import { randomUUID } from 'node:crypto';
import { requestBody, validateRequest, matchedRun, publicStatus } from './release-request-policy.mjs';
import { approveRelease } from './release-safety.mjs';

// Public GitHub records never confer approval. Only independent AWS authority
// and private receipts are consumed by the mutation path.
export async function releaseRequest(action, selection, io) {
  if (action === 'request') {
    const release = await io.verify(selection);
    const d = await io.createRequest(requestBody(release.manifest.source, release.digest));
    const request = validateRequest(d, io.repository);
    await io.status(request.id, publicStatus('requested'));
    return { stage: 'requested', ...request };
  }
  if (action === 'observe') return io.publishObservation(await io.observe());
  if (!['approve', 'dispatch', 'reconcile'].includes(action)) throw Error('REQUEST_COMMAND_INVALID');
  const request = validateRequest(await io.getRequest(selection), io.repository);
  const saved = await io.load(request.id);
  if (saved && (saved.source !== request.source || saved.manifest !== request.manifest)) throw Error('REQUEST_RECEIPT_MISMATCH');
  if (action === 'reconcile') {
    if (!saved?.token) throw Error('DISPATCH_RECEIPT_REQUIRED');
    const run = matchedRun(await io.runs(saved), saved);
    if (!run || run.status !== 'completed') return { stage: 'deploying', id: request.id, outcome: run ? 'running' : 'dispatch-unconfirmed' };
    if (run.conclusion !== 'success') {
      await io.status(request.id, publicStatus('failed'));
      await io.save(request.id, { ...saved, stage: 'failed', runId: run.id });
      return { stage: 'failed', id: request.id };
    }
    const { current, observation } = await io.observe();
    if (current.source !== request.source || current.id !== request.manifest) throw Error('REQUEST_NOT_CURRENT');
    await io.publishObservation({ current, observation });
    await io.status(request.id, publicStatus('deployed', observation));
    await io.save(request.id, { ...saved, stage: 'deployed', runId: run.id });
    return { stage: 'deployed', id: request.id, ...observation };
  }
  // Once attempted, even a timeout or local status failure cannot cause a retry.
  if (saved?.token) throw Error('DISPATCH_ALREADY_ATTEMPTED');
  const release = await io.verify(request.source, request.manifest);
  const authority = await io.authority();
  if (release.manifest.compatibility !== authority.current.compatibility) {
    await io.status(request.id, publicStatus('blocked'));
    throw Error('COMPATIBILITY_REVIEW_REQUIRED');
  }
  if (action === 'approve') {
    await io.approve(request);
    const approval = await io.approval(request.manifest), after = await io.authority();
    approveRelease(approval, release.manifest, request.manifest, after.configuration, after.current);
    await io.save(request.id, { ...request, stage: 'approved', current: after.current.id, configuration: after.configuration, expiresAt: approval.expiresAt });
    await io.status(request.id, publicStatus('approved'));
    return { stage: 'approved', ...request };
  }
  if (saved?.stage !== 'approved' || saved.current !== authority.current.id || saved.configuration !== authority.configuration) throw Error('REQUEST_APPROVAL_REQUIRED');
  approveRelease(await io.approval(request.manifest), release.manifest, request.manifest, authority.configuration, authority.current);
  await io.checkDispatcher();
  const receipt = { ...saved, stage: 'deploying', token: `request-${request.id}-${randomUUID()}`, attemptedAt: Date.now() };
  await io.save(request.id, receipt);
  // No automatic retry: this call can succeed even if its response is lost.
  await io.dispatch(request, receipt.token);
  await io.status(request.id, publicStatus('deploying'));
  return { stage: 'deploying', id: request.id };
}
