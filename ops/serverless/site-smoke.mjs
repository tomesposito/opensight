import { digest } from './release-manifest.mjs';
// Read-only acceptance of the two public hosts. No AWS credentials or DB access.
export async function verifySites(config, files, request = fetch) {
  const get = async url => request(url, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
  const page = async (origin, path, file) => {
    const response = await get(origin + path);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (response.status !== 200 || !response.headers.get('content-type')?.startsWith('text/html')
      || !bytes.includes('OpenSight') || (files && digest(bytes) !== files[file])) throw Error('SMOKE_FRONTEND_FAILED');
  };
  await page(config.origin, '/', 'index.html');
  if (!config.marketingOrigin) return;
  await page(config.marketingOrigin, '/', 'marketing/index.html');
  await page(config.marketingOrigin, '/demo/', 'marketing/demo/index.html');
  const redirect = await get(config.marketingOrigin + '/demo');
  if (redirect.status !== 308 || redirect.headers.get('location') !== '/demo/') throw Error('SMOKE_DEMO_REDIRECT_FAILED');
  for (const [origin, path] of [[config.origin, '/marketing/index.html'], [config.marketingOrigin, '/opensight-embed.html'],
    [config.marketingOrigin, '/api/api/session'], [config.marketingOrigin, '/embed/sessions/synthetic']]) {
    const response = await get(origin + path);
    if (![403, 404].includes(response.status)) throw Error('SMOKE_HOST_ISOLATION_FAILED');
    await response.arrayBuffer();
  }
}
