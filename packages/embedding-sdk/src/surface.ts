// The closed vocabulary is shared by config validation, issuance and SDK mounts.
export const surfaceNames = {
  menus: ['navigation', 'account'],
  actions: ['authoring', 'filtering', 'parameterControls', 'question'],
  chrome: ['header'],
} as const;
export type SurfaceState = 'visible' | 'hidden' | 'disabled';
export type EmbedSurface = { [G in keyof typeof surfaceNames]: Record<typeof surfaceNames[G][number], SurfaceState> };
export type SurfaceDeclaration = { [G in keyof EmbedSurface]?: Partial<EmbedSurface[G]> };

function record(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
export function isSurfaceDeclaration(value: unknown): value is SurfaceDeclaration {
  if (!record(value)) return false;
  return Object.entries(value).every(([group, entries]) => {
    if (!Object.hasOwn(surfaceNames, group) || !record(entries)) return false;
    const names: readonly string[] = surfaceNames[group as keyof EmbedSurface];
    return Object.entries(entries).every(([key, state]) =>
      names.includes(key) && (state === 'visible' || state === 'hidden' || state === 'disabled'));
  });
}
