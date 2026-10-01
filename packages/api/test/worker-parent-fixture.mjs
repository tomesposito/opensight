// An intentionally blocked evaluator proves the watchdog is independent of its event loop.
import { fork } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
if (process.argv[2] === 'worker') {
  const watchdog = new Worker(new URL('../dist/execution-watchdog.js', import.meta.url), { workerData: {
    parentPid: /^PPid:\s+(\d+)/m.exec(readFileSync('/proc/self/status', 'utf8'))[1],
    deadline: Date.now() + Number(process.argv[3]), rssBytes: 512 * 1048576,
  } });
  watchdog.once('message', () => { process.send({ pid: process.pid }, () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0)); });
} else {
  const child = fork(new URL('./worker-parent-fixture.mjs', import.meta.url), ['worker', '60000'], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  child.once('message', message => process.send(message));
}
