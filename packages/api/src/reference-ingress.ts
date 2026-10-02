import { createServer } from 'node:https';
import { request as upstream } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
export function staticPath(root: string, url: string): string | undefined {
  if (url.includes('?') || url.includes('#') || /%|\\|\0/.test(url)) return;
  const path = resolve(root, `.${url === '/' ? '/index.html' : url}`);
  return path.startsWith(resolve(root) + sep) && types[extname(path)] ? path : undefined;
}
/** Private API upstream, fixed Host, no forwarded identity headers, no access logs. */
export async function referenceIngress(env: NodeJS.ProcessEnv = process.env) {
  const origin = new URL(env.OPENSIGHT_PUBLIC_ORIGIN!);
  if (origin.protocol !== 'https:' || origin.origin !== env.OPENSIGHT_PUBLIC_ORIGIN) throw new Error('INGRESS_CONFIG_INVALID');
  const root = resolve(env.OPENSIGHT_WEB_ROOT ?? 'packages/web/dist');
  return createServer({ cert: await readFile(env.OPENSIGHT_TLS_CERT!), key: await readFile(env.OPENSIGHT_TLS_KEY!), minVersion: 'TLSv1.2' }, (req, res) => {
    if (req.headers.host !== origin.host) { res.writeHead(421).end(); req.resume(); return; }
    res.setHeader('Strict-Transport-Security', 'max-age=31536000'); res.setHeader('X-Content-Type-Options', 'nosniff');
    const url = req.url ?? '';
    if (url.startsWith('/api/') || url.startsWith('/embed/') || url.startsWith('/health/')) {
      const proxy = upstream({ hostname: 'api', port: 3000, path: url, method: req.method, headers: req.headers, timeout: 15000 }, response => {
        res.writeHead(response.statusCode ?? 502, response.headers); response.pipe(res);
      });
      proxy.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
      proxy.on('timeout', () => proxy.destroy()); req.on('aborted', () => proxy.destroy());
      res.on('close', () => { if (!res.writableFinished) proxy.destroy(); }); req.pipe(proxy); return;
    }
    const path = staticPath(root, url);
    if (!path || !['GET', 'HEAD'].includes(req.method ?? '')) { res.writeHead(404).end(); req.resume(); return; }
    void readFile(path).then(bytes => { res.setHeader('Content-Type', types[extname(path)]!); res.end(req.method === 'HEAD' ? undefined : bytes); }).catch(() => res.writeHead(404).end());
  });
}
