import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { MetadataError } from './metadata-db.js';

/** Operator-installed Chromium, controlled over private pipes. No listening socket,
 * network requests, operator environment, or persistent rendered artifact. */
export async function renderDashboardPdf(executable: string, html: string): Promise<Buffer> {
  if (Buffer.byteLength(html) > 16 * 1024 * 1024) throw new MetadataError('DASHBOARD_EXPORT_TOO_LARGE', 413);
  const directory = await mkdtemp(join(tmpdir(), 'opensight-dashboard-pdf-'));
  const child = spawn(executable, ['--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-background-networking', '--disable-extensions', '--disable-component-update', '--disable-sync', '--no-first-run', '--host-resolver-rules=MAP * ~NOTFOUND', '--remote-debugging-pipe', `--user-data-dir=${directory}`], {
    stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], detached: true, env: { PATH: process.env.PATH, TZ: 'UTC' },
  });
  const input = child.stdio[3] as Writable, output = child.stdio[4] as Readable;
  let sequence = 0, pendingBytes = Buffer.alloc(0), stopped = false;
  const pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>();
  const fail = () => {
    stopped = true;
    for (const p of pending.values()) p.reject(new MetadataError('DASHBOARD_EXPORT_FAILED', 503));
    pending.clear();
  };
  const exit = new Promise<void>(resolve => { child.once('exit', () => { fail(); resolve(); }); child.once('error', () => { fail(); resolve(); }); });
  const kill = () => { if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } } };
  const timer = setTimeout(() => { fail(); kill(); }, 30000);
  input.on('error', fail); output.on('error', fail);
  output.on('data', (bytes: Buffer) => {
    pendingBytes = Buffer.concat([pendingBytes, bytes]);
    if (pendingBytes.length > 24 * 1024 * 1024) { fail(); kill(); return; }
    let end: number;
    while ((end = pendingBytes.indexOf(0)) !== -1) {
      const raw = pendingBytes.subarray(0, end); pendingBytes = pendingBytes.subarray(end + 1);
      try {
        const message = JSON.parse(raw.toString()) as { id?: number; result?: Record<string, unknown>; error?: unknown };
        const p = message.id === undefined ? undefined : pending.get(message.id);
        if (p) { pending.delete(message.id!); if (message.error) p.reject(new MetadataError('DASHBOARD_EXPORT_FAILED', 503)); else p.resolve(message.result ?? {}); }
      } catch { fail(); kill(); }
    }
  });
  const send = (method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<Record<string, unknown>> => {
    if (stopped) return Promise.reject(new MetadataError('DASHBOARD_EXPORT_FAILED', 503));
    const id = ++sequence;
    return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); input.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0'); });
  };
  try {
    const target = await send('Target.createTarget', { url: 'about:blank' });
    const session = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    const sessionId = String(session.sessionId);
    await send('Page.enable', {}, sessionId); await send('Network.enable', {}, sessionId);
    await send('Network.setBlockedURLs', { urls: ['*'] }, sessionId);
    const tree = await send('Page.getFrameTree', {}, sessionId), frame = (tree.frameTree as { frame: { id: string } }).frame;
    await send('Page.setDocumentContent', { frameId: frame.id, html }, sessionId);
    await send('Runtime.evaluate', { expression: 'document.fonts.ready', awaitPromise: true }, sessionId);
    const result = await send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true }, sessionId);
    if (typeof result.data !== 'string') throw new MetadataError('DASHBOARD_EXPORT_FAILED', 503);
    const bytes = Buffer.from(result.data, 'base64');
    if (bytes.length > 16 * 1024 * 1024) throw new MetadataError('DASHBOARD_EXPORT_TOO_LARGE', 413);
    return bytes;
  } finally { clearTimeout(timer); fail(); kill(); await exit; await rm(directory, { recursive: true, force: true }); }
}
