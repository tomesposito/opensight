import { fork } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import type { PrepColumn, PrepPipeline } from '@opensight/bundle-parser/prep';
import type { PrepSource, PrepDataset, SourceRead, PrepScalar, InteractiveQuery, UploadRequest, queryPrepared } from '@opensight/query-engine';
import { BlazeTable, type BlazeLimits } from './blaze.js';
import { MetadataError } from './metadata-db.js';
import type { WorkScope } from './budgets.js';

export interface WireTable { source: PrepSource; rows: PrepScalar[][] }
export type WorkerTask =
  | { kind: 'source'; read: SourceRead; table: WireTable }
  | { kind: 'prep'; pipeline: PrepPipeline; sources: PrepSource[]; datasets: PrepDataset[]; id: string; through?: string | null; tables: WireTable[] }
  | { kind: 'upload'; request: UploadRequest }
  | { kind: 'visual'; table: WireTable; analysis: unknown; visualId: string; dataSetArn: string }
  | { kind: 'query'; table: WireTable; query: InteractiveQuery };
export interface WorkerRequest { task: WorkerTask; limits: BlazeLimits; memoryMb: number; resultBytes: number; deadline: number; rssBytes: number }
export interface TableResult { columns: PrepColumn[]; rows: PrepScalar[][] }
export type QueryResult = ReturnType<typeof queryPrepared>;
export async function wireTable(scope: WorkScope, table: BlazeTable, source: PrepSource): Promise<WireTable> {
  scope.memory(table.bytes); const rows: PrepScalar[][] = [];
  for (let r = 0; r < table.rowCount; r++) {
    if (r % 256 === 0) { await yieldTurn(); scope.check(); }
    rows.push(table.columns.map((_, c) => table.value(r, c)));
  }
  return { source, rows };
}
/** A child owns all untrusted synchronous evaluation and native DuckDB allocation.
 * The parent kills and REAPS it before releasing admission, including IPC/parent death. */
export async function containedWork<T extends TableResult | QueryResult>(scope: WorkScope, task: WorkerTask, limits: BlazeLimits): Promise<T> {
  scope.check();
  if (process.platform !== 'linux') throw new MetadataError('WORKER_CONTAINMENT_UNAVAILABLE', 503);
  // A procfs mounted in a different PID namespace cannot observe our children. Fail closed.
  try { await readFile(`/proc/${process.pid}/status`, 'utf8'); } catch { throw new MetadataError('WORKER_CONTAINMENT_UNAVAILABLE', 503); }
  scope.check();
  return new Promise<T>((resolve, reject) => {
    const remaining = Math.floor((scope.limits.workingBytes - scope.workingBytes) / 2);
    if (remaining < 256) { reject(new MetadataError('TENANT_BUDGET_EXCEEDED', 429)); return; }
    const child = fork(new URL('./execution-worker.js', import.meta.url), [], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'advanced',
      execArgv: [`--max-old-space-size=${scope.limits.workerHeapMb}`],
      // No operator credentials, metadata paths or source secrets enter the compute worker.
      env: { TZ: 'UTC', PATH: process.env.PATH },
    });
    let result: T | undefined, error: unknown, sampling = false;
    const kill = () => { error = new MetadataError('EXECUTION_CANCELLED'); child.kill('SIGKILL'); };
    scope.signal.addEventListener('abort', kill, { once: true });
    const sample = async () => {
      if (sampling || !child.pid) return; sampling = true;
      try {
        const status = await readFile(`/proc/${child.pid}/status`, 'utf8');
        const rss = /^VmRSS:\s+(\d+) kB/m.exec(status);
        if (rss) scope.rss(Number(rss[1]) * 1024);
        scope.check();
      } catch (e) {
        if (child.exitCode === null && child.signalCode === null) { error = e; child.kill('SIGKILL'); }
      } finally { sampling = false; }
    };
    const timer = setInterval(() => { void sample(); }, 20);
    child.on('error', () => { error = new MetadataError('WORKER_EXECUTION_FAILED', 503); child.kill('SIGKILL'); });
    child.on('message', (message: { result?: T; errorCode?: string; executing?: boolean; bytes?: number }) => {
      if (message.executing) { scope.workerStarted(); return; }
      if (message.errorCode) error = new MetadataError(message.errorCode, 422);
      else {
        try {
          if (!Number.isSafeInteger(message.bytes) || Number(message.bytes) < 0) throw new MetadataError('WORKER_EXECUTION_FAILED', 503);
          scope.memory(Number(message.bytes)); result = message.result;
        } catch (e) { error = e; child.kill('SIGKILL'); }
      }
      // Worker has finished and disconnected; exit is still required before publication.
    });
    child.once('exit', (code, signal) => {
      clearInterval(timer); scope.signal.removeEventListener('abort', kill);
      try { scope.check(); if (error) throw error; if (signal === 'SIGKILL') throw new MetadataError('EXECUTION_CANCELLED'); if (code !== 0 || result === undefined) throw new MetadataError('WORKER_EXECUTION_FAILED', 503); resolve(result); }
      catch (e) { reject(e); }
    });
    if (scope.signal.aborted) kill();
    else child.send({ task, limits: { ...limits, datasetBytes: Math.min(limits.datasetBytes, remaining) }, memoryMb: scope.limits.duckdbMemoryMb, resultBytes: Math.min(scope.limits.resultBytes, remaining), deadline: Date.now() + Math.max(1, scope.limits.executionMs - (performance.now() - scope.started)), rssBytes: scope.limits.workerRssBytes } satisfies WorkerRequest, e => { if (e) { error = new MetadataError('WORKER_EXECUTION_FAILED', 503); child.kill('SIGKILL'); } });
  });
}
