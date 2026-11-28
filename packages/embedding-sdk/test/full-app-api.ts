import type { GenerateEmbedUrlForRegisteredUser, GenerateEmbedUrlForAnonymousUser, FullAppLandingRoute } from '../dist/index.js';
const path: FullAppLandingRoute = '/analyses/author/working';
const registered: GenerateEmbedUrlForRegisteredUser = { ExperienceConfiguration: { FullApp: { InitialPath: path } }, SessionTags: [{ Key: 'account', Value: 'north' }] };
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
// @ts-expect-error Session tags belong to backend issuance.
void client.mount(document.createElement('div'), { SessionTags: registered.SessionTags });
// @ts-expect-error A boolean does not express one of the three surface states.
void client.mount(document.createElement('div'), { surface: { actions: { authoring: true } } });
// @ts-expect-error Required notices are outside the surface vocabulary.
void client.mount(document.createElement('div'), { surface: { chrome: { notices: 'hidden' } } });
void client.mount(document.createElement('div'), { onDataEvent(event) {
  if (event.type === 'selection') void event.values.Region;
  // @ts-expect-error The version belongs only to a save receipt.
  void event.version;
} });

async function readerCommands() {
  const reader = await client.mount(document.createElement('div'), {
    customActions: [{ id: 'open', label: 'Open account', columns: ['account'] }],
    onDataEvent(event) { if (event.type === 'customAction') void event.values.account; },
  });
  reader.sendAction({ type: 'setFilter', filterId: 'regions', values: ['east'] });
  // @ts-expect-error Refresh cannot choose another resource.
  reader.sendAction({ type: 'refresh', path: '/dashboards/other' });
}
void readerCommands;
