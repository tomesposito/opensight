import type { GenerateEmbedUrlForRegisteredUser, GenerateEmbedUrlForAnonymousUser, FullAppLandingRoute } from '../dist/index.js';
const path: FullAppLandingRoute = '/analyses/author/working';
const registered: GenerateEmbedUrlForRegisteredUser = { ExperienceConfiguration: { FullApp: { InitialPath: path } } };
void registered;
// @ts-expect-error Unknown route classes are rejected before server validation.
const invalid: FullAppLandingRoute = '/admin/users';
// @ts-expect-error Full app requires a registered principal.
const anonymous: GenerateEmbedUrlForAnonymousUser = { Namespace: 'n', AuthorizedResourceArns: [], ExperienceConfiguration: { FullApp: { InitialPath: '/data' } } };
void invalid; void anonymous;

import { createSessionEmbeddingClient, type SurfaceDeclaration } from '../dist/index.js';

const surface: SurfaceDeclaration = { actions: { authoring: 'hidden' }, menus: { navigation: 'disabled' } };
const issueThroughBackend = async (_request: GenerateEmbedUrlForRegisteredUser, _signal: AbortSignal) => ({
  sessionId: '', EmbedUrl: '', bootstrapExpiresAt: '', SessionLifetimeInMinutes: 30, configRevision: 1, Surface: surface,
});
const client = createSessionEmbeddingClient({
  allowedEmbedOrigins: ['https://embed.example'],
  getEmbedUrl: (signal, requested) => issueThroughBackend({ ...registered, Surface: requested }, signal),
});
void client.mount(document.createElement('div'), { surface, onReady() {} });
// @ts-expect-error A boolean does not express one of the three surface states.
void client.mount(document.createElement('div'), { surface: { actions: { authoring: true } } });
// @ts-expect-error Required notices are outside the surface vocabulary.
void client.mount(document.createElement('div'), { surface: { chrome: { notices: 'hidden' } } });
