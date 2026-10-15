import { run } from '../dist/run.js';

export const env = { OPENSIGHT_API_URL: 'https://opensight.example/api', OPENSIGHT_TOKEN: 'synthetic-refresh-credential', OPENSIGHT_TOKEN_URL: 'https://opensight.example/token' };
export const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
export async function execute(argv, options = {}) {
  const calls = [], exchanges = [];
  let stdout = '', stderr = '';
  const code = await run(argv, { env: options.env ?? env,
    fetch: async (url, init) => {
      if (new URL(url).pathname === '/token') {
        exchanges.push({ url, init });
        return options.exchange ? options.exchange(url, init) : json({ access_token: 'synthetic-access-credential', token_type: 'Bearer', expires_in: 300, refresh_token: 'synthetic-rotated-credential' });
      }
      calls.push({ url, init });
      return options.fetch ? options.fetch(url, init) : json({ items: [], nextCursor: null });
    }, stdout: text => { stdout += text; }, stderr: text => { stderr += text; },
  });
  return { code, stdout, stderr, calls, exchanges };
}
