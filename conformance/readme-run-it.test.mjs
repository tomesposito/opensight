import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveConfig } from 'vite';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const section = (markdown, heading) => {
  const body = markdown.split(`## ${heading}\n`)[1];
  assert.ok(body, `Missing ${heading} section`);
  return body.split(/^## /m)[0];
};
const commands = markdown => [...markdown.matchAll(/^```bash\n([\s\S]*?)^```/gm)]
  .flatMap(match => match[1].split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#')));
const readme = read('README.md');
const runIt = section(readme, 'Run it');

test('README Run it commands resolve to existing npm workspace scripts in startup order', () => {
  assert.ok(readme.indexOf('## Run it\n') < readme.indexOf('## Contributor quickstart\n'));
  const packages = readdirSync(new URL('packages/', root), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => JSON.parse(read(`packages/${entry.name}/package.json`)));
  const workspaces = new Map(packages.map(pkg => [pkg.name, pkg]));
  const steps = commands(runIt);
  assert.equal(steps[0], 'npm ci', 'Install dependencies before building');
  assert.ok(JSON.parse(read('package-lock.json')).lockfileVersion);
  const scripts = [];
  for (const command of steps.slice(1)) {
    const match = /^npm (?:run ([\w:-]+)|(start)) --workspace(?:=| )(@[\w-]+\/[\w-]+)$/.exec(command);
    assert.ok(match, `Unrecognized Run it command: ${command}; extend this guard when changing the workflow`);
    const [, run, start, workspace] = match;
    assert.ok(workspaces.has(workspace), `Unknown workspace in ${command}`);
    assert.ok(workspaces.get(workspace).scripts?.[run ?? start], `Missing script in ${command}`);
    scripts.push(`${workspace}:${run ?? start}`);
  }
  const build = scripts.indexOf('@opensight/api:build');
  const start = scripts.indexOf('@opensight/api:start');
  assert.ok(build >= 0 && start > build, 'Build the API before starting it');
  assert.ok(scripts.indexOf('@opensight/web:dev') > start, 'Start the web app in terminal 2');
});

test('README Run it URLs match API CLI defaults and the resolved Vite development config', async () => {
  const cli = read('packages/api/src/cli.ts');
  const defaultEnv = name => {
    const value = cli.match(new RegExp(`process\\.env\\.${name} \\?\\? '([^']+)'`))?.[1];
    assert.ok(value, `Cannot read CLI ${name} default; update the documentation guard`);
    return value;
  };
  const apiOrigin = `http://${defaultEnv('HOST')}:${defaultEnv('PORT')}`;
  const web = JSON.parse(read('packages/web/package.json'));
  const host = web.scripts.dev.match(/--host(?:=| )([\w.-]+)/)?.[1];
  assert.ok(host, 'The documented dev command must bind an explicit host');
  const config = await resolveConfig({ root: fileURLToPath(new URL('packages/web/', root)), envDir: false }, 'serve');
  const portOverride = web.scripts.dev.match(/--port(?:=| )(\d+)/)?.[1];
  const webOrigin = `http://${host}:${portOverride ?? config.server.port}`;
  assert.equal(config.server.proxy['/api'].target, apiOrigin, 'Vite must proxy to the default API');
  assert.deepEqual(new Set(runIt.match(/http:\/\/[\w.-]+:\d+/g)), new Set([apiOrigin, webOrigin]));
  assert.ok(runIt.includes(`**${new URL(apiOrigin).port}** (API)`));
  assert.ok(runIt.includes(`**${new URL(webOrigin).port}** (web)`));
});

test('first-run and local-data guides agree with the README entry point', () => {
  const firstRun = section(read('docs/first-run.md'), 'Run locally');
  assert.deepEqual(commands(firstRun), commands(runIt));
  for (const path of ['docs/first-run.md', 'docs/local-data.md']) {
    const guide = read(path);
    assert.ok(guide.includes('../README.md#run-it'), `${path} must link to Run it`);
    const startup = path === 'docs/first-run.md' ? firstRun : guide;
    for (const url of new Set(startup.match(/http:\/\/[\w.-]+:\d+/g))) {
      assert.ok(runIt.includes(url), `${path} startup URL must agree with Run it`);
    }
  }
});
