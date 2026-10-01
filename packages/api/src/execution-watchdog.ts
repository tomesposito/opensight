import { workerData, parentPort } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
const { parentPid, deadline, rssBytes } = workerData as { parentPid: string; deadline: number; rssBytes: number };
// Independent of the evaluator's JS event loop. Also terminates an orphan after API death.
setInterval(() => {
  try {
    const current = /^PPid:\s+(\d+)/m.exec(readFileSync('/proc/self/status', 'utf8'))?.[1];
    if (!current || current !== parentPid || Date.now() >= deadline || process.memoryUsage().rss > rssBytes) process.kill(process.pid, 'SIGKILL');
  } catch { process.kill(process.pid, 'SIGKILL'); }
}, 20);
parentPort?.postMessage('ready');
