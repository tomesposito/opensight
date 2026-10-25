import { MetadataError } from './metadata-db.js';

/**
 * Workspace naming (issue #146, IDD D-83). The tenant_id stays the internal
 * key in every query, session and route; display_name/slug are labels only.
 * Slugs are internal (no slug URLs).
 */
export const WORKSPACE_SLUG_MAX = 64;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Validate an explicitly supplied workspace slug. Absent (undefined)
 * means "derive from the display name". Any supplied value must match
 * /^[a-z0-9]+(?:-[a-z0-9]+)*$/ and fit in 64 chars, else METADATA_INVALID.
 */
export function parseWorkspaceSlug(raw: unknown): string | null {
  if (raw === undefined) return null;
  if (typeof raw !== 'string' || raw.length > WORKSPACE_SLUG_MAX || !SLUG_PATTERN.test(raw)) {
    throw new MetadataError('METADATA_INVALID', 400);
  }
  return raw;
}

/**
 * Derive a slug from a display name: lowercase, every run of non-[a-z0-9]
 * becomes one '-', leading/trailing '-' trimmed, at most 64 chars. An empty
 * derivation yields NULL (the name is still stored).
 */
export function deriveWorkspaceSlug(name: string): string | null {
  let slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (slug.length > WORKSPACE_SLUG_MAX) slug = slug.slice(0, WORKSPACE_SLUG_MAX).replace(/-+$/g, '');
  return slug || null;
}

/** Display label with fallback: display_name when non-null/non-empty, else tenant_id. */
export function workspaceLabel(displayName: unknown, tenantId: string): string {
  return typeof displayName === 'string' && displayName ? displayName : tenantId;
}
