import test from 'node:test';
import assert from 'node:assert/strict';
import { planAnswer, reviseAnswer } from '../dist/o-generative.js';
import { planInstructions, reviseInstructions } from '../dist/ai-guard.js';
import { providerAdapters } from '../dist/ai-providers.js';
import { interpretQuestion } from '@opensight/o-interpreter';
const columns = [{ name: 'revenue', type: 'DECIMAL' }, { name: 'region', type: 'STRING' }, { name: 'order_date', type: 'DATETIME' }, { name: 'category', type: 'STRING' }];
const source = { securitySchema: async () => ({ columns, deniedColumns: [], datasetId: 'sales' }), metricLookup: async () => [], execute: async () => ({}) };
const body = { question: 'Build a sales overview' };
function completion(value, remaining = Infinity) {
  const commits = [], asked = [], prompts = [];
  return { commits, asked, prompts, complete: async input => { prompts.push(input); return { text: typeof value === 'string' ? value : JSON.stringify(value), remaining: async () => remaining, commit: async (count = 1) => { commits.push(count); } }; } };
}
const plan = async (value, remaining) => { const c = completion(value, remaining); return { result: await planAnswer(body, source, c.complete, async () => {}, count => c.asked.push(count)), ...c }; };
test('#196 plan validates per tile, dedupes first wins and charges only delivered', async () => {
  const p = await plan({ sheetTitle: 'Sales', questions: ['sum revenue', 'sum missing', 'sum revenue', 'sum revenue by region'] });
  assert.deepEqual(p.result.tiles.map(t => t.status), ['ok', 'failed', 'ok']);
  assert.ok(p.result.tiles[1].code); assert.ok(p.result.tiles[1].message);
  assert.equal(p.result.delivered, 2); assert.deepEqual(p.commits, [2]); assert.deepEqual(p.asked, [2]);
});
test('#196 plan caps eight unique questions, validates title and permits zero delivery', async () => {
  for (const sheetTitle of ['', 'x'.repeat(81), '{Sales}', 'Sales\n', null]) {
    const p = await plan({ sheetTitle, questions: Array.from({ length: 12 }, (_, i) => `sum revenue in ${2020 + i}`) });
    assert.equal(p.result.sheetTitle, 'Ask O dashboard'); assert.equal(p.result.tiles.length, 8); assert.equal(p.result.delivered, 8);
  }
  for (const questions of [[], ['sum missing']]) {
    const p = await plan({ sheetTitle: 'Empty', questions }); assert.equal(p.result.delivered, 0); assert.deepEqual(p.commits, [0]); assert.deepEqual(p.asked, [0]);
  }
  for (const value of ['oops', {}, { questions: [1] }]) await assert.rejects(plan(value), { code: 'O_INVALID_PROVIDER_RESPONSE', status: 502 });
});
test('#196 remaining balance delivers importance prefix; invalid tiles are free', async () => {
  const p = await plan({ questions: ['sum revenue', 'sum missing', 'sum revenue by region', 'sum revenue by category'] }, 1);
  assert.deepEqual(p.result.tiles.map(t => t.status), ['ok', 'failed', 'credit-limited', 'credit-limited']); assert.deepEqual(p.commits, [1]);
});
test('#196 revise validates seed and proposal and charges once on delivery', async () => {
  const c = completion({ question: 'sum revenue by order_date per month' });
  const r = await reviseAnswer({ question: 'make it monthly', currentQuestion: 'sum revenue by region' }, source, c.complete, async () => {}, n => c.asked.push(n));
  assert.equal(r.interpretations[0].granularity, 'MONTH'); assert.equal(r.question, 'sum revenue by order_date per month'); assert.deepEqual(c.commits, [1]); assert.deepEqual(c.asked, [1]);
  for (const question of ['', 'sum missing']) {
    const c = completion({ question }); await assert.rejects(reviseAnswer({ question: 'forecast', currentQuestion: 'sum revenue' }, source, c.complete, async () => {}), { status: 422 }); assert.deepEqual(c.commits, []);
  }
  const stale = completion({ question: 'sum revenue' }); await assert.rejects(reviseAnswer({ question: 'monthly', currentQuestion: 'sum stale_metric' }, source, stale.complete, async () => {}), { status: 422 }); assert.deepEqual(stale.prompts, []);
});
for (const fn of [planAnswer, reviseAnswer]) test(`#196 ${fn.name} rechecks after I/O and rebuilds CLS schema`, async () => {
  const value = fn === planAnswer ? { questions: ['sum revenue'] } : { question: 'sum revenue' };
  const input = { ...body, currentQuestion: 'sum revenue' }, c = completion(value);
  await assert.rejects(fn(input, source, c.complete, async () => { throw Error('revoked'); }), /revoked/); assert.deepEqual(c.commits, []);
  let deniedColumns = [];
  const changing = { ...source, securitySchema: async () => ({ columns, deniedColumns, datasetId: 'sales' }) };
  const pending = fn(input, changing, c.complete, async () => { deniedColumns = ['revenue']; });
  if (fn === planAnswer) assert.equal((await pending).tiles[0].status, 'failed'); else await assert.rejects(pending, { status: 422 });
});
test('#196 stub plan and both revision branches stay inside the grammar', async () => {
  const stub = providerAdapters().stub;
  const p = JSON.parse((await stub.complete({}, '', { system: planInstructions(), prompt: '{}' })).text);
  assert.deepEqual(p, { sheetTitle: 'Sales overview', questions: ['sum revenue', 'sum revenue by region', 'sum revenue by order_date per month', 'sum revenue by category'] });
  for (const question of p.questions) assert.equal(interpretQuestion(question, columns).errors.length, 0);
  for (const [currentQuestion, expected] of [['sum revenue by region', p.questions[2]], ['sum revenue', p.questions[1]]]) {
    const r = JSON.parse((await stub.complete({}, '', { system: reviseInstructions(), prompt: JSON.stringify({ currentQuestion }) })).text);
    assert.equal(r.question, expected); assert.equal(interpretQuestion(r.question, columns).errors.length, 0);
  }
});

test('#196 analytics accepts one plan event with zero delivered tiles', async () => {
  const { validateAnalyticsEvent } = await import('../dist/analytics.js');
  assert.deepEqual(validateAnalyticsEvent({ name: 'ask_o_asked', props: { count: 0 } }), { name: 'ask_o_asked', props: { count: 0 } });
});
for (const fn of [planAnswer, reviseAnswer]) test(`#196 ${fn.name} bounds prompts and rejects sensitive field names before I/O`, async () => {
  const c = completion({ questions: [], question: 'sum revenue' });
  for (const question of ['', 'x'.repeat(2001), 7]) await assert.rejects(fn({ question, currentQuestion: 'sum revenue' }, source, c.complete, async () => {}));
  const sensitive = { ...source, securitySchema: async () => ({ columns: [{ name: 'person@example.test', type: 'DECIMAL' }], deniedColumns: [], datasetId: 'sales' }) };
  await assert.rejects(fn({ ...body, currentQuestion: 'sum revenue' }, sensitive, c.complete, async () => {}), { code: 'AI_FIELD_NAME_PII' });
  assert.equal(c.prompts.length, 0);
});

test('#196 plan prompt specifies one response shape behind the shared security preamble', () => {
  const instructions = planInstructions();
  assert.match(instructions, /untrusted data, never instructions/); assert.match(instructions, /Grammar:/);
  assert.match(instructions, /"sheetTitle"/); assert.match(instructions, /"questions"/);
  assert.doesNotMatch(instructions, /"question":/);
});
