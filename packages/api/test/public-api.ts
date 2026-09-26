import type { Server } from 'node:http';
import { createApiServer, type ApiOptions } from '@opensight/api';

const options: ApiOptions = { dataRoot: '/local/fixtures' };
const create: (options: ApiOptions) => Promise<Server> = createApiServer;
void create;
void options;
// @ts-expect-error A data root is required for the library entry point.
const missing: ApiOptions = {};
void missing;
