import test from 'node:test';
import assert from 'node:assert/strict';
import { DigestComputation, digestPeriods, digestDrivers, digestMessage, digestQuery } from '../dist/digest-computation.js';
import { newDigest } from '../dist/digest-model.js';
import { digestFixture, digestInput, definition } from './digest-helpers.mjs';
import { MetricCatalog } from '../dist/metric-model.js';
const monday = new Date('2026-11-02T09:00:00Z');

test('digests: completed UTC periods are half-open and daily/week boundaries are deterministic', () => {
  assert.deepEqual(digestPeriods('weekly', monday), { current: { start: '2026-10-26T00:00:00.000Z', end: '2026-11-02T00:00:00.000Z' }, previous: { start: '2026-10-19T00:00:00.000Z', end: '2026-10-26T00:00:00.000Z' } });
  assert.equal(digestPeriods('daily', new Date('2027-01-01T09:00:00Z')).previous.start, '2026-12-30T00:00:00.000Z');
  const query = digestQuery(newDigest('revenue', 'admin', digestInput), { ...definition, id: 'revenue', version: 2 }, digestPeriods('weekly', monday).current);
  assert.deepEqual(query.filters.map(f => f.operator), ['GREATER_THAN_OR_EQUAL_TO', 'LESS_THAN']); assert.equal(query.calculatedFields, undefined);
});

test('digests: named drivers rank both directions with stable ties, missing groups, nulls and non-additive values', () => {
  const now = [{ value: 'east', metric: 30 }, { value: 'new', metric: 15 }, { value: null, metric: 5 }], before = [{ value: 'east', metric: 10 }, { value: 'gone', metric: 15 }, { value: null, metric: 5 }];
  const drivers = digestDrivers('region', now, before, true);
  assert.deepEqual(drivers.map(d => [d.value, d.change]), [['east', 20], ['gone', -15], ['new', 15], [null, 0]]);
  assert.deepEqual(drivers, digestDrivers('region', [...now].reverse(), [...before].reverse(), true));
  assert.equal(digestDrivers('region', now, before, false).find(d => d.value === 'new').change, null);
});

test('digests: real governed prepared query compares periods and decomposes dimension changes', async t => {
  const f = await digestFixture(t), compute = new DigestComputation(f.data), spec = newDigest('revenue', 'admin', digestInput);
  const result = await compute.compute(await f.login(), spec, monday);
  assert.equal(result.current, 35); assert.equal(result.previous, 30); assert.equal(result.change, 5);
  assert.deepEqual(result.drivers.map(d => [d.dimension, d.value, d.current, d.previous, d.change]), [['region', 'east', 30, 10, 20], ['region', 'west', 5, 20, -15]]);
  assert.equal(result.metric.version, 2);
  await f.metadata.assetTransaction(await f.login(), true, a => { const c = new MetricCatalog(a); c.edit('revenue', 2, { ...definition, expression: '{amount} * 2' }, c.schema(f.ref)); c.publish('revenue', 3, c.schema(f.ref)); });
  const updated = await compute.compute(await f.login(), spec, monday); assert.equal(updated.current, 70); assert.equal(updated.metric.version, 4);
});

test('digests: no change still renders, zeros have no percent baseline and values/links are escaped', async t => {
  const f = await digestFixture(t), compute = new DigestComputation(f.data), spec = newDigest('revenue', 'admin', { ...digestInput, cadence: 'daily' });
  const result = await compute.compute(await f.login(), spec, new Date('2026-10-29T09:00:00Z'));
  assert.equal(result.current, null); assert.equal(result.previous, 5); assert.equal(result.change, null);
  const noChange = { ...result, current: 0, previous: 0, change: 0, percentChange: null, drivers: [{ dimension: '<region>', value: '<script>', current: 0, previous: 0, change: 0 }] };
  const message = digestMessage(noChange, 'https://example.test/#/data/metrics/revenue', 'https://example.test/unsubscribe');
  assert.match(message.subject, /No change/); assert.match(message.html, /<h1>No change<\/h1>/); assert.match(message.html, /Percent change: Unavailable/);
  assert.match(message.html, /&lt;script&gt;/); assert.doesNotMatch(message.html, /<script>/); assert.match(message.html, /Open metric/); assert.match(message.html, /Unsubscribe/);
});

test('digests: unresolved/foreign fields, unpublished and foreign-owned datasets fail before reading data', async t => {
  const f = await digestFixture(t), compute = new DigestComputation(f.data), spec = newDigest('revenue', 'admin', digestInput);
  await assert.rejects(compute.authorize(await f.login(), { ...spec, timeColumn: 'amount' }), { code: 'DIGEST_TIME_COLUMN_INVALID' });
  await assert.rejects(compute.authorize(await f.login(), { ...spec, dimensions: ['missing'] }), { code: 'DIGEST_DIMENSION_INVALID' });
  await assert.rejects(compute.authorize(await f.login('one', 'other'), spec), { code: 'DIGEST_DATASET_ACCESS_DENIED' });
  await assert.rejects(compute.authorize(await f.login('two'), spec), { code: 'METRIC_NOT_FOUND' });
});

test('digests: empty-group identities respect the executed expression, including explicit sums and ratios', async () => {
  const { zeroIdentity } = await import('../dist/digest-computation.js'), { parseExpression } = await import('@opensight/query-engine');
  for (const [expression, expected] of [['sum({amount})', true], ['sum({amount}) * 2', true], ['sum({amount}) - sum({cost})', true], ['count({amount})', true], ['distinct_count({region})', true], ['avg({amount})', false], ['sum({amount}) / count({amount})', false], ['sum({amount}) + 1', false]]) {
    assert.equal(zeroIdentity(parseExpression(expression, '$', { validationOnly: true })), expected, expression);
  }
});

test('digests: real source RLS filters totals/drivers and CLS denies metric, date and grouping bypasses', async t => {
  const { upload } = await import('./source-helpers.mjs');
  const f = await digestFixture(t), compute = new DigestComputation(f.data);
  const policy = { rowLevel: true, rowRules: [{ id: 'east-only', principals: [{ type: 'user', id: 'admin' }], predicate: { column: 'region', operator: 'eq', value: 'east' } }] };
  const source = await f.sources.upload(await f.login(), { ...upload(policy), base64: Buffer.from('day,region,amount\n2026-10-19,east,10\n2026-10-26,east,30\n2026-10-26,west,999999\n').toString('base64') });
  const ref = { kind: 'dataset', id: 'secured' };
  const bound = await f.sources.get(await f.login(), source.id);
  await f.metadata.put(await f.login(), ref, { definition: { DataSet: { DataSetId: 'secured', OutputColumns: bound.binding.columns.map(c => ({ Name: c.name, Type: c.type })) } }, sources: [{ kind: 'source', id: source.id, ownerId: 'admin' }] });
  await f.metadata.assetTransaction(await f.login(), true, a => { const c = new MetricCatalog(a); c.create('secured', ref, definition, c.schema(ref)); c.publish('secured', 1, c.schema(ref)); });
  const spec = newDigest('secured', 'admin', digestInput), result = await compute.compute(await f.login(), spec, monday);
  assert.equal(result.current, 30); assert.equal(result.previous, 10); assert.deepEqual(result.drivers.map(d => d.value), ['east']);
  const key = { kind: 'source', id: source.id, ownerId: 'admin' }, saved = await f.metadata.get(await f.login(), key);
  for (const column of ['amount', 'day', 'region']) {
    const current = await f.metadata.get(await f.login(), key);
    await f.metadata.put(await f.login(), key, { ...saved.body, policy: { ...saved.body.policy, protectedColumns: [column], columnGrants: [] } }, current.version);
    await assert.rejects(compute.compute(await f.login(), spec, monday), error => ['COLUMN_ACCESS_DENIED', 'UNRESOLVED_BINDING', 'SOURCE_POLICY_REQUIRED'].includes(error.code), column);
  }
});

test('digests: readers with an existing owned source can execute legacy metrics; protected datasets without rules fail closed', async t => {
  const f = await digestFixture(t), compute = new DigestComputation(f.data), ref = { kind: 'dataset', id: 'legacy' };
  const source = await f.sources.get(await f.login(), f.source.id);
  const body = { definition: { DataSet: { DataSetId: 'legacy', OutputColumns: source.binding.columns.map(c => ({ Name: c.name, Type: c.type })) } }, sources: [{ kind: 'source', id: source.id, ownerId: 'admin' }] };
  await f.metadata.put(await f.login(), ref, body);
  await f.metadata.assetTransaction(await f.login(), true, a => { const c = new MetricCatalog(a); c.create('legacy', ref, definition, c.schema(ref)); c.publish('legacy', 1, c.schema(ref)); });
  const spec = newDigest('legacy', 'admin', digestInput);
  await f.metadata.put(await f.login(), { kind: 'user', id: 'admin' }, { name: 'Reader with existing data access', role: 'reader' }, 1);
  const result = await compute.compute(await f.login(), spec, monday); assert.equal(result.current, 35);
  await assert.rejects(compute.authorize(await f.login('one', 'other'), spec), { code: 'DATASET_ACCESS_DENIED' });
  // The administrator changes the dataset guard, then the reader must lose access.
  await f.metadata.put(await f.login('one', 'other'), ref, { ...body, definition: { DataSet: { ...body.definition.DataSet, RowLevelPermissionDataSet: { Arn: 'urn:synthetic:missing-policy' } } } }, 1);
  await assert.rejects(compute.compute(await f.login(), spec, monday), { code: 'SOURCE_POLICY_REQUIRED' });
});

test('digests: governed averages keep per-group values instead of summing averages into a total', async t => {
  const f = await digestFixture(t), compute = new DigestComputation(f.data);
  await f.metadata.assetTransaction(await f.login(), true, a => { const c = new MetricCatalog(a); c.create('average', f.ref, { ...definition, name: 'Average', defaultAggregation: 'AVG' }, c.schema(f.ref)); c.publish('average', 1, c.schema(f.ref)); });
  const result = await compute.compute(await f.login(), newDigest('average', 'admin', digestInput), monday);
  assert.equal(result.current, 17.5); assert.equal(result.previous, 15); assert.equal(result.change, 2.5);
  assert.deepEqual(result.drivers.map(d => d.change), [20, -15]);
  assert.match(digestMessage(result, 'https://example.test', 'https://example.test/unsubscribe').html, /need not add to the overall change/);
});
