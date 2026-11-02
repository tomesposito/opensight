export const ideaLabels = { received: 'Received', under_review: 'Under review', accepted: 'Accepted', declined: 'Declined', shipped: 'Shipped' } as const;
export type IdeaStatus = keyof typeof ideaLabels;
export const declineLabels = { 'not-aligned': 'Not aligned', duplicate: 'Duplicate', 'not-feasible': 'Not feasible', later: 'Later' } as const;
export interface Idea {
  id: string; tenantId: string; namespaceId: string; userId: string; name: string | null; email: string | null;
  title: string; description: string; surface: string; productVersion: string; status: IdeaStatus;
  declineCategory: keyof typeof declineLabels | null; declineNote: string | null; shippedReference: string | null;
  createdAt: string; updatedAt: string;
}
export interface IdeasClient {
  listMyIdeas(signal?: AbortSignal): Promise<{ ideas: Idea[] }>;
  submitIdea(input: { title: string; description: string; surface: string }): Promise<Idea>;
}
export const nextIdeaStatuses: Record<IdeaStatus, readonly IdeaStatus[]> = {
  received: ['under_review'], under_review: ['accepted', 'declined', 'shipped'], accepted: ['shipped'], declined: [], shipped: [],
};
/** References remain text unless they are absolute HTTP(S) links. Never interpret markup. */
export function ideaReferenceUrl(value: string): string | undefined {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined; }
  catch { return; }
}
