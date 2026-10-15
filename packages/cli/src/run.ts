import { OpenSightApiError, OpenSightClient } from '@opensight/headless-sdk';
import { apiBase, credentials, type Credentials } from './auth.js';
import { dispatch, VersionedResponse } from './dispatch.js';
import { CliError, record } from './errors.js';
import { help } from './help.js';
import { parse } from './parse.js';
import { checkFormat, render } from './render.js';

export interface Runtime {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}
function reflects(value: unknown, contains: (s: string) => boolean): boolean {
  if (typeof value === 'string') return contains(value);
  if (Array.isArray(value)) return value.some(v => reflects(v, contains));
  return record(value) && Object.entries(value).some(([k, v]) => contains(k) || reflects(v, contains));
}
export async function run(argv: string[], runtime: Runtime = {}): Promise<number> {
  const env = runtime.env ?? process.env, fetchImpl = runtime.fetch ?? fetch;
  const stdout = runtime.stdout ?? (text => { process.stdout.write(text); });
  const stderr = runtime.stderr ?? (text => { process.stderr.write(text); });
  let auth: Credentials | undefined;
  const contains = (text: string): boolean => !!(env.OPENSIGHT_TOKEN && text.includes(env.OPENSIGHT_TOKEN)) || !!auth?.containsSecret(text);
  try {
    const input = parse(argv);
    if ('help' in input) { stdout(help(input.help)); return 0; }
    checkFormat(input.operation.operationId, input.format);
    auth = credentials(env, fetchImpl);
    const client = new OpenSightClient({ baseUrl: apiBase(env), getToken: () => auth!.accessToken(),
      // Credential safety options only. SDK owns every method, route, header and body.
      fetch: (url, init) => fetchImpl(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(120_000) }),
    });
    const response = await dispatch(client, input);
    const result = response instanceof VersionedResponse ? response.value : response;
    const metadata = response instanceof VersionedResponse && response.etag !== null ? { etag: response.etag } : undefined;
    if (!record(result)) throw new CliError('CLI_RESPONSE_INVALID', 'Expected an API response object.');
    // Exports are encoded after dispatch; inspect their decoded bytes too.
    if (reflects(result, contains) || reflects(metadata, contains) || typeof result.base64 === 'string' && contains(Buffer.from(result.base64, 'base64').toString('utf8'))) {
      throw new CliError('CLI_TRANSPORT_ERROR', 'OpenSight returned an unsafe response.');
    }
    stdout(render(input.operation.operationId, result, input.format));
    // Keep stdout equal to the API JSON; retain the SDK ETag for subsequent edits.
    if (metadata) stderr(JSON.stringify(metadata) + '\n');
    return 0;
  } catch (error) {
    let result: Record<string, unknown>;
    if (error instanceof OpenSightApiError) result = { ...error.body, errorCode: error.errorCode, message: error.message, status: error.status,
      ...(error.retryAfter === undefined ? {} : { retryAfter: error.retryAfter }) };
    else if (error instanceof CliError) result = { errorCode: error.errorCode, message: error.message };
    else result = { errorCode: 'CLI_TRANSPORT_ERROR', message: 'OpenSight request failed.' };
    if (reflects(result, contains)) result = { errorCode: 'CLI_TRANSPORT_ERROR', message: 'OpenSight returned an unsafe response.' };
    stderr(JSON.stringify(result) + '\n');
    return 1;
  }
}
