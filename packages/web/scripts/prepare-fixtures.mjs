import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseQsBundle, parseSyntheticAnalysis } from '@opensight/bundle-parser';

const here = dirname(fileURLToPath(import.meta.url));
const pins = JSON.parse(await readFile(new URL('./fixture-pins.json', import.meta.url), 'utf8'));

// This is a closed fixture preview, not a general bundle execution gate. Pin the
// complete local dependency graph so changed semantics cannot reuse stale rows.
export async function prepareFixtures(root = resolve(here, '../../../fixtures')) {
  const files = new Map();
  for (const [path, hash] of Object.entries(pins)) {
    const bytes = await readFile(resolve(root, path));
    if (createHash('sha256').update(bytes).digest('hex') !== hash) {
      throw new Error(`${path}: fixture changed; review its dependency/security semantics and result oracle before updating fixture-pins.json`);
    }
    files.set(path, bytes);
  }
  const json = path => JSON.parse(files.get(path).toString('utf8'));
  const bundle = await parseQsBundle(files.get('real-bundle-sample/TotalDeathByCountry.sanitized.qs'));
  const dashboards = bundle.members.filter(m => m.resource.resourceType === 'dashboard');
  if (dashboards.length !== 1) throw new Error('Expected exactly one real dashboard');
  const { resource: dashboard, path: memberPath } = dashboards[0];
  const sales = parseSyntheticAnalysis(json('renderable-sales/analysis.json'));
  const results = json('renderable-sales/expected-queries.json');
  const local = json('renderable-sales/local-data.json');
  if (local.security.dataset !== 'unrestricted' || local.security.source !== 'unrestricted') {
    throw new Error('Sales preview requires explicit unrestricted dataset and source declarations');
  }
  const real = {
    id: dashboard.dashboardId,
    apiResource: { kind: 'dashboard', definition: dashboard.definition, source: 'bundle' },
    name: dashboard.name,
    description: 'Sanitized dashboard export · real .qs archive',
    provenance: 'fixtures/real-bundle-sample/TotalDeathByCountry.sanitized.qs',
    notice: 'Definition preview only. This export contains no underlying data; the Athena source and its security policies are unresolved. No query is run.',
    sheets: (dashboard.definition.sheets ?? []).map((sheet, si) => ({
      id: sheet.sheetId, name: sheet.name ?? sheet.sheetId,
      visuals: (sheet.visuals ?? []).map((definition, vi) => ({
        source: 'bundle', definition, rows: null, bindings: {},
        placement: placement(sheet.layouts, Object.values(definition)[0].visualId, 'bundle'),
        path: `${memberPath}.definition.sheets[${si}].visuals[${vi}]`,
      })),
    })),
  };
  const csv = files.get('renderable-sales/sales.csv').toString('utf8').trim().split(/\r?\n/).map(line => line.split(','));
  if (csv[0].join(',') !== 'order_id,order_date,region,category,revenue,profit') throw new Error('Unexpected pinned sales CSV header');
  const rows = csv.slice(1).map(row => Object.fromEntries(csv[0].map((name, i) => [name, row[i] === '' ? null : ['order_id', 'revenue', 'profit'].includes(name) ? Number(row[i]) : row[i]])));
  await writeFile(resolve(here, '../src/sales.generated.json'), JSON.stringify({ rows, metadata: { dataSet: json('renderable-sales/describe-data-set.response.json'), dataSource: json('renderable-sales/describe-data-source.response.json'), localData: local } }));
  const used = new Set();
  const synthetic = {
    id: sales.AnalysisId, name: sales.Name,
    apiResource: { kind: 'analysis', definition: sales.Definition, source: 'api' },
    description: 'Synthetic sales dashboard · precomputed reference results',
    provenance: 'fixtures/renderable-sales/expected-queries.json',
    notice: 'Reference results • region = East • UTC months • discounted revenue = revenue × 0.9. Values are precomputed; filters are fixed.',
    sheets: (sales.Definition.Sheets ?? []).map((sheet, si) => ({
      id: sheet.SheetId, name: sheet.Name ?? sheet.SheetId,
      visuals: (sheet.Visuals ?? []).map((definition, vi) => {
        const id = Object.values(definition)[0].VisualId;
        const matches = results.filter(result => result.visualId === id);
        if (used.has(id) || matches.length !== 1) throw new Error(`${id}: expected one unique result oracle`);
        used.add(id);
        return {
          source: 'api', definition, rows: matches[0].rows,
          bindings: id === 'revenue-trend' ? { order_date: 'month' } : {},
          placement: placement(sheet.Layouts, id, 'api'),
          path: `renderable-sales/analysis.json.Definition.Sheets[${si}].Visuals[${vi}]`,
        };
      }),
    })),
  };
  if (used.size !== results.length) throw new Error('Unbound sales result oracle');
  return [real, synthetic];
}

function placement(layouts, id, source) {
  const elements = source === 'bundle'
    ? layouts?.[0]?.configuration?.gridLayout?.elements
    : layouts?.[0]?.Configuration?.GridLayout?.Elements;
  const element = elements?.find(e => (source === 'bundle' ? e.elementId : e.ElementId) === id);
  if (!element) throw new Error(`${id}: missing grid placement`);
  const result = source === 'bundle'
    ? { column: element.columnIndex ?? 0, columns: element.columnSpan, row: element.rowIndex ?? 0, rows: element.rowSpan }
    : { column: element.ColumnIndex ?? 0, columns: element.ColumnSpan, row: element.RowIndex ?? 0, rows: element.RowSpan };
  if (!Object.values(result).every(Number.isInteger) || result.column < 0 || result.row < 0 || result.columns < 1 || result.rows < 1 || result.rows > 21 || result.column + result.columns > 36) {
    throw new Error(`${id}: invalid grid placement`);
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fixtures = await prepareFixtures();
  await writeFile(resolve(here, '../src/fixtures.generated.json'), `${JSON.stringify(fixtures, null, 2)}\n`);
  console.log(`Prepared ${fixtures.length} pinned fixture dashboards (no queries or source connections).`);
}
