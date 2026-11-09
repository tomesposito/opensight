import { planPreparedQuery, resolveSecurity, type InteractiveQuery, type MetricDataset } from '@opensight/query-engine';
import { MetadataError } from './metadata-db.js';
import type { TenantContext, TenantMetadata } from './metadata.js';
import type { DigestSpec } from './digest-model.js';
import type { Admission, HostedData } from './hosted-data.js';
import type { JobStore } from './job-store.js';
import { member } from './job-schema.js';
import { boundColumns } from './source-schema.js';
import { intersectSecurity, metricDatasetPolicies } from './digest-admission.js';

export async function digestMetricAccess(metadata: TenantMetadata, context: TenantContext, spec: DigestSpec): Promise<MetricDataset> {
  // Targeted read (#231): never the whole-catalog assetTransaction clone.
  return metadata.digestMetricAccess(context, spec.metricId);
}

const revoked = (e: unknown) => e instanceof Error && 'code' in e && [
  'JOB_PRINCIPAL_UNAVAILABLE', 'UNKNOWN_PRINCIPAL', 'METRIC_NOT_FOUND', 'METRIC_DATASET_NOT_FOUND',
  'RESOURCE_NOT_FOUND', 'DIGEST_VIEW_FORBIDDEN', 'COLUMN_ACCESS_DENIED', 'ROW_ACCESS_DENIED',
].includes(String(e.code));

/** Resolve policy principals without opening another user's source credentials.
 * The owner's admission remains an additional constraint on every shared read. */
export async function digestAudience(data: HostedData, jobs: JobStore, owner: TenantContext, spec: DigestSpec,
  ref: MetricDataset, admission: Admission | undefined, measureQuery: InteractiveQuery) {
  const schema = admission && boundColumns(admission.physical.columns);
  const policies = admission ? await metricDatasetPolicies(data, owner, ref.id, { ...admission.security,
    policy: { ...admission.source.policy, namespaceId: owner.namespaceId, dataSetArn: admission.security.policy.dataSetArn } }) : [];
  const resolved = admission ? [resolveSecurity(admission.security, schema!, admission.security.policy.dataSetArn)] : [];
  // Validate bindings independently first: a subsequent missing binding can
  // only be attributed to this recipient's column masking.
  if (admission) planPreparedQuery(admission.physical.columns, measureQuery);
  const recipients: { id: string; email: string }[] = [];
  for (const id of spec.recipients) {
    try {
      const context = await jobs.context(owner, id);
      const recipientRef = await digestMetricAccess(data.sources.metadata, context, spec);
      if (JSON.stringify(recipientRef) !== JSON.stringify(ref)) throw new MetadataError('JOB_AUTHORIZATION_REVISED', 403);
      const security = policies.map(p => resolveSecurity({ ...p, userId: id }, schema!, p.policy.dataSetArn));
      if (admission) {
        const effective = intersectSecurity({ ...admission.security, userId: id }, security);
        // Measure authorization is mandatory. Time/dimension denial narrows the
        // result below instead of silently dropping that restriction.
        try { planPreparedQuery(admission.physical.columns, measureQuery, effective); }
        catch (e) {
          if (e instanceof Error && 'code' in e && e.code === 'UNRESOLVED_BINDING' && effective.policy.protectedColumns?.length) throw new MetadataError('COLUMN_ACCESS_DENIED', 403);
          throw e;
        }
      }
      const current = await jobs.db.transaction(c => member(c, owner, id));
      recipients.push({ id, email: current.email }); resolved.push(...security);
    } catch (e) { if (!revoked(e)) throw e; }
  }
  if (!recipients.length) throw new MetadataError('DIGEST_SHARED_NO_AUTHORIZED_RECIPIENTS', 403);
  if (!admission) return { recipients, admission };
  const security = intersectSecurity(admission.security, resolved);
  const deniedColumns = resolveSecurity(security, schema!, security.policy.dataSetArn).deniedColumns;
  return { recipients, admission: { ...admission, security, deniedColumns } };
}
