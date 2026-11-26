import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, stat, symlink, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractQuickSight, writeExtraction, readPrevious, assetExportFallback } from '../dist/index.js';
import { awsReader } from '../dist/aws.js';
import { runCli } from '../dist/cli.js';
import { parseBundleJson, serializeImportReport, parseExtractionManifest } from '@opensight/bundle-parser';
const options = { accountId: '000000000000', region: 'us-east-1', generatedAt: '2026-11-25T00:00:00.000Z' };
const analysis = JSON.parse(await readFile(new URL('fixtures/describe-analysis.json', import.meta.url), 'utf8'));
const dataset = JSON.parse(await readFile(new URL('fixtures/describe-dataset.json', import.meta.url), 'utf8'));
const source = { DataSource: { DataSourceId: 'example-source', Name: 'Synthetic source', Type: 'POSTGRESQL', DataSourceParameters: { PostgreSqlParameters: { Host: 'example.invalid', Port: 5432, Database: 'example' } } } };
const response = { analysis, dataset, datasource: source, dashboard: { ...analysis, AnalysisId: undefined, DashboardId: 'example-dashboard' } };
function mock(change = {}) {
  const calls = [];
  return { calls, async list(kind, token) {
    calls.push(['list', kind, token]);
    if (kind === 'analysis') return token ? { AnalysisSummaryList: [] } : { AnalysisSummaryList: [{ AnalysisId: 'example-analysis' }], NextToken: 'page-two' };
    if (kind === 'dashboard') return { DashboardSummaryList: [{ DashboardId: 'example-dashboard' }] };
    return { DataSetSummaries: [{ DataSetId: 'example-dataset' }] };
  }, async describe(kind, id) {
    calls.push(['describe', kind, id]);
    if (change[kind] instanceof Error) throw change[kind];
    return structuredClone(change[kind] ?? response[kind]);
  } };
}
async function temp(t) { const path = await mkdtemp(join(tmpdir(), 'opensight-extract-test-')); t.after(() => rm(path, { recursive: true, force: true })); return path; }
test('paginates inventory, assembles importer-compatible definitions and retains dictionary keys and security rules', async () => {
  const client = mock(), result = await extractQuickSight(client, options);
  assert.equal(client.calls.filter(c => c[0] === 'list').length, 4);
  assert.equal(client.calls.filter(c => c[0] === 'describe').length, 4);
  assert.deepEqual(parseBundleJson(Buffer.from(JSON.stringify(result.bundle))), result.bundle);
  assert.equal(result.manifest.assets.length, 4);
  assert.ok(result.manifest.assets.every(a => a.state === 'extracted' && a.digest.length === 64));
  const ds = result.bundle.members.find(m => m.resource.resourceType === 'dataset').resource;
  assert.ok(ds.physicalTableMap.CaseSensitive_Table_ID.relationalTable);
  assert.deepEqual(ds.rowLevelPermissionDataSet, dataset.DataSet.RowLevelPermissionDataSet);
  assert.deepEqual(ds.logicalTableMap.CaseSensitive_Logical_ID.source, { physicalTableId: 'CaseSensitive_Table_ID' });
  assert.doesNotMatch(JSON.stringify(result.manifest), /arn:|000000000000|Synthetic|example-analysis|category|example.invalid/);
  assert.ok(result.manifest.knownLimits.some(l => l.code === 'SPICE_REINGEST_REQUIRED'));
});
test('selections include dependencies; missing selections fail rather than silently omitting', async () => {
  const result = await extractQuickSight(mock(), { ...options, selection: [{ kind: 'analysis', id: 'example-analysis' }] });
  assert.deepEqual(result.bundle.members.map(m => m.resource.resourceType), ['analysis', 'dataset', 'datasource']);
  await assert.rejects(extractQuickSight(mock(), { ...options, selection: [{ kind: 'analysis', id: 'absent' }] }), /EXTRACTION_SELECTION_NOT_FOUND/);
});
test('repeat extraction diffs canonical content, ignores key order, and accepts previous import snapshot', async () => {
  const first = await extractQuickSight(mock(), options);
  const same = await extractQuickSight(mock(), { ...options, previous: serializeImportReport([], { manifest: first.manifest }) });
  assert.equal(same.manifest.diff.unchanged.length, 4);
  const changed = structuredClone(analysis); changed.Name = 'Changed title';
  const second = await extractQuickSight(mock({ analysis: changed }), { ...options, previous: first.manifest });
  assert.equal(second.manifest.diff.changed.length, 1); assert.equal(second.manifest.diff.unchanged.length, 3);
  const reordered = Object.fromEntries(Object.entries(analysis).reverse());
  assert.equal((await extractQuickSight(mock({ analysis: reordered }), { ...options, previous: first.manifest })).manifest.diff.unchanged.length, 4);
  const selected = await extractQuickSight(mock(), { ...options, previous: first.manifest, selection: [{ kind: 'dataset', id: 'example-dataset' }] });
  assert.equal(selected.manifest.diff.removed.length, 2);
});
test('Describe errors are named, content-free failures; recovery is a change', async () => {
  const failed = await extractQuickSight(mock({ analysis: new Error('private-aws-error') }), options);
  assert.equal(failed.manifest.assets.filter(a => a.code === 'DESCRIBE_FAILED').length, 1);
  assert.doesNotMatch(JSON.stringify(failed), /private-aws-error/);
  const next = await extractQuickSight(mock(), { ...options, previous: failed.manifest });
  assert.equal(next.manifest.diff.changed.length, 1);
  assert.deepEqual(assetExportFallback, { available: false, code: 'ASSET_EXPORT_FALLBACK_MANUAL', requires: ['customer S3', 'customer-run asset export'], executesAwsCalls: false });
});
test('credentials, URI secrets, foreign dependencies and malformed Describe definitions fail closed', async () => {
  for (const change of [
    r => { r.Credentials = { SecretAccessKey: 'private-secret' }; },
    r => { r.Definition.SecretAccessKey = 'private-secret'; },
    r => { r.Definition.Options = { endpoint: 'https://user:password@example.invalid' }; },
    r => { r.Definition.DataSetIdentifierDeclarations[0].DataSetArn = 'arn:aws:quicksight:us-west-2:111111111111:dataset/foreign'; },
    r => { r.Definition.Sheets = 'invalid'; },
    r => { r.Errors = [{ Message: 'private error' }]; },
  ]) {
    const raw = structuredClone(analysis); change(raw);
    const client = mock({ analysis: raw }), result = await extractQuickSight(client, options);
    assert.equal(result.manifest.assets.filter(a => a.state === 'failed-closed').length, 1);
    assert.ok(result.bundle.members.every(m => m.resource.resourceType !== 'analysis'));
    assert.ok(!client.calls.some(c => c[2] === 'foreign'));
    assert.doesNotMatch(JSON.stringify(result), /private-secret|user:password|private error/);
  }
});
test('list failures, duplicate IDs and repeated page tokens abort the inventory', async () => {
  await assert.rejects(extractQuickSight({ ...mock(), list() { throw new Error('private list error'); } }, options), /EXTRACTION_LIST_FAILED/);
  await assert.rejects(extractQuickSight({ ...mock(), async list() { return { AnalysisSummaryList: [], NextToken: 'same' }; } }, options), /EXTRACTION_PAGINATION_INVALID/);
  await assert.rejects(extractQuickSight({ ...mock(), async list() { return { AnalysisSummaryList: [{ AnalysisId: 'same' }, { AnalysisId: 'same' }] }; } }, options), /EXTRACTION_DUPLICATE_ASSET/);
  await assert.rejects(extractQuickSight({ ...mock(), async list() { return { AnalysisSummaryList: [{ AnalysisId: '../escape' }] }; } }, options), /EXTRACTION_ID_INVALID/);
});
test('local files are private, parseable, credential-free and never overwritten or followed through symlinks', async t => {
  const root = await temp(t), out = join(root, 'first'), result = await extractQuickSight(mock(), options);
  await writeExtraction(out, result);
  assert.deepEqual((await readdir(out)).sort(), ['bundle.json', 'manifest.json']);
  assert.equal((await stat(out)).mode & 0o777, 0o700);
  assert.equal((await stat(join(out, 'bundle.json'))).mode & 0o777, 0o600);
  assert.deepEqual(await readPrevious(join(out, 'manifest.json')), result.manifest);
  await assert.rejects(writeExtraction(out, result), /LOCAL_OUTPUT_EXISTS/);
  await symlink(root, join(root, 'link'));
  await assert.rejects(writeExtraction(join(root, 'link', 'second'), result), /LOCAL_SYMLINK_REFUSED/);
  await assert.rejects(writeExtraction('https://example.invalid/output', result), /LOCAL_PATH_REQUIRED/);
  const malicious = structuredClone(result); malicious.bundle.members[0].resource.password = 'private-secret';
  await assert.rejects(writeExtraction(join(root, 'unsafe'), malicious), /CREDENTIAL_MATERIAL_REFUSED/);
  const bad = join(root, 'bad.json'); await writeFile(bad, JSON.stringify({ ...result.manifest, credentials: 'private-secret' }));
  await assert.rejects(readPrevious(bad), /MIGRATION_MANIFEST_INVALID/);
});
test('CLI refuses credential flags before client creation; environment credentials are never persisted', async t => {
  const root = await temp(t), output = [], errors = [], io = { out: s => output.push(s), error: s => errors.push(s) };
  let calls = 0;
  const factory = async (account, region) => { calls++; assert.equal(account, options.accountId); assert.equal(region, options.region); return mock(); };
  const env = { AWS_ACCOUNT_ID: options.accountId, AWS_REGION: options.region, AWS_SECRET_ACCESS_KEY: 'test-environment-secret', AWS_SESSION_TOKEN: 'test-session-token' };
  assert.equal(await runCli(['--out', join(root, 'out'), '--access-key', 'test-cli-secret'], env, io, factory), 1);
  assert.equal(calls, 0);
  assert.equal(await runCli(['--out', 's3://bucket'], env, io, factory), 1); assert.equal(calls, 0);
  assert.equal(await runCli(['--out', join(root, 'out')], env, io, factory), 0);
  assert.equal(calls, 1);
  for (const name of ['bundle.json', 'manifest.json']) assert.doesNotMatch(await readFile(join(root, 'out', name), 'utf8'), /test-environment-secret|test-session-token|test-cli-secret/);
  assert.doesNotMatch(output.join('') + errors.join(''), /test-environment-secret|test-session-token|test-cli-secret/);
  assert.equal(await runCli(['--out', join(root, 'failed')], env, io, async () => mock({ analysis: new Error('private') })), 2);
  assert.equal(await runCli(['--out', join(root, 'fatal')], env, io, async () => { throw new Error('private-provider-error'); }), 1);
  assert.doesNotMatch(errors.join(''), /private-provider-error/);
});
test('SDK adapter sends only the seven policy-authorized List/Describe commands', async () => {
  const calls = [], reader = awsReader(options.accountId, options.region, { async send(command) { calls.push(command); return {}; } });
  for (const kind of ['analysis', 'dashboard', 'dataset']) await reader.list(kind, 'page');
  for (const kind of ['analysis', 'dashboard', 'dataset', 'datasource']) await reader.describe(kind, 'example');
  reader.close();
  const policy = JSON.parse(await readFile(new URL('../policy/read-only.json', import.meta.url), 'utf8'));
  const actions = policy.Statement.flatMap(s => s.Action).sort();
  assert.deepEqual(calls.map(c => `quicksight:${c.constructor.name.replace(/Command$/, '')}`).sort(), actions);
  assert.ok(actions.every(a => /^quicksight:(List|Describe)/.test(a)));
  assert.ok(calls.every(c => c.input.AwsAccountId === options.accountId && !('Credentials' in c.input)));
  assert.equal(calls[0].input.NextToken, 'page');
});
test('JSON bundle envelope validates member paths, duplicates and extra envelope keys', () => {
  const member = { path: 'analysis/a.json', resource: { resourceType: 'analysis', analysisId: 'a', name: 'a', definition: { dataSetIdentifierDeclarations: [] } } };
  const parse = raw => parseBundleJson(Buffer.from(JSON.stringify(raw)));
  assert.equal(parse({ members: [member] }).members.length, 1);
  for (const raw of [{ members: [] }, { members: [member, member] }, { members: [{ ...member, path: '../a.json' }] }, { members: [member], credentials: 'x' }]) assert.throws(() => parse(raw));
});
test('help and shipped policy never create a client; input/versions fail before SDK calls', async t => {
  const root = await temp(t), out = [], io = { out: s => out.push(s), error() {} };
  const never = async () => { assert.fail('must not create an AWS client'); };
  assert.equal(await runCli(['--help'], {}, io, never), 0);
  assert.match(out[0], /AWS_PROFILE\/SSO/);
  assert.equal(await runCli(['--policy'], {}, io, never), 0);
  assert.equal(JSON.parse(out[1]).Statement.length, 2);
  for (const args of [[], ['--out', join(root, 'no-config')], ['--namespace', 'default'], ['--out', 'one', '--out', 'two']]) assert.equal(await runCli(args, {}, io, never), 1);
  const path = join(root, 'future.json'); await writeFile(path, '{"schemaVersion":2}');
  assert.equal(await runCli(['--out', join(root, 'no-read'), '--previous', path], { AWS_ACCOUNT_ID: options.accountId, AWS_REGION: options.region }, io, never), 1);
  const client = mock(); await assert.rejects(extractQuickSight(client, { ...options, previous: { schemaVersion: 2 } }), /MIGRATION_MANIFEST_INVALID/);
  assert.equal(client.calls.length, 0);
});
test('empty inventory and wholly failed selection write explicit manifests without inventing assets', async t => {
  const root = await temp(t), empty = await extractQuickSight({ async list(kind) { return { [kind === 'analysis' ? 'AnalysisSummaryList' : kind === 'dashboard' ? 'DashboardSummaryList' : 'DataSetSummaries']: [] }; }, async describe() { assert.fail('empty inventory'); } }, options);
  assert.equal(empty.manifest.assets.length, 0);
  await writeExtraction(join(root, 'empty'), empty);
  assert.deepEqual(parseExtractionManifest(await readPrevious(join(root, 'empty', 'manifest.json'))), empty.manifest);
  const failed = await extractQuickSight(mock({ analysis: new Error('synthetic failure') }), { ...options, selection: [{ kind: 'analysis', id: 'example-analysis' }] });
  assert.equal(failed.bundle.members.length, 0); assert.equal(failed.manifest.assets[0].state, 'failed-closed');
  await writeExtraction(join(root, 'failed'), failed);
});
