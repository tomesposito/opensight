import { readFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { parseUpload, streamSourceMemory, withPrepMemory, streamPrepDuckDb, queryPrepared, queryPreparedVisual, type PrepMemoryTable } from '@opensight/query-engine';
import { BlazeTable } from './blaze.js';
import type { WorkerRequest, WireTable } from './contained-work.js';
const table = (t: WireTable): PrepMemoryTable => ({ source: t.source, rowCount: t.rows.length, value: (r, c) => t.rows[r]![c]! });
process.once('disconnect', () => process.exit(0));
process.once('message', (request: WorkerRequest) => {
  void (async () => {
    const watchdog = new Worker(new URL('./execution-watchdog.js', import.meta.url), { workerData: { parentPid: /^PPid:\s+(\d+)/m.exec(readFileSync('/proc/self/status', 'utf8'))?.[1], deadline: request.deadline, rssBytes: request.rssBytes } });
    watchdog.unref();
    watchdog.on('error', () => process.kill(process.pid, 'SIGKILL'));
    process.send?.({ executing: true });
    const { task, limits, memoryMb } = request, output = new BlazeTable(limits);
    let result: unknown;
    if (task.kind === 'upload') {
      const parsed = parseUpload(task.request); output.start(parsed.columns); for (const row of parsed.rows) output.row(row);
      result = { columns: output.columns, rows: parsed.rows };
    } else if (task.kind === 'query') { const t = table(task.table); result = queryPrepared(t.source.columns, t.rowCount, t.value, task.query); }
    else if (task.kind === 'visual') { const t = table(task.table); result = queryPreparedVisual(t.source.columns, t.rowCount, t.value, task.analysis, task.visualId, task.dataSetArn); }
    else {
      if (task.kind === 'source') await streamSourceMemory(task.read, table(task.table), limits, output, { memoryMb });
      else await withPrepMemory(task.tables.map(table), c => streamPrepDuckDb(c, task.pipeline, task.sources,
        { datasets: task.datasets, datasetId: task.id, ...(task.through === undefined ? {} : { through: task.through }) }, limits, output), { memoryMb });
      result = { columns: output.columns, rows: Array.from({ length: output.rowCount }, (_, r) => output.columns.map((_, c) => output.value(r, c))) };
    }
    // Intermediate tables use working memory; final query payloads use the result budget.
    const bytes = Buffer.byteLength(JSON.stringify(result));
    if (bytes > ((task.kind === 'query' || task.kind === 'visual') ? request.resultBytes : limits.datasetBytes)) throw Object.assign(new Error(), { code: 'TENANT_BUDGET_EXCEEDED' });
    process.send?.({ result, bytes: (task.kind === 'query' || task.kind === 'visual') ? bytes * 4 : output.bytes }, () => process.disconnect?.());
  })().catch((error: unknown) => {
    const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'WORKER_EXECUTION_FAILED';
    process.send?.({ errorCode: code }, () => process.disconnect?.());
  });
});
