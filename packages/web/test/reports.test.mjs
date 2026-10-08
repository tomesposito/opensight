import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { AccessProvider, demoAccess } from '../build/test/access.js';
import { createReportStore, previewRows, reportStorageKey, sampleReport } from '../build/test/report-drafts.js';
import { Reports, ReportPage } from '../build/test/Reports.js';
import { layoutReport, renderPdf } from '@opensight/reports';

function storage() { const values = new Map(); return { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) }; }
test('report drafts persist definitions only, survive reload and isolate mode/principal storage', () => {
  const s = storage(), store = createReportStore(() => s, demoAccess), d = sampleReport();
  store.save(d); assert.deepEqual(createReportStore(() => s, demoAccess).open(d.id), d);
  assert.doesNotMatch(s.getItem(reportStorageKey(demoAccess)), /rowsByBand/);
  assert.deepEqual(createReportStore(() => s, { mode: 'local' }).list(), []);
  const alice = { mode: 'hosted', session: { namespaceId: 'one', id: 'alice' } };
  createReportStore(() => s, alice).save(d);
  assert.deepEqual(createReportStore(() => s, { ...alice, session: { ...alice.session, id: 'bob' } }).list(), []);
  store.save({ ...d, title: 'Changed' }); assert.equal(store.list().length, 1); assert.equal(store.open(d.id).title, 'Changed');
  store.delete(d.id); assert.throws(() => store.open(d.id), /no longer exists/);
});
test('report storage preserves corrupt data and reports quota failures without false success', () => {
  const s = storage(), key = reportStorageKey(demoAccess); s.setItem(key, '{bad');
  const store = createReportStore(() => s, demoAccess);
  assert.throws(() => store.save(sampleReport()), /could not be read/); assert.equal(s.getItem(key), '{bad');
  assert.throws(() => createReportStore(() => ({ getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } }), demoAccess).save(sampleReport()), /QuotaExceededError/);
});
test('sample rows bind only the explicit sample dataset; text-only imported reports need no data', () => {
  const d = sampleReport(); assert.equal(previewRows(d).orders.length, 72);
  d.body[2].datasetId = 'private'; assert.throws(() => previewRows(d), /REPORT_ROWS_UNAVAILABLE/);
  d.body = [d.body[0]]; assert.deepEqual(previewRows(d), {}); assert.ok(renderPdf(d, layoutReport(d, {})).length > 100);
});
test('Reports preview navigates, saves, reloads, exports real PDF and hides export on invalid geometry', async t => {
  const oldWindow = globalThis.window, oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT, oldDocument = globalThis.document, oldUrl = URL.createObjectURL, oldRevoke = URL.revokeObjectURL;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.window = { localStorage: storage() };
  let blob, downloaded;
  URL.createObjectURL = b => { blob = b; return 'blob:synthetic'; }; URL.revokeObjectURL = () => {};
  globalThis.document = { createElement: () => ({ click() { downloaded = this.download; } }) };
  let renderer;
  const mount = async () => act(() => { renderer = create(createElement(AccessProvider, { access: demoAccess }, createElement(Reports))); });
  await mount();
  t.after(async () => { await act(() => renderer.unmount()); globalThis.window = oldWindow; globalThis.document = oldDocument; globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct; URL.createObjectURL = oldUrl; URL.revokeObjectURL = oldRevoke; });
  const button = label => renderer.root.findAllByType('button').find(b => b.props.children === label);
  assert.equal(renderer.root.findByType(ReportPage).props.page.number, 1);
  const count = renderer.root.findByType(ReportPage).props.page.totalPages; assert.ok(count > 1);
  await act(() => button('Next page').props.onClick()); assert.equal(renderer.root.findByType(ReportPage).props.page.number, 2);
  await act(() => button('Export PDF').props.onClick()); assert.equal(downloaded, 'sample-report.pdf'); assert.ok((await blob.text()).startsWith('%PDF'));
  await act(() => button('Save draft').props.onClick());
  assert.match(JSON.stringify(renderer.toJSON()), /Report definition saved on this device/);
  await act(() => renderer.unmount()); await mount();
  await act(() => button('Sales activity - sample report').props.onClick()); assert.equal(renderer.root.findByType(ReportPage).props.page.number, 1);
  await act(() => renderer.root.findAllByType('input').find(i => i.props.type === 'number').props.onChange({ target: { valueAsNumber: 1000 } }));
  assert.equal(button('Export PDF'), undefined); assert.match(JSON.stringify(renderer.toJSON()), /REPORT_INVALID_DEFINITION/);
});
