import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Analytics } from './analytics.js';
import { method, send } from './automation-routes.js';
import { MetadataError } from './metadata-db.js';
import { object, type Scope } from './metadata-resources.js';
import { readBody } from './query.js';

export async function analyticsSettingsRoute(request: IncomingMessage, response: ServerResponse, path: string, query: string,
  analytics: Analytics, scope: Scope, authorize: () => Promise<void>): Promise<boolean> {
  if (path !== '/api/admin/analytics') return false;
  await authorize();
  if (query) throw new MetadataError('ANALYTICS_SETTINGS_INVALID', 400);
  const verb = method(request, response, ['GET', 'POST']);
  if (verb === 'POST') {
    const raw = object(await readBody(request), ['enabled']);
    if (typeof raw.enabled !== 'boolean') throw new MetadataError('ANALYTICS_SETTINGS_INVALID', 400);
    await authorize(); await analytics.setEnabled(scope, raw.enabled);
  }
  send(response, 200, await analytics.settings(scope)); return true;
}
