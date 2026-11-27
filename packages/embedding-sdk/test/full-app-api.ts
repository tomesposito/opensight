import type { GenerateEmbedUrlForRegisteredUser, GenerateEmbedUrlForAnonymousUser, FullAppLandingRoute } from '../dist/index.js';
const path: FullAppLandingRoute = '/analyses/author/working';
const registered: GenerateEmbedUrlForRegisteredUser = { ExperienceConfiguration: { FullApp: { InitialPath: path } } };
void registered;
// @ts-expect-error Unknown route classes are rejected before server validation.
const invalid: FullAppLandingRoute = '/admin/users';
// @ts-expect-error Full app requires a registered principal.
const anonymous: GenerateEmbedUrlForAnonymousUser = { Namespace: 'n', AuthorizedResourceArns: [], ExperienceConfiguration: { FullApp: { InitialPath: '/data' } } };
void invalid; void anonymous;
