import { upload } from './source-helpers.mjs';
import assert from 'node:assert/strict';
import { sessionFixture, parentOrigin } from './embed-session-helpers.mjs';
import { readerMember, seedEmbedContent } from './embed-content-helpers.mjs';
import { httpStack } from './embed-http-helpers.mjs';
import { randomBytes } from 'node:crypto';
import { HostedPrep } from '../dist/hosted-prep.js';
import { HostedData } from '../dist/hosted-data.js';

export const request = InitialPath => ({ ExperienceConfiguration: { FullApp: { InitialPath } } });
export async function fixture(t) {
  const f = await sessionFixture(t), reader = await readerMember(f), seeded = await seedEmbedContent(f, reader);
  t.after(() => seeded.budgets.close());
  const { server, call } = await httpStack(t, f);
  const open = async (path = '/data', extra = {}) => {
    const issued = await call('/api/embedding/sessions', 'POST', { ...request(path), ...extra }, `Bearer ${(await f.login()).token}`);
    assert.equal(issued.status, 200, JSON.stringify(issued.body));
    const root = `/api/embed/sessions/${issued.body.sessionId}`;
    const redeemed = await call(`${root}/redeem`, 'POST', { bootstrap: new URL(issued.body.EmbedUrl).hash.slice(11), parentOrigin, channelId: randomBytes(24).toString('base64url') });
    assert.equal(redeemed.status, 200, JSON.stringify(redeemed.body));
    const auth = `Embed ${redeemed.body.credential}`;
    return { root, auth, issued: issued.body, app: (path, method = 'GET', body, headers) => call(`${root}/app${path}`, method, body, auth, headers) };
  };
  return { ...f, ...seeded, reader, server, call, open };
}

export async function prepared(f) {
  const prep = new HostedPrep(new HostedData(f.sources, undefined, f.budgets));
  const source = await f.sources.upload(await f.context(), upload());
  await prep.save(await f.context(), 'prepared', { name: 'Prepared', pipeline: { version: 1, input: source.id, steps: [] }, expectedVersion: 0 });
}
const definition = () => ({ dataSetIdentifierDeclarations: [{ identifier: 'data', dataSetArn: 'opensight:dataset:prepared' }], sheets: [{ sheetId: 'sheet', visuals: [] }] });
export const input = () => ({ analysisId: 'working', name: 'Original', definition: definition(), datasetBindings: { data: { kind: 'prepared-dataset', id: 'prepared' } } });
