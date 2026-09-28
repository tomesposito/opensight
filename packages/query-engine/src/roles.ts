/** Shared role capabilities; claims are resolved from the server registry, never request bodies. */
export const ROLES = ['administrator', 'author', 'author_ai', 'reader', 'reader_ai'] as const;
export type Role = typeof ROLES[number];
export type Capability = 'admin' | 'build' | 'ai';
export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
export function hasCapability(role: unknown, capability: Capability): boolean {
  if (!isRole(role)) return false;
  if (role === 'administrator') return true;
  return capability === 'build' ? role === 'author' || role === 'author_ai'
    : capability === 'ai' ? role === 'author_ai' || role === 'reader_ai' : false;
}
