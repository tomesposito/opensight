import { randomBytes } from 'node:crypto';
import { totp } from '../dist/auth-crypto.js';
import { decode32 } from './hosted-helpers.mjs';
import { HostedSources } from '../dist/hosted-sources.js';
import { EmbedSources } from '../dist/embed-sources.js';
import { HostedData } from '../dist/hosted-data.js';
import { EmbedContent } from '../dist/embed-content.js';
import { TenantBudgets } from '../dist/budgets.js';
import { budgetConfig } from './budget-helpers.mjs';
import { upload } from './source-helpers.mjs';
export async function readerMember(f) {
  const email = 'reader@example.test', password = randomBytes(24).toString('base64');
  const member = await f.provisioning.inviteMember('reader-invite', f.tenant.tenantId, { email, name: 'Reader', role: 'reader' });
  const invitation = f.mail.messages.at(-1).html.match(/<code>([^<]+)<\/code>/)[1];
  const enrolled = await f.auth.enroll(invitation, password, 'local'), secret = decode32(enrolled.secret);
  const code = () => totp(secret, Math.floor(f.clock() / 30000));
  await f.auth.accept(invitation, password, code(), 'local'); f.advance();
  const login = async () => { const s = await f.auth.login(email, password, code(), f.tenant.tenantId, 'local'); f.advance(); return s; };
  const identity = await f.auth.verify((await login()).token);
  return { ...member, identity, login, context: () => f.metadata.authenticate(null, async () => identity) };
}
export function assetDefinition(kind = 'dashboard', id = kind, column = 'amount') {
  return { [kind === 'dashboard' ? 'DashboardId' : 'AnalysisId']: id, Name: 'Regional totals', Definition: {
    DataSetIdentifierDeclarations: [{ Identifier: 'data', DataSetArn: 'urn:opensight:dataset' }],
    Sheets: [{ SheetId: 'sheet', Name: 'Sheet', Visuals: [{ KPIVisual: { VisualId: 'total', ChartConfiguration: { FieldWells: { Values: [{ NumericalMeasureField: { FieldId: 'amount', Column: { DataSetIdentifier: 'data', ColumnName: column }, AggregationFunction: { SimpleNumericalAggregation: 'SUM' } } }] } } } }] }],
  } };
}
export function interactiveDefinition() {
  const stored = assetDefinition(), d = stored.Definition, column = name => ({ DataSetIdentifier: 'data', ColumnName: name });
  d.ParameterDeclarations = [{ IntegerParameterDeclaration: { Name: 'Minimum', ParameterValueType: 'SINGLE_VALUED', DefaultValues: { StaticValues: [0] } } }];
  d.FilterGroups = [
    { FilterGroupId: 'regions', Status: 'ENABLED', CrossDataset: 'SINGLE_DATASET', ScopeConfiguration: { AllSheets: {} }, Filters: [
      { CategoryFilter: { FilterId: 'region-filter', Column: column('region'), Configuration: { FilterListConfiguration: { MatchOperator: 'EQUALS', NullOption: 'NON_NULLS_ONLY', CategoryValues: ['east', 'west'] } } } },
    ] },
    { FilterGroupId: 'minimum', Status: 'ENABLED', CrossDataset: 'SINGLE_DATASET', ScopeConfiguration: { AllSheets: {} }, Filters: [
      { NumericRangeFilter: { FilterId: 'minimum-filter', Column: column('amount'), NullOption: 'NON_NULLS_ONLY', RangeMinimum: { Parameter: 'Minimum' }, IncludeMinimum: true } },
    ] },
  ];
  d.Sheets[0].FilterControls = [{ TextArea: { FilterControlId: 'region-control', SourceFilterId: 'region-filter', Title: 'Regions' } }];
  d.Sheets[0].ParameterControls = [{ TextField: { ParameterControlId: 'minimum-control', SourceParameterName: 'Minimum', Title: 'Minimum amount' } }];
  return stored;
}
export async function configureInteractions(f, { filtering = true, parameterControls = true, definition = interactiveDefinition() } = {}) {
  const dashboard = await f.metadata.get(await f.context(), { kind: 'dashboard', id: 'dashboard' });
  await f.metadata.put(await f.context(), { kind: 'dashboard', id: 'dashboard' }, { ...dashboard.body, definition }, dashboard.version);
  const current = await f.embedding.get(await f.context());
  await f.embedding.put(await f.context(), { ...current.config, features: { ...current.config.features, filtering, parameterControls } }, current.revision);
}
export async function seedEmbedContent(f, reader) {
  const sources = new HostedSources(f.metadata, f.hostedConfig.encryptionKey.toString('base64'), []);
  const rowRules = [{ id: 'issuer', principals: [{ type: 'user', id: f.identity.userId }], predicate: { column: 'region', operator: 'in', values: ['east', 'west'] } },
    ...(reader ? [{ id: 'viewer', principals: [{ type: 'user', id: reader.identity.userId }], predicate: { column: 'region', operator: 'eq', value: 'east' } }] : [])];
  const source = await sources.upload(await f.context(), upload({ rowLevel: true, rowRules, protectedColumns: ['private'], columnGrants: [{ id: 'issuer-only', column: 'private', effect: 'allow', principals: [{ type: 'user', id: f.identity.userId }] }] }));
  const dataset = { definition: { DataSet: { DataSetId: 'dataset', RowLevelPermissionTagConfiguration: { Status: 'ENABLED', TagRules: [{ TagKey: 'region', ColumnName: 'region' }] } } }, sources: [{ kind: 'source', id: source.id, ownerId: f.identity.userId }] };
  await f.metadata.put(await f.context(), { kind: 'dataset', id: 'dataset' }, dataset);
  await f.metadata.batch(await f.context(), ['dashboard', 'analysis'].map(kind => ({ key: { kind, id: kind }, expectedVersion: 0,
    body: { definition: assetDefinition(kind), datasets: [{ kind: 'dataset', id: 'dataset' }], folderId: null } })));
  const budgets = new TenantBudgets(budgetConfig, c => f.metadata.assertContext(c));
  const embedSources = new EmbedSources(f.metadata, f.hostedConfig.encryptionKey.toString('base64'), []);
  const content = new EmbedContent(new HostedData(embedSources, undefined, budgets));
  return { content, sources, source, dataset, budgets };
}
