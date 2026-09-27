// Node >=24 strips the converter's TypeScript; no duplicate converter or API copies.
// Inputs must already be sanitized and remain outside the repository, under /tmp.
import { readFile, writeFile, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { convertDefinition } from '../../web/src/definition-converter.ts';

const input = await realpath(resolve(process.argv[2] ?? '/tmp/opensight-synthetic'));
if (!input.startsWith(`/tmp${sep}`)) throw new Error('Sanitized API inputs must stay under /tmp');
const output = new URL('../test/fixtures/synthetic/', import.meta.url);
const fixtures = [
  ['automotive', 'dashboard'], ['assets-as-code', 'analysis'], ['orders-overview', 'analysis'],
];
function check(value) {
  if (Array.isArray(value)) return value.forEach(check);
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (/^[A-Z]/u.test(key)) throw new Error(`Unmapped source member: ${key}`);
      check(child);
    }
  }
}
async function save(id, type, definition) {
  check(definition);
  const resource = {
    resourceType: type, [`${type}Id`]: id, name: `SYNTHETIC ${id}`,
    definition, validationStrategy: { mode: 'LENIENT' },
  };
  const text = `${JSON.stringify(resource, null, 2)}\n`;
  if ([...text.matchAll(/(?<!\d)\d{12}(?!\d)/gu)].some(m => m[0] !== '123456789012')) throw new Error('Unsanitized account');
  if ([...text.matchAll(/arn:[^"\s\\]+/gu)].some(m => !/^arn:aws:quicksight:us-east-1:123456789012:dataset\/[a-zA-Z0-9-]+$/u.test(m[0]))) throw new Error('Unreviewed ARN');
  if (/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\b(?:[a-zA-Z0-9-]+\.)+(?:com|net|org|io|edu|gov|internal|local)\b/u.test(text)) throw new Error('Unreviewed email/hostname');
  await writeFile(new URL(`${type}/${id}.json`, output), text);
}
for (const [id, type] of fixtures) {
  const raw = JSON.parse(await readFile(`${input}/${id}.sanitized.json`, 'utf8'));
  await save(id, type, convertDefinition(raw.Definition ?? raw));
}

// Explicit author-created additions to the converted orders sample. They are
// kept separate so the three source conversions remain faithful inventories.
const orders = JSON.parse(await readFile(`${input}/orders-overview.sanitized.json`, 'utf8'));
const extended = convertDefinition(orders.Definition);
extended.parameterDeclarations = [
  { stringParameterDeclaration: { name: 'Region', parameterValueType: 'MULTI_VALUED', defaultValues: { staticValues: ['East', 'West'] } } },
  { dateTimeParameterDeclaration: { name: 'AsOf', timeGranularity: 'DAY', defaultValues: { staticValues: ['2025-01-01T00:00:00Z'] } } },
  { integerParameterDeclaration: { name: 'Periods', parameterValueType: 'SINGLE_VALUED', defaultValues: { staticValues: [12] } } },
  { decimalParameterDeclaration: { name: 'MinimumRevenue', parameterValueType: 'SINGLE_VALUED', defaultValues: { staticValues: [100.5] } } },
];
const column = columnName => ({ dataSetIdentifier: 'orders', columnName });
extended.filterGroups = [{
  filterGroupId: 'synthetic-features', crossDataset: 'SINGLE_DATASET', status: 'ENABLED',
  scopeConfiguration: { selectedSheets: { sheetVisualScopingConfigurations: [{
    sheetId: extended.sheets[0].sheetId, scope: 'SELECTED_VISUALS',
    visualIds: extended.sheets[0].visuals.map(v => Object.values(v)[0].visualId),
  }] } },
  filters: [
    { categoryFilter: { filterId: 'region', column: column('REGION'), configuration: {
      customFilterConfiguration: { matchOperator: 'EQUALS', nullOption: 'NON_NULLS_ONLY', parameterName: 'Region' },
    } } },
    { numericRangeFilter: { filterId: 'revenue', column: column('NET_REVENUE'), nullOption: 'NON_NULLS_ONLY',
      rangeMinimum: { parameter: 'MinimumRevenue' }, rangeMaximum: { staticValue: 100000 }, includeMinimum: true, includeMaximum: false,
    } },
    { relativeDatesFilter: { filterId: 'recent', column: column('FULL_DATE'), nullOption: 'NON_NULLS_ONLY',
      timeGranularity: 'MONTH', relativeDateType: 'LAST', parameterName: 'Periods',
      anchorDateConfiguration: { anchorOption: 'PARAMETER', parameterName: 'AsOf' },
      excludePeriodConfiguration: { amount: 1, granularity: 'DAY', status: 'ENABLED' },
    } },
  ],
}];
extended.calculatedFields.push({ dataSetIdentifier: 'orders', name: 'Adjusted Margin',
  expression: 'ifelse({Profit Margin} > 0, {NET_REVENUE} - ${MinimumRevenue}, 0)',
});
await save('feature-variants', 'analysis', extended);
