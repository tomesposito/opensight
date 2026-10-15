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

// This is an explicit empty wake request, never a wrapper around API mutations.
// A cold ingress authorizer can return a generic gateway 500/503 before the
// application starts. These exact responses remain bounded; all others fail.
export async function smokeStartup(request, wait = pause) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await request();
    if (r.status === 200 && r.body?.state === 'ready') return;
    const generic = Object.keys(r.body ?? {}).join() === 'message';
    const waking = r.status === 503 && (r.body?.errorCode === 'WORKSPACE_STARTING'
      || (generic && r.body.message === 'Service Unavailable'));
    const ingressStarting = r.status === 500 && generic && r.body.message === 'Internal Server Error';
    if (!waking && !ingressStarting) throw Error('SMOKE_STARTUP_FAILED');
    if (attempt < 5) await wait(10000);
  }
  throw Error('SMOKE_STARTUP_TIMEOUT');
}
