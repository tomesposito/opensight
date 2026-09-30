import type { Server } from 'node:http';
import { createApiServer, type ApiOptions } from '@opensight/api';

const options: ApiOptions = { dataRoot: '/local/fixtures' };
const create: (options: ApiOptions) => Promise<Server> = createApiServer;
void create;
void options;
// @ts-expect-error A data root is required for the library entry point.
const missing: ApiOptions = {};
void missing;

import { emptySecurityState, type Identity, type SecurityOptions } from '@opensight/api';
const identity: Identity = { namespaceId: 'default', userId: 'synthetic-user' };
const security: SecurityOptions = { initialState: emptySecurityState(), authenticate: async () => identity };
const securedOptions: ApiOptions = { dataRoot: '/local/fixtures', security, namespaceDataRoots: { tenant: '/local/tenant' } };
void securedOptions;

import type { EmbeddingOptions } from '@opensight/api';
const embedding: EmbeddingOptions = { origin: 'https://api.example.com', allowedParentOrigins: ['https://app.example.com'] };
const embeddedOptions: ApiOptions = { ...securedOptions, embedding };
// @ts-expect-error Signing secrets are environment-only, never API options.
const invalidEmbedding: EmbeddingOptions = { ...embedding, secret: 'disallowed-option' };
void embeddedOptions; void invalidEmbedding;

import { createHostedApiServer, createBuiltinHostedServer, type HostedServerOptions } from '@opensight/api';
import { HostedAuth, HostedProvisioning, initializeAuth, hostedConfig, activateAuthKey } from '@opensight/api/metadata';
const createHosted: (options: HostedServerOptions) => Promise<Server> = createHostedApiServer;
void createHosted; void createBuiltinHostedServer; void HostedAuth; void HostedProvisioning; void initializeAuth; void hostedConfig; void activateAuthKey;
