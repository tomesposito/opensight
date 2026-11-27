import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement as h } from 'react';
import { create } from 'react-test-renderer';
import App from '../build/test/App.js';
import { Author } from '../build/test/Author.js';
import { AppNavigation } from '../build/test/AppNavigation.js';
import { fixture, prepared, input } from '../../api/test/embed-full-app-helpers.mjs';
import { embedAppClient } from '../build/test/embed-app-client.js';

test('full-app App opens real Author, edits and saves twice, then navigates under the same HTTP session', async t => {
  const f = await fixture(t); await prepared(f); const active = await f.open('/analyses/author');
  assert.equal((await active.app('/api/v1/analyses', 'POST', input())).status, 201);
  const client = embedAppClient({ app: async (path, init = {}) => {
    const result = await active.app(path, init.method, init.body ? JSON.parse(init.body) : undefined, Object.fromEntries(new Headers(init.headers)));
    return Response.json(result.body, { status: result.status, headers: result.headers });
  } });
  const previousWindow = globalThis.window, previousAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const events = new EventTarget(), location = { hash: '#/analyses/author/working' };
  globalThis.window = { location, get localStorage() { throw Error('Embed must not use browser storage'); },
    history: { pushState: (_s, _t, hash) => { location.hash = hash; }, replaceState: (_s, _t, hash) => { location.hash = hash; } },
    addEventListener: (...args) => events.addEventListener(...args), removeEventListener: (...args) => events.removeEventListener(...args),
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let ui;
  t.after(async () => { if (ui) await act(() => ui.unmount()); globalThis.window = previousWindow; globalThis.IS_REACT_ACT_ENVIRONMENT = previousAct; client.clear(); });
  const embedded = { api: client.api, session: await client.session(), embed: { storage: client.storage, loadAnalysis: client.loadAnalysis, authorizeRoute: client.authorizeRoute } };
  await act(() => { ui = create(h(App, { embedded })); });
  const until = async condition => {
    for (let i = 0; i < 100 && !condition(); i++) await act(() => new Promise(resolve => setTimeout(resolve, 20)));
    assert.ok(condition(), JSON.stringify(ui.toJSON()).slice(0, 1800));
  };
  await until(() => ui.root.findAllByType(Author).length === 1);
  const title = () => ui.root.findByProps({ className: 'analysis-title' }).findByType('input');
  assert.equal(title().props.value, 'Original');
  for (const name of ['First edit', 'Second edit']) {
    await act(() => title().props.onChange({ target: { value: name } }));
    await act(() => ui.root.findAllByType('button').find(b => b.props.children === 'Save analysis').props.onClick());
    await until(() => JSON.stringify(ui.toJSON()).includes('Analysis saved to this hosted workspace.'));
    assert.equal((await active.app('/analysis/working')).body.name, name);
    assert.equal(ui.root.findAllByType(Author).length, 1);
  }
  await act(() => ui.root.findByType(AppNavigation).props.navigate({ page: 'data' }));
  await until(() => location.hash === '#/data');
  assert.equal((await f.call(`${active.root}/status`, 'GET', undefined, active.auth)).status, 200);
});
