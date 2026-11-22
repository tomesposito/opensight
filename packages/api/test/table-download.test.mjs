import test from 'node:test';
import assert from 'node:assert/strict';
import { TenantBudgets } from '../dist/budgets.js';
import { BlazeTable } from '../dist/blaze.js';
import { tableDownload, sendTableDownload, downloadAdmission } from '../dist/table-download.js';
import { budgetConfig } from './budget-helpers.mjs';
import { rowsToCsv } from '@opensight/web/exports';
import { getEventListeners } from 'node:events';
import { read as readXlsx, utils as xlsxUtils } from 'xlsx';
import { createServer, get } from 'node:http';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { LocalTableDownloads } from '../dist/local-table-download.js';

const context = { tenantId: 'test', namespaceId: 'test', userId: 'author', authorizationRevision: 1 };
function table(rows = [['=SUM(A1)', 3]]) {
  const result = new BlazeTable({ maxBytes: 16777216, datasetBytes: 16777216, maxRows: 100000, cellChars: 16384 });
  result.start([{ name: 'text', type: 'string' }, { name: 'value', type: 'number' }]);
  for (const row of rows) result.row(row);
  return result;
}
for (const format of ['csv', 'xlsx']) test(`#308 ${format} refuses encoding memory before reading cells or allocating row copies`, async t => {
  const config = structuredClone(budgetConfig); config.defaults.workingBytes = config.defaults.resultBytes = 1024;
  const budgets = new TenantBudgets(config, () => {}), input = table();
  t.mock.method(input, 'rows', () => assert.fail('row objects allocated before admission'));
  t.mock.method(input, 'value', () => assert.fail('cell read before admission'));
  await assert.rejects(budgets.run(context, false, async () => {}, () => tableDownload(budgets.current(context), 'table', input, format)), { code: 'TENANT_BUDGET_EXCEEDED' });
  assert.equal(budgets.snapshot(context.tenantId).workerExecutions, 0);
  assert.deepEqual(budgets.node(), { running: 0, queued: 0 });
});
test('#308 CSV streams bounded chunks with existing quoting, formula safety, Unicode and empty headers', async t => {
  const budgets = new TenantBudgets(budgetConfig, () => {});
  for (const rows of [[], [['=SUM(A1)', 3], ['a,"b"\r\n雪😀', -2], ['@formula', null], ['\ttext', true]], Array.from({ length: 5000 }, () => ['é😀'.repeat(20), 17])]) {
    const input = table(rows), expected = rows.length ? rowsToCsv(input.rows()) : 'text,value\r\n';
    t.mock.method(input, 'rows', () => assert.fail('CSV must not materialize row objects'));
    await budgets.run(context, false, async () => {}, async () => {
      const download = await tableDownload(budgets.current(context), 'table', input, 'csv'), chunks = [];
      for await (const chunk of download.body) { assert.ok(chunk.length <= 65536); chunks.push(chunk); }
      assert.equal(Buffer.concat(chunks).toString(), expected);
      assert.equal(download.byteLength, Buffer.byteLength(expected));
      if (download.byteLength > 65536) assert.ok(chunks.length > 1);
    });
  }
  const input = table([['first', 'second']]); input.columns[0].name = '10'; input.columns[1].name = '2';
  await budgets.run(context, false, async () => {}, async () => {
    const download = await tableDownload(budgets.current(context), 'table', input, 'csv'), chunks = [];
    for await (const chunk of download.body) chunks.push(chunk);
    assert.equal(Buffer.concat(chunks).toString(), '2,10\r\nsecond,first\r\n');
  });
});
for (const stage of ['sizing', 'streaming']) test(`#308 CSV cancellation interrupts ${stage} and drains admission`, async t => {
  const budgets = new TenantBudgets(budgetConfig, () => {}), input = table(Array.from({ length: 5000 }, () => ['text', 1]));
  let reads = 0;
  await assert.rejects(budgets.run(context, false, async () => {}, async () => {
    const scope = budgets.current(context), value = input.value;
    const cancel = () => t.mock.method(input, 'value', (...args) => {
      if (++reads === 100) setImmediate(() => scope.cancel());
      return value(...args);
    });
    if (stage === 'sizing') cancel();
    const result = await tableDownload(scope, 'table', input, 'csv');
    if (stage === 'streaming') cancel();
    for await (const _chunk of result.body) { /* consume until cancelled */ }
  }), { code: 'EXECUTION_CANCELLED' });
  assert.ok(reads >= 100 && reads < 1000, `only bounded work after cancellation: ${reads}`);
  assert.deepEqual(budgets.node(), { running: 0, queued: 0 });
});
test('#308 XLSX encodes in a contained worker and preserves typed cells, formulas as text and empty headers', async t => {
  const budgets = new TenantBudgets(budgetConfig, () => {});
  for (const rows of [[], [['=1+1', 12], ['+cmd', false], ['雪😀', null]]]) {
    const input = table(rows);
    t.mock.method(input, 'rows', () => assert.fail('XLSX must not create row objects'));
    await budgets.run(context, false, async () => {}, async () => {
      const scope = budgets.current(context), before = budgets.snapshot(context.tenantId).workerExecutions;
      const result = await tableDownload(scope, 'table', input, 'xlsx'), chunks = [];
      assert.equal(budgets.snapshot(context.tenantId).workerExecutions, before + 1);
      for await (const chunk of result.body) { assert.ok(chunk.length <= 65536); chunks.push(chunk); }
      const bytes = Buffer.concat(chunks); assert.equal(bytes.length, result.byteLength);
      const book = readXlsx(bytes, { type: 'buffer' }), sheet = book.Sheets.Table;
      assert.deepEqual(xlsxUtils.sheet_to_json(sheet, { header: 1, defval: null }), [['text', 'value'], ...rows]);
      if (rows.length) { assert.equal(sheet.A2.t, 's'); assert.equal(sheet.A2.v, '=1+1'); assert.equal(sheet.A2.f, undefined); }
      assert.equal(getEventListeners(scope.signal, 'abort').length, 0, 'worker exit removes cancellation listener');
    });
  }
});
test('#308 XLSX cancellation during worker encoding keeps admission until the child is reaped', async t => {
  const budgets = new TenantBudgets(budgetConfig, () => {}), input = table(Array.from({ length: 500 }, () => ['=text', 1]));
  let encoding = false, scope;
  await assert.rejects(budgets.run(context, false, async () => {}, async () => {
    scope = budgets.current(context);
    const started = scope.workerStarted.bind(scope);
    t.mock.method(scope, 'workerStarted', () => {
      started(); encoding = true; scope.cancel();
      assert.equal(budgets.node().running, 1, 'cancel does not release the live worker');
    });
    await tableDownload(scope, 'table', input, 'xlsx');
    assert.fail('cancelled workbook published');
  }), { code: 'EXECUTION_CANCELLED' });
  assert.equal(encoding, true);
  assert.equal(getEventListeners(scope.signal, 'abort').length, 0);
  assert.deepEqual(budgets.node(), { running: 0, queued: 0 });
});

for (const format of ['csv', 'xlsx']) test(`#308 concurrent slow ${format} clients retain aggregate admission through finish and disconnect`, { timeout: 15000 }, async t => {
  const config = structuredClone(budgetConfig);
  config.defaults.running = 3; config.defaults.queued = 0; config.defaults.workingBytes = 32 * 1048576;
  config.node.running = 4; config.node.workingBytes = 64 * 1048576;
  const budgets = new TenantBudgets(config, () => {});
  const input = table(Array.from({ length: 2000 }, (_, i) => [randomBytes(72).toString('base64'), i]));
  const started = new Map(), completed = new Map(), responses = new Map(), expected = new Map(), written = new Map(), settled = new Map();
  let encodings = 0;
  const server = createServer((request, response) => {
    const id = request.url, controller = new AbortController();
    responses.set(id, response);
    response.once('close', () => { if (!response.writableFinished) controller.abort(); });
    void (async () => {
      try {
        await budgets.run(context, false, async () => {}, async () => {
          encodings++;
          const result = await tableDownload(budgets.current(context), 'table', input, format);
          expected.set(id, result.byteLength); assert.ok(result.byteLength > 65536);
          // Hold the real HTTP socket's drain deterministically. Small fixtures
          // otherwise fit OS send buffers even when the remote client pauses.
          if (id !== '/fast') response.cork();
          const write = response.write;
          response.write = function (chunk, ...args) {
            written.set(id, (written.get(id) ?? 0) + chunk.length);
            const ready = write.call(this, chunk, ...args);
            started.get(id)?.resolve(); return ready;
          };
          await sendTableDownload(response, result, { scope: context, usage: {
            reserveEgress: async () => id,
            assertEgressSize: async (reservation, bytes) => assert.equal(bytes, expected.get(reservation)),
            settleEgress: async (reservation, bytes) => settled.set(reservation, bytes),
            releaseEgress: async () => assert.fail('admitted response must settle'),
          } });
        }, controller.signal);
        completed.get(id)?.resolve('finished');
      } catch (error) {
        if (!response.headersSent && !response.destroyed) response.writeHead(429).end(error.code);
        completed.get(id)?.resolve(error.code);
      }
    })();
  });
  const clients = [];
  t.after(async () => { for (const client of clients) client.destroy(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await budgets.shutdown(); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const request = id => {
    const result = Promise.withResolvers(); started.set(id, Promise.withResolvers()); completed.set(id, Promise.withResolvers());
    const client = get(`http://127.0.0.1:${server.address().port}${id}`, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk));
      response.once('end', () => result.resolve({ status: response.statusCode, bytes: Buffer.concat(chunks) }));
      response.once('error', () => result.resolve({ disconnected: true }));
    });
    client.once('error', () => result.resolve({ disconnected: true })); clients.push(client);
    return { client, result: result.promise };
  };
  const first = request('/first'), second = request('/second');
  await Promise.all([started.get('/first').promise, started.get('/second').promise]);
  assert.deepEqual(budgets.node(), { running: 2, queued: 0 });
  assert.equal(settled.size, 0, 'pending transmissions retain egress and work');
  const refused = await request('/refused').result;
  assert.equal(refused.status, 429); assert.equal(refused.bytes.toString(), 'TENANT_BUDGET_EXCEEDED');
  assert.equal(encodings, 2, 'aggregate refusal precedes loading/copying/encoding');
  responses.get('/first').uncork();
  const served = await first.result;
  assert.equal(served.status, 200); assert.equal(served.bytes.length, expected.get('/first'));
  assert.equal(await completed.get('/first').promise, 'finished');
  assert.equal(budgets.node().running, 1);
  assert.equal(settled.get('/first'), served.bytes.length);
  const fast = await request('/fast').result;
  assert.equal(fast.status, 200); assert.equal(fast.bytes.length, expected.get('/fast'));
  assert.equal(await completed.get('/fast').promise, 'finished');
  assert.equal(encodings, 3);
  second.client.destroy(); await second.result;
  assert.equal(await completed.get('/second').promise, 'EXECUTION_CANCELLED');
  assert.equal(settled.get('/second'), written.get('/second'), 'settle writes, not prefetched CSV/output capacity');
  assert.ok(settled.get('/second') > 0 && settled.get('/second') < expected.get('/second'));
  assert.deepEqual(budgets.node(), { running: 0, queued: 0 });
});

test('#308 egress denial consumes no body and releases the local reservation; hosted admission is reused', async t => {
  const budgets = new TenantBudgets(budgetConfig, () => {}), events = [];
  const { Writable } = await import('node:stream');
  const response = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  response.writeHead = () => assert.fail('denied download wrote headers');
  await budgets.run(context, false, async () => {}, async () => {
    const result = await tableDownload(budgets.current(context), 'table', table(), 'csv');
    result.body = { async *[Symbol.asyncIterator]() { assert.fail('denial consumed the stream'); } };
    const usage = {
      reserveEgress: async () => { events.push('reserve'); return 'reservation'; },
      assertEgressSize: async (reservation, bytes) => { assert.equal(reservation, 'reservation'); assert.equal(bytes, result.byteLength); events.push('assert'); throw Object.assign(new Error(), { code: 'USAGE_LIMIT_EXCEEDED' }); },
      releaseEgress: async () => events.push('release'),
      settleEgress: async () => assert.fail('denied download settled'),
    };
    await assert.rejects(sendTableDownload(response, result, { usage, scope: context }), { code: 'USAGE_LIMIT_EXCEEDED' });
    assert.deepEqual(events, ['reserve', 'assert', 'release']);
    downloadAdmission(response, async bytes => { assert.equal(bytes, result.byteLength); events.push('hosted'); throw Object.assign(new Error(), { code: 'USAGE_LIMIT_EXCEEDED' }); });
    await assert.rejects(sendTableDownload(response, result), { code: 'USAGE_LIMIT_EXCEEDED' });
    assert.deepEqual(events, ['reserve', 'assert', 'release', 'hosted']);
  });
});

for (const format of ['csv', 'xlsx']) test(`#308 HTTP disconnect during ${format} encoding cancels work before transmission`, { timeout: 10000 }, async t => {
  const downloads = new LocalTableDownloads({ maxBytes: 64 * 1048576, datasetBytes: 16 * 1048576, maxRows: 100000, cellChars: 16384 });
  const input = table(Array.from({ length: 1000 }, () => ['=text', 1])), done = Promise.withResolvers();
  let client, scope, encoding = false, headers = false;
  const server = createServer((request, response) => {
    const head = response.writeHead;
    response.writeHead = function (...args) { headers = true; return head.apply(this, args); };
    void downloads.run(context, request, response, async admitted => {
      scope = admitted;
      if (format === 'csv') {
        let reads = 0; const value = input.value;
        t.mock.method(input, 'value', (...args) => { if (++reads === 100) { encoding = true; client.destroy(); } return value(...args); });
      } else {
        const started = scope.workerStarted.bind(scope);
        t.mock.method(scope, 'workerStarted', () => { started(); encoding = true; client.destroy(); });
      }
      await sendTableDownload(response, await tableDownload(scope, 'table', input, format));
    }).then(() => done.resolve('finished'), error => done.resolve(error.code));
  });
  t.after(() => { client?.destroy(); server.closeAllConnections(); server.close(); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  client = get(`http://127.0.0.1:${server.address().port}`, response => response.resume()); client.on('error', () => {});
  assert.equal(await done.promise, 'EXECUTION_CANCELLED');
  assert.equal(encoding, true); assert.equal(headers, false);
  assert.equal(scope.signal.aborted, true);
  assert.equal(getEventListeners(scope.signal, 'abort').length, 0, 'worker is reaped before the download rejects');
});
test('#308 the work deadline aborts a stalled transmission before releasing admission', async t => {
  const { Writable } = await import('node:stream'), started = Promise.withResolvers();
  const budgets = new TenantBudgets(budgetConfig, () => {});
  const response = new Writable({ highWaterMark: 1, write() { started.resolve(); /* client never drains */ } });
  response.writeHead = () => {};
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = budgets.run(context, false, async () => {}, async () => {
    const scope = budgets.current(context);
    await sendTableDownload(response, await tableDownload(scope, 'table', table(), 'csv'));
  });
  const rejected = assert.rejects(pending, { code: 'EXECUTION_CANCELLED' });
  await started.promise;
  assert.equal(budgets.node().running, 1);
  t.mock.timers.tick(budgetConfig.defaults.executionMs);
  await rejected;
  assert.equal(response.destroyed, true);
  assert.deepEqual(budgets.node(), { running: 0, queued: 0 });
});
