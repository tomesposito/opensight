import { jobFixture } from './job-helpers.mjs';
import { HostedData } from '../dist/hosted-data.js';
import { HostedPrep } from '../dist/hosted-prep.js';
import { MetricCatalog } from '../dist/metric-model.js';
import { DigestStore } from '../dist/digest-store.js';
import { upload } from './source-helpers.mjs';
export const digestInput = { timeColumn: 'day', dimensions: ['region'] };
export const definition = { name: 'Revenue', expression: '{amount}', defaultAggregation: 'SUM', format: { style: 'number', decimalPlaces: 2 }, description: '', synonyms: [] };
export async function digestFixture(t, executor, mail, clock) {
  const f = await jobFixture(t, executor, mail, clock), data = new HostedData(f.sources, undefined, f.budgets), prep = new HostedPrep(data);
  t.after(() => f.budgets.close());
  const source = await f.sources.upload(await f.login(), { ...upload(), base64: Buffer.from('day,region,amount\n2026-10-19,east,10\n2026-10-20,west,20\n2026-10-26,east,30\n2026-10-27,west,5\n').toString('base64') });
  await prep.save(await f.login(), 'prepared', { name: 'Sales', pipeline: { version: 1, input: source.id, steps: [] }, expectedVersion: 0 });
  const ref = { kind: 'prepared-dataset', id: 'prepared', ownerId: 'admin' };
  await f.metadata.assetTransaction(await f.login(), true, a => { const c = new MetricCatalog(a), schema = c.schema(ref); c.create('revenue', ref, definition, schema); c.publish('revenue', 1, schema); });
  return { ...f, data, prep, ref, source, subscriptions: new DigestStore(f.store, f.executor) };
}
