import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { method, send } from './automation-routes.js';
import { readBody } from './query.js';
import { object, identifier } from './metadata-resources.js';
import { EmbedSessions, embedFailure } from './embed-sessions.js';
import { EmbedContent } from './embed-content.js';

export async function embedSessionRoute(request: IncomingMessage, response: ServerResponse, path: string, sessions: EmbedSessions, content: EmbedContent): Promise<boolean> {
  const shell = /^\/embed\/sessions\/([A-Za-z0-9_-]{32})$/.exec(path);
  if (shell) {
    method(request, response, ['GET']);
    const payload = await sessions.shell(shell[1]!);
    let template: string;
    try { template = await readFile(new URL('../../web/dist/opensight-embed-session.html', import.meta.url), 'utf8'); }
    catch { return embedFailure('EMBED_RENDERER_NOT_BUILT', 503); }
    const data = JSON.stringify(payload).replaceAll('<', '\\u003c').replaceAll('&', '\\u0026').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
    const nonce = randomBytes(24).toString('base64');
    const html = template.replace('<!--OPENSIGHT_EMBED_DATA-->', () => `<script type="application/json" id="opensight-embed-data">${data}</script>`).replaceAll('<script', `<script nonce="${nonce}"`);
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': `default-src 'none'; connect-src 'self'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors ${payload.allowedDomains.join(' ')}` });
    response.end(html); return true;
  }
  const match = /^\/api\/embed\/sessions\/([A-Za-z0-9_-]{32})\/(redeem|status|content|question|analysis|save)$/.exec(path);
  if (!match) return false;
  const id = match[1]!, action = match[2]!;
  method(request, response, ['status', 'content'].includes(action) ? ['GET'] : ['POST']);
  if (action === 'redeem') {
    if (request.headers.authorization !== undefined) embedFailure('INVALID_EMBED_TOKEN', 401);
    send(response, 200, await sessions.redeem(id, await readBody(request))); return true;
  }
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('Embed ')) embedFailure('INVALID_EMBED_TOKEN', 401);
  const credential = authorization.slice(6), { session, context } = await sessions.verify(id, credential);
  await content.metadata.usage?.consume(content.metadata, context, 'apiCalls');
  const revisions = await content.metadata.revisions(context), controller = new AbortController();
  request.once('aborted', () => controller.abort()); response.once('close', () => { if (!response.writableFinished) controller.abort(); });
  const recheck = async () => { await sessions.verify(id, credential); await content.metadata.assertRevisions(context, revisions); };
  content.data.begin(context, controller.signal, recheck);
  let result: unknown;
  if (action === 'status') result = { sessionId: id, expiresAt: session.expiresAt };
  else if (action === 'content') result = await content.content(context, session);
  else if (action === 'question') result = await content.question(context, session, await readBody(request));
  else if (action === 'analysis') {
    if (session.experience.kind !== 'console') embedFailure('EMBED_SCOPE_DENIED', 403);
    const raw = object(await readBody(request), ['analysisId']), analysisId = identifier(raw.analysisId);
    if (session.experience.analysisId && session.experience.analysisId !== analysisId) embedFailure('EMBED_SCOPE_DENIED', 403);
    result = await content.content(context, { ...session, experience: { kind: 'console', analysisId } });
  } else {
    const raw = await readBody(request); await recheck();
    result = await content.save(context, session, raw);
    // The successful durable write invalidates this revision-bound session. It is
    // acknowledged once; the frame clears protected content and requests renewal.
    send(response, 200, result); return true;
  }
  await recheck(); await content.data.publication(context, revisions);
  send(response, 200, result); return true;
}
