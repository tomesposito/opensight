const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// Publishing ingestion changes metadata revisions. A concurrent status read can
// correctly fail its final authorization recheck; a new GET reauthorizes against
// the new revision. Never repeat mutations or treat other denials as transient.
export async function smokeRequest(method, path, request, wait = pause) {
  const operationRead = method === 'GET' && /^\/api\/operations\/[A-Za-z0-9_-]+$/.test(path);
  for (let attempt = 0; ; attempt++) {
    const response = await request();
    if (!operationRead || attempt === 2 || response.status !== 403 || response.body?.errorCode !== 'METADATA_REVISED') return response;
    await wait(250);
  }
}
