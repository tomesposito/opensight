import type { PrepSourceSummary } from './data-prep.js';
import { validateDraft, type AuthorDataset, type AuthorDraft } from './authoring.js';

export function draftSourceProblem(dataset: AuthorDataset, sources: readonly PrepSourceSummary[]): string | undefined {
  const source = sources.find(s => typeof s.ref === 'object' && 'dataset' in s.ref && s.ref.dataset === dataset.id);
  if (!source || !source.available && source.errorCode === 'PREP_SOURCE_NOT_FOUND') return 'Source data expired or is unavailable — re-upload the file. Uploads expire after 24 hours or an API restart. Your analysis definition is still saved.';
  if (!source.available) return `Source data is unavailable (${source.errorCode ?? 'unavailable'}). Repair the saved dataset in Data preparation, then retry.`;
  if (!compatibleDataset(dataset, source)) return 'The saved dataset schema has changed. Reconnect this draft to a dataset with the original column names and types.';
}
export function compatibleDataset(dataset: AuthorDataset, source: Pick<PrepSourceSummary, 'columns'>): boolean {
  return dataset.columns.every(c => source.columns.some(next => next.name === c.name && next.type === c.type));
}
export function reconnectDraft(draft: AuthorDraft, source: PrepSourceSummary): AuthorDraft {
  if (!draft.dataset || !source.available || typeof source.ref !== 'object' || !('dataset' in source.ref) || !compatibleDataset(draft.dataset, source)) throw new Error('Reconnect needs a prepared dataset with the original column names and types. Prepare the re-uploaded file first.');
  const next = { ...draft, dataset: { id: source.ref.dataset, name: source.name ?? source.id, columns: source.columns } };
  validateDraft(next);
  return next;
}
