import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dashboardRoot } from './automation-helpers.mjs';
import { organizationApi } from './organization-helpers.mjs';

// #180: probe the SAME name in both worlds so even the echoed name and path
// must match byte-for-byte, without normalizing any response fields.
export async function columnProbeApis(t, name, options = {}, role = 'reader_ai') {
  const dataRoot = await dashboardRoot(t);
  const schemaPath = join(dataRoot, 'describe-data-set.response.json');
  const schema = JSON.parse(await readFile(schemaPath, 'utf8'));
  const table = schema.DataSet.PhysicalTableMap.sales.RelationalTable;
  assert.ok(table.InputColumns.some(c => c.Name === name));
  table.InputColumns = table.InputColumns.filter(c => c.Name !== name);
  schema.DataSet.OutputColumns = schema.DataSet.OutputColumns.filter(c => c.Name !== name);
  await writeFile(schemaPath, JSON.stringify(schema));
  const csvPath = join(dataRoot, 'sales.csv');
  const lines = (await readFile(csvPath, 'utf8')).trimEnd().split('\n');
  const index = lines[0].split(',').indexOf(name);
  assert.ok(index >= 0);
  await writeFile(csvPath, lines.map(line => line.split(',').filter((_, i) => i !== index).join(',')).join('\n') + '\n');
  const { api: denied } = await organizationApi(t, options);
  const { api: missing } = await organizationApi(t, { ...options, dataRoot });
  for (const api of [denied, missing]) assert.equal((await api('/api/users/alice', 'PUT', { name: 'Alice', role })).status, 200);
  assert.equal((await denied('/api/datasets/sales/column-grants/probe', 'PUT', {
    column: name, effect: 'deny', principals: [{ type: 'user', id: 'alice' }],
  })).status, 200);
  return { denied, missing };
}

export function assertSameColumnFailure(denied, missing, name) {
  assert.equal(missing.status, 422);
  assert.equal(missing.body.errorCode, 'UNRESOLVED_BINDING');
  assert.equal(typeof missing.body.path, 'string');
  assert.equal(missing.body.message, `${missing.body.path}: unknown column: ${name}`);
  assert.equal(denied.status, missing.status);
  assert.deepEqual(denied.body, missing.body);
}
