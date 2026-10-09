import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromiumPage } from './chromium.mjs';
import { prepareAnalysisPrint, printAnalysis } from '../build/test/analysis-print.js';

const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
describe('current analysis printing', () => {
let page;
before(async () => { page = await chromiumPage(); });
after(async () => { await page?.close(); });
const evaluate = body => page.evaluate(new Function(`${prepareAnalysisPrint.toString()}; ${printAnalysis.toString()}; ${body}`));
async function render() {
  await page.setContent(`<title>OpenSight</title><style>${css}</style><main><div class="author-workspace"><nav>File menu</nav><p class="fixture-notice">Synthetic offline sample. No live queries.</p><div class="author-center" style="width:700px;height:650px"><div class="sheet-toolbar">Other sheet and edit actions</div><section class="controls-strip"><div class="controls-heading"><button>Add control</button></div><p>No controls</p></section><label>Region<select><option>East</option><option selected>West</option></select></label><div class="author-canvas"><div class="author-card" style="height:400px"><div class="author-card-toolbar">Delete visual</div><h3>Current revenue</h3><svg width="300" height="150"><defs><clipPath id="clip"><rect width="300" height="150"/></clipPath></defs><rect width="200" height="100" fill="teal" clip-path="url(#clip)"/></svg><div class="table-scroll" style="height:80px"><table><tbody>${Array.from({ length: 20 }, (_, i) => `<tr><td><button>Group ${i}</button></td><td>${i * 100}</td></tr>`).join('')}</tbody></table></div></div></div></div></div></main>`);
}

test('print snapshot preserves current controls, SVG references, table scroll and literal title while excluding editor actions', async () => {
  await render();
  const result = await evaluate(`
    const workspace = document.querySelector('.author-workspace');
    workspace.querySelector('.table-scroll').scrollTop = 75;
    workspace.querySelector('select').value = 'East';
    const cleanup = prepareAnalysisPrint(workspace, '<img src=x onerror=alert(1)>', 'Current sheet');
    const root = document.querySelector('.analysis-print-root');
    const result = { text: root.textContent, title: root.querySelector('h1').textContent,
      controls: root.querySelectorAll('button, input, select, textarea').length,
      injected: root.querySelectorAll('img, script, iframe').length,
      clip: root.querySelector('clipPath').id, reference: root.querySelector('rect[clip-path]').getAttribute('clip-path'),
      scroll: root.querySelector('.table-scroll').scrollTop, inert: root.inert };
    cleanup(); return result;`);
  assert.equal(result.title, '<img src=x onerror=alert(1)>');
  assert.match(result.text, /East.*Current revenue.*Group 19/s);
  assert.doesNotMatch(result.text, /File menu|Other sheet|Delete visual|West|Add control|No controls/);
  assert.equal(result.controls, 0); assert.equal(result.injected, 0); assert.equal(result.inert, true);
  assert.notEqual(result.clip, 'clip'); assert.equal(result.reference, `url(#${result.clip})`);
  assert.ok(Math.abs(result.scroll - 75) < 1, 'Zoom rounding must preserve the displayed scroll offset');
});

test('Print invokes the browser and cleans up only when preview closes; failures restore the page', async () => {
  await render();
  const result = await evaluate(`
    let calls = 0;
    window.print = () => { calls++; };
    const workspace = document.querySelector('.author-workspace');
    const finish = printAnalysis(workspace, 'Sales snapshot', 'Sheet 1');
    const before = { calls, title: document.title, snapshots: document.querySelectorAll('.analysis-print-root').length };
    window.dispatchEvent(new Event('afterprint')); finish();
    const after = { title: document.title, snapshots: document.querySelectorAll('.analysis-print-root').length };
    window.print = () => { throw new Error('Browser refused'); };
    let error; try { printAnalysis(workspace, 'Failed', 'Sheet 1'); } catch (e) { error = e.message; }
    return { before, after, error, remaining: document.querySelectorAll('.analysis-print-root').length, title: document.title };`);
  assert.deepEqual(result.before, { calls: 1, title: 'Sales snapshot', snapshots: 1 });
  assert.deepEqual(result.after, { title: 'OpenSight', snapshots: 0 });
  assert.equal(result.error, 'Browser refused'); assert.equal(result.remaining, 0); assert.equal(result.title, 'OpenSight');
});

test('missing sheet, pending visuals and unavailable printing fail with reasons', async () => {
  await render();
  const result = await evaluate(`
    const workspace = document.querySelector('.author-workspace'), center = workspace.querySelector('.author-center');
    const errors = [];
    center.setAttribute('aria-busy', 'true'); center.innerHTML = '<div class="visual-skeleton">Loading</div>';
    try { prepareAnalysisPrint(workspace, 'Loading', 'Sheet'); } catch (e) { errors.push(e.message); }
    center.remove();
    try { prepareAnalysisPrint(workspace, 'Missing', 'Sheet'); } catch (e) { errors.push(e.message); }
    window.print = undefined;
    try { printAnalysis(workspace, 'Unsupported', 'Sheet'); } catch (e) { errors.push(e.message); }
    return errors;`);
  assert.match(result[0], /finish loading/); assert.match(result[1], /sheet is unavailable/); assert.match(result[2], /Printing is unavailable/);
});

test('print media renders only the sheet snapshot and produces a real one-page PDF', async () => {
  await render();
  await evaluate(`prepareAnalysisPrint(document.querySelector('.author-workspace'), 'Revenue snapshot', 'Sheet 1');`);
  await page.emulateMedia('print');
  const styles = await page.evaluate(() => ({ original: getComputedStyle(document.querySelector('main')).display,
    snapshot: getComputedStyle(document.querySelector('.analysis-print-root')).visibility,
    width: document.querySelector('.analysis-print-sheet').getBoundingClientRect().width }));
  assert.equal(styles.original, 'none'); assert.equal(styles.snapshot, 'visible'); assert.ok(styles.width <= 980);
  const { data } = await page.printToPDF();
  const pdf = Buffer.from(data, 'base64'); assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.equal([...pdf.toString('latin1').matchAll(/\/Type \/Page\b/g)].length, 1);
  assert.ok(pdf.length > 5000);
  await page.emulateMedia('screen');
});

});
