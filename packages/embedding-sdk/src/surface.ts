import { embedRoute, type EmbedHostAction } from './events.js';
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

/** Shells carry the full resolved profile. An incomplete shell cannot render. */
export function isEmbedSurface(value: unknown): value is EmbedSurface {
  if (!isSurfaceDeclaration(value)) return false;
  return (Object.keys(surfaceNames) as (keyof EmbedSurface)[]).every(group => {
    const entries = value[group];
    return entries !== undefined && surfaceNames[group].every(key => Object.hasOwn(entries, key));
  });
}

/** Use only the resolved profile from the issued shell. Refresh addresses the
 * already displayed content and never selects a resource or changes controls. */
export function allowsHostAction(surface: EmbedSurface, action: EmbedHostAction): boolean {
  if (!isEmbedSurface(surface)) return false;
  if (action.type === 'refresh') return true;
  if (action.type === 'setFilter') return surface.actions.filtering === 'visible';
  const target = embedRoute(action.path);
  if (!target || surface.menus.navigation !== 'visible') return false;
  if (target.area === 'author' || target.area === 'prep') return surface.actions.authoring === 'visible';
  if (target.area === 'ask') return surface.actions.question === 'visible';
  return true;
}
