import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url)), repo = resolve(directory, '../../../..');
const output = resolve(process.env.OPENSIGHT_PERSONA_OUTPUT ?? resolve(repo, '.opensight/persona-journeys'));
const env = { ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://postgres@localhost:5433/opensight',
  TMPDIR: resolve(homedir(), 'workspace/.tmp'), OPENSIGHT_PERSONA_OUTPUT: output };
await mkdir(env.TMPDIR, { recursive: true }); await mkdir(output, { recursive: true });
const journeys = [
  ['j1-discover', 'Evaluator'], ['j2-first-login', 'Workspace Admin'], ['j3-first-dashboard', 'Author'], ['j4-reader-daily', 'Reader AI'],
  ['j5-migration', 'Admin + Author'], ['j6-self-host', 'Self-Hoster'], ['j7-operator', 'Operator'], ['j8-embedding', 'Embedder (future)'],
];
const results = [];
for (const [journey, persona] of journeys) {
  console.log(`\nRunning ${journey} (${persona})`);
  const path = resolve(output, `${journey}.json`); await rm(path, { force: true });
  const exit = await new Promise(resolveExit => {
    const child = spawn(process.execPath, [resolve(directory, `${journey}.mjs`)], { cwd: repo, env, stdio: 'inherit', timeout: 600000 });
    let error;
    child.on('error', value => { error = value.message; });
    child.on('close', (code, signal) => resolveExit({ code, signal, ...(error ? { error } : {}) }));
  });
  let result;
  try {
    result = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(result.journey, journey); assert.equal(result.persona, persona);
    assert.ok(Array.isArray(result.steps) && result.steps.length > 0); assert.ok(Array.isArray(result.screenshots));
    for (const step of result.steps) {
      assert.ok(['pass', 'fail', 'gap'].includes(step.status)); assert.equal(typeof step.name, 'string'); assert.ok(step.detail);
      if (step.status === 'gap') { assert.ok(step.detail.expected); assert.ok(step.detail.actual); }
    }
  } catch (error) {
    result = { journey, persona, steps: [{ name: 'missing-or-invalid-result', status: 'fail', detail: error.message }], screenshots: [] };
  }
  if (exit.code !== 0 && !result.steps.some(s => s.status === 'fail')) result.steps.push({ name: 'child-process', status: 'fail', detail: exit });
  // Keep the individual result consistent with the aggregate, including crashes.
  await writeFile(path, JSON.stringify(result, null, 2) + '\n');
  const counts = { pass: 0, fail: 0, gap: 0 }; for (const step of result.steps) counts[step.status]++;
  results.push({ ...result, counts, exit });
}
const counts = results.reduce((total, r) => ({ pass: total.pass + r.counts.pass, fail: total.fail + r.counts.fail, gap: total.gap + r.counts.gap }), { pass: 0, fail: 0, gap: 0 });
const summary = { journeys: results.length, ...counts, failedJourneys: results.filter(r => r.counts.fail).length };
await writeFile(resolve(output, 'results.json'), JSON.stringify({ summary, journeys: results }, null, 2) + '\n');
const describe = value => typeof value === 'string' ? value : JSON.stringify(value, null, 2);
const lines = ['# Persona journey browser report', '',
  `${summary.journeys} journeys; ${counts.pass} assertions/observations passed, ${counts.fail} failed, ${counts.gap} gaps.`, '',
  'Passes cover the behavior actually asserted. A journey with gaps is not a completed product experience. Gaps record expected versus actual behavior and do not fail the run. Browser errors, external requests and assertion failures do.', '',
  '| Journey | Persona | Pass | Fail | Gap |', '| --- | --- | ---: | ---: | ---: |',
  ...results.map(r => `| ${r.journey} | ${r.persona} | ${r.counts.pass} | ${r.counts.fail} | ${r.counts.gap} |`), ''];
for (const r of results) {
  lines.push(`## ${r.journey} — ${r.persona}`, '', `Pass: ${r.counts.pass} · Fail: ${r.counts.fail} · Gap: ${r.counts.gap}`, '');
  for (const step of r.steps.filter(s => s.status !== 'pass')) {
    lines.push(`### ${step.status.toUpperCase()}: ${step.name}`, '');
    if (step.status === 'gap') lines.push(`Expected: ${describe(step.detail.expected)}`, '', `Actual: ${describe(step.detail.actual)}`, '');
    else lines.push('```text', describe(step.detail), '```', '');
  }
  lines.push(`Step details: [${r.journey}.json](${r.journey}.json)`, '', 'Screenshots:', '',
    ...(r.screenshots.length ? r.screenshots.map(name => `- [${name}](${name})`) : ['No screenshots captured.']), '');
}
await writeFile(resolve(output, 'REPORT.md'), lines.join('\n') + '\n');
console.log(JSON.stringify(summary)); console.log(`Report: ${resolve(output, 'REPORT.md')}`);
if (counts.fail) process.exitCode = 1;
