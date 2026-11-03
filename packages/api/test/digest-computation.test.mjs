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
