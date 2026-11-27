import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionFixture } from './embed-session-helpers.mjs';
import { readerMember } from './embed-content-helpers.mjs';
import { parseExperience } from '../dist/embed-sessions.js';

export const fullApp = InitialPath => ({ ExperienceConfiguration: { FullApp: { InitialPath } } });
const named = code => error => error.code === code;

test('full-app issuance stores and redeems every allowed landing class', async t => {
  const f = await sessionFixture(t);
  for (const path of ['/dashboards', '/dashboards/dashboard', '/data', '/analyses/author', '/analyses/author/analysis', '/data/preparation', '/ask-o']) {
    const issued = await f.issue(fullApp(path));
    const redeemed = await f.redeem(issued);
    assert.deepEqual(redeemed.experience, { kind: 'full-app', landingRoute: path });
    assert.equal((await f.sessions.verify(issued.sessionId, redeemed.credential)).session.experience.landingRoute, path);
  }
});

test('full-app issuance rejects arbitrary paths, malformed shapes and anonymous grants', async t => {
  for (const path of [undefined, null, {}, '', '/admin/users', '/data?owner=other', '/data#x', '//product.example/data', 'https://product.example/data', '/data/', '/data/../admin/users', '/analyses/author/%61', '/analyses/author/a/b', '/home']) {
    assert.throws(() => parseExperience(fullApp(path).ExperienceConfiguration), named('EMBED_REQUEST_INVALID'));
  }
  assert.throws(() => parseExperience({ FullApp: { InitialPath: '/data', grants: ['*'] } }));
  assert.throws(() => parseExperience({ FullApp: { InitialPath: '/data' }, Dashboard: { InitialDashboardId: 'd' } }));
  const f = await sessionFixture(t);
  await assert.rejects(f.issue(fullApp('/data'), true), named('EMBED_FEATURE_UNSUPPORTED'));
});

test('full-app authoring and dashboard gates apply at issuance and every operation', async t => {
  const f = await sessionFixture(t), reader = await readerMember(f);
  for (const route of ['/analyses/author', '/data/preparation']) {
    await assert.rejects(f.issue({ ...fullApp(route), UserArn: f.arn('user', reader.identity.userId) }), named('EMBED_AUTHOR_REQUIRED'));
  }
  const issued = await f.issue(fullApp('/analyses/author')), redeemed = await f.redeem(issued);
  const current = await f.embedding.get(await f.context());
  await f.embedding.put(await f.context(), { ...current.config, features: { ...current.config.features, authoring: false, registeredDashboards: false } }, current.revision);
  for (const route of ['/analyses/author', '/data/preparation', '/dashboards/d']) await assert.rejects(f.issue(fullApp(route)), named('EMBED_FEATURE_UNSUPPORTED'));
  await assert.rejects(f.sessions.verify(issued.sessionId, redeemed.credential), named('EMBED_SESSION_REVOKED'));
  await f.issue(fullApp('/data'));
});
