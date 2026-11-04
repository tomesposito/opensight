import { resolveSecurity, type RowPredicate, type SecurityContext } from '@opensight/query-engine';
import { MetadataError } from './metadata-db.js';
import { object, resourceKey } from './metadata-resources.js';
import { boundColumns } from './source-schema.js';
import type { HostedData } from './hosted-data.js';
import type { TenantContext } from './metadata.js';

/** Keep the original principal-scoped policies available for shared digests. */
export async function metricDatasetPolicies(data: HostedData, context: TenantContext, datasetId: string, base: SecurityContext): Promise<SecurityContext[]> {
  const dataset = await data.sources.metadata.get(context, { kind: 'dataset', id: datasetId });
  const policies = (await data.sources.metadata.list(context, 'policy')).filter(p => p.body.datasetId === datasetId);
  const wire = object(dataset.body.definition), d = object(wire.DataSet ?? wire);
  if (policies.length > 1 || (d.RowLevelPermissionDataSet || d.ColumnLevelPermissionRules || object(d.RowLevelPermissionTagConfiguration ?? {}).Status === 'ENABLED') && !policies.length) throw new MetadataError('SOURCE_POLICY_REQUIRED', 403);
  if (!policies[0]) return [base];
  const { datasetId: _id, ...policy } = policies[0].body;
  return [base, { ...base, policy: { ...policy, namespaceId: context.namespaceId, dataSetArn: base.policy.dataSetArn } } as SecurityContext];
}

export function intersectSecurity(base: SecurityContext, resolved: ReturnType<typeof resolveSecurity>[]): SecurityContext {
  const predicates = resolved.map(r => r.rowPredicate).filter((p): p is RowPredicate => !!p);
  return { ...base, policy: { namespaceId: base.namespaceId, dataSetArn: base.policy.dataSetArn, rowLevel: !!predicates.length,
    rowRules: predicates.length ? [{ id: 'digest-intersection', principals: [{ type: 'user', id: base.userId! }], predicate: { all: predicates } }] : [],
    protectedColumns: [...new Set(resolved.flatMap(r => r.deniedColumns))], columnGrants: [] } };
}

/** D-85: dataset policy intersects recipient source policy; never delegate to
 * the author or open an author's source credentials on a reader's behalf. */
export async function admitMetricDataset(data: HostedData, context: TenantContext, datasetId: string) {
    const dataset = await data.sources.metadata.get(context, { kind: 'dataset', id: datasetId });
    if (!Array.isArray(dataset.body.sources) || dataset.body.sources.length !== 1) throw new MetadataError('UNRESOLVED_BINDING', 422);
    const source = resourceKey(object(dataset.body.sources[0]) as unknown as Parameters<typeof resourceKey>[0]);
    if (source.kind !== 'source' || source.ownerId !== context.userId) throw new MetadataError('DATASET_ACCESS_DENIED', 403);
    const policies = (await data.sources.metadata.list(context, 'policy')).filter(p => p.body.datasetId === datasetId);
    const wire = object(dataset.body.definition), d = object(wire.DataSet ?? wire);
    if (policies.length > 1 || (d.RowLevelPermissionDataSet || d.ColumnLevelPermissionRules || object(d.RowLevelPermissionTagConfiguration ?? {}).Status === 'ENABLED') && !policies.length) throw new MetadataError('SOURCE_POLICY_REQUIRED', 403);
    const admittedSource = await data.sources.get(context, source.id);
    const a = await data.admit(context, source.id, 'query', base => {
      if (!policies[0]) return base;
      const { datasetId: _id, ...policy } = policies[0].body;
      const schema = boundColumns(admittedSource.binding.columns);
      const first = resolveSecurity(base, schema, base.policy.dataSetArn);
      const second = resolveSecurity({ ...base, policy: { ...policy, namespaceId: context.namespaceId, dataSetArn: base.policy.dataSetArn } } as SecurityContext, schema, base.policy.dataSetArn);
      const predicates = [first.rowPredicate, second.rowPredicate].filter((p): p is RowPredicate => !!p);
      return { ...base, policy: { namespaceId: context.namespaceId, dataSetArn: base.policy.dataSetArn, rowLevel: !!predicates.length,
        rowRules: predicates.length ? [{ id: 'dashboard-intersection', principals: [{ type: 'user', id: context.userId }], predicate: { all: predicates } }] : [],
        protectedColumns: [...new Set([...first.deniedColumns, ...second.deniedColumns])], columnGrants: [] } };
    });
    return a;
}
