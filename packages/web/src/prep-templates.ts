import type { PrepPipeline } from '@opensight/bundle-parser/prep';
export interface PrepTemplate {
  id: string; version: number; owner: string; createdBy: string; publishedVersion: number | null; state: 'draft' | 'published';
  source: { id: string; ownerId: string; version: number };
  definition: { name: string; pipeline: PrepPipeline }; slots: string[]; publishedSlots: string[]; permissions: { edit: boolean; publish: boolean };
}
