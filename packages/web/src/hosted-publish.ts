import type { BundleAnalysis } from '@opensight/bundle-parser';
import { serializeDraft, type AuthorDraft } from './authoring.js';
import { exportBundle } from './bundle-authoring.js';
import type { createApiClient } from './api-client.js';

export interface HostedAnalysisInput { name: string; definition: BundleAnalysis['definition']; datasetBindings: Record<string, { kind: 'prepared-dataset'; id: string }> }
export interface Publication { DashboardId: string; Version: number; Errors: { errorCode: string; message: string; path: string }[] }
export type PublishingClient = Pick<ReturnType<typeof createApiClient>, 'saveHostedAnalysis' | 'publishAnalysis'>;
export interface HostedDraftLink { analysisId: string; revision?: number; dashboardId?: string; pendingPublish?: string }

/** No imported ARN or local/sample identity is authority to bind hosted data. */
export function hostedAnalysisInput(draft: AuthorDraft): HostedAnalysisInput {
  if (!draft.dataset || draft.noDataset) throw new Error('HOSTED_DATASET_REQUIRED: Select a hosted dataset before saving or publishing.');
  const resource = draft.bundle
    ? exportBundle(draft).members.find(m => m.path === draft.bundle?.primaryPath)?.resource
    : serializeDraft(draft);
  if (!resource || !('definition' in resource) || !resource.definition) throw new Error('ANALYSIS_DEFINITION_REQUIRED: No analysis definition is available.');
  const definition = resource.definition as BundleAnalysis['definition'];
  const declarations = definition.dataSetIdentifierDeclarations;
  if (declarations.length !== 1 || declarations[0]!.dataSetArn !== `opensight:dataset:${draft.dataset.id}`) throw new Error('UNRESOLVED_BINDING: Reconnect the analysis to its hosted dataset before saving.');
  return { name: draft.title, definition, datasetBindings: { [declarations[0]!.identifier]: { kind: 'prepared-dataset', id: draft.dataset.id } } };
}

/** Persist receipts before the next mutation. Failed publish retries use the same
 * key and saved definition; they never create a second dashboard accidentally. */
export async function saveHostedDraft(client: PublishingClient, input: HostedAnalysisInput, link: HostedDraftLink, persist: (link: HostedDraftLink) => void): Promise<HostedDraftLink> {
  if (link.pendingPublish) throw new Error('PUBLISH_PENDING: Retry publishing the saved version before saving further changes.');
  const revision = await client.saveHostedAnalysis(link.analysisId, input, link.revision);
  const next = { ...link, revision }; persist(next); return next;
}
export async function publishHostedDraft(client: PublishingClient, input: HostedAnalysisInput, link: HostedDraftLink, persist: (link: HostedDraftLink) => void): Promise<Publication> {
  let next = link;
  if (!next.pendingPublish) {
    next = await saveHostedDraft(client, input, next, persist);
    next = { ...next, pendingPublish: crypto.randomUUID() }; persist(next);
  }
  const result = await client.publishAnalysis(next.analysisId, next.dashboardId, next.pendingPublish!);
  persist({ analysisId: next.analysisId, revision: next.revision, dashboardId: result.DashboardId });
  return result;
}
