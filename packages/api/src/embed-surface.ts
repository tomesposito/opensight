import { hasCapability } from '@opensight/query-engine';
import { isSurfaceDeclaration, type EmbedSurface, type SurfaceState } from '@opensight/embedding-sdk/surface';
import type { EmbedExperience } from './embed-sessions.js';
import type { TenantEmbedConfig } from './embedding-config.js';
import { MetadataError } from './metadata-db.js';

/** Resolve presentation for the already-selected experience and principal.
 * Content and write handlers continue to authorize the underlying operation. */
export function resolveEmbedSurface(config: TenantEmbedConfig, experience: EmbedExperience, role: unknown, raw: unknown): EmbedSurface {
  const declaration = raw === undefined ? {} : raw;
  if (!isSurfaceDeclaration(declaration)) throw new MetadataError('EMBED_SURFACE_INVALID', 422);
  const ceiling = config.surfaceCeiling;
  if (!ceiling.experiences.includes(experience.kind)) throw new MetadataError('EMBED_SURFACE_DENIED', 403);
  function state(requested: SurfaceState | undefined, permitted: boolean): SurfaceState {
    if (permitted) return requested ?? 'visible';
    // Even a disabled control would expose a surface outside its maximum.
    if (requested !== undefined && requested !== 'hidden') throw new MetadataError('EMBED_SURFACE_DENIED', 403);
    return 'hidden';
  }
  const app = experience.kind === 'full-app';
  const reader = experience.kind === 'dashboard' || experience.kind === 'visual';
  const author = (app || experience.kind === 'console') && config.features.authoring && hasCapability(role, 'build');
  return {
    menus: {
      navigation: state(declaration.menus?.navigation, app && ceiling.menus.includes('navigation')),
      account: state(declaration.menus?.account, app && ceiling.menus.includes('account')),
    },
    actions: {
      authoring: state(declaration.actions?.authoring, author && ceiling.actions.includes('authoring')),
      filtering: state(declaration.actions?.filtering, reader && config.features.filtering && ceiling.actions.includes('filtering')),
      parameterControls: state(declaration.actions?.parameterControls, (reader || app && config.features.registeredDashboards) && config.features.parameterControls && ceiling.actions.includes('parameterControls')),
      question: state(declaration.actions?.question, (experience.kind === 'q' || app && hasCapability(role, 'ai')) && ceiling.actions.includes('question')),
    },
    chrome: { header: state(declaration.chrome?.header, ceiling.chrome.includes('header')) },
  };
}
