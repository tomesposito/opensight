import { open } from 'node:fs/promises';
import type { BundleDefinition, BundleResource, BundleResourceType, QsBundle, QsBundleMember } from './bundle-types.js';
import { assertBundleResource } from './bundle-validate.js';
import { summarizeCalculations, summarizeFilterGroup, summarizeParameter,
  type BundleCalculatedFieldSummary, type BundleFilterGroupSummary, type BundleParameterSummary,
} from './bundle-features.js';
import { array, fail, nonempty, object, required, singleVariant } from './validation.js';
import { memberJsonPath, readZipArchive, ZIP_LIMITS } from './zip.js';

function resourceId(resource: BundleResource): string {
  switch (resource.resourceType) {
    case 'analysis': return resource.analysisId;
    case 'dashboard': return resource.dashboardId;
    case 'dataset': return resource.dataSetId;
    case 'datasource': return resource.dataSourceId;
  }
}

function parseMember(path: string, raw: unknown): QsBundleMember {
  const p = memberJsonPath(path);
  const match = /^(analysis|dashboard|dataset|datasource)\/([^/]+)\.json$/u.exec(path);
  if (!match) fail(p, 'unsupported bundle member path; expected analysis/dashboard/dataset/datasource/{id}.json');
  assertBundleResource(raw, p);
  if (raw.resourceType !== match[1]) fail(`${p}.resourceType`, 'does not match member directory');
  if (resourceId(raw) !== match[2]) fail(p, 'resource ID does not match member filename');
  return { path, resource: raw };
}

/** Read a real .qs ZIP; retain camelCase envelopes and unknown JSON verbatim in value. */
export async function parseQsBundle(bytes: Uint8Array): Promise<QsBundle> {
  const members: QsBundleMember[] = [];
  const decoder = new TextDecoder('utf-8', { fatal: true });
  await readZipArchive(bytes, (entry, data) => {
    let raw: unknown;
    try {
      raw = JSON.parse(decoder.decode(data)) as unknown;
    } catch {
      fail(memberJsonPath(entry.path), 'expected valid UTF-8 JSON');
    }
    members.push(parseMember(entry.path, raw));
  });
  if (members.length === 0) fail('$', 'bundle contains no resource members');
  return { members };
}

/** Bounded local file read; no network access or AWS calls. */
export async function loadQsBundle(path: string | URL): Promise<QsBundle> {
  const file = await open(path, 'r');
  try {
    if ((await file.stat()).size > ZIP_LIMITS.archiveBytes) fail('$', 'ZIP exceeds archive byte limit');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of file.createReadStream({ autoClose: false })) {
      const data = chunk as Buffer;
      size += data.length;
      if (size > ZIP_LIMITS.archiveBytes) fail('$', 'ZIP exceeds archive byte limit');
      chunks.push(data);
    }
    return await parseQsBundle(Buffer.concat(chunks, size));
  } finally {
    await file.close();
  }
}

export interface BundleDefinitionSummary {
  dataSets: { identifier: string; arn: string }[];
  sheets: { sheetId: string; name?: string; visualCount: number }[];
  visuals: { kind: string; visualId: string; sheetId: string }[];
  /** Provisional feature inventory; not evidence of bundle execution semantics. */
  calculatedFields: BundleCalculatedFieldSummary[];
  parameters: BundleParameterSummary[];
  filterGroups: BundleFilterGroupSummary[];
  calculatedFieldCount: number;
  parameterCount: number;
  filterGroupCount: number;
  filterCount: number;
}

export interface QsBundleSummary {
  memberCount: number;
  resourceCounts: Record<BundleResourceType, number>;
  members: {
    path: string;
    resourceType: BundleResourceType;
    id: string;
    name: string;
    definition?: BundleDefinitionSummary;
  }[];
}

function summarizeDefinition(definition: BundleDefinition): BundleDefinitionSummary {
  const filterGroups = (definition.filterGroups ?? []).map(summarizeFilterGroup);
  return {
    dataSets: definition.dataSetIdentifierDeclarations.map(d => ({ identifier: d.identifier, arn: d.dataSetArn })),
    sheets: (definition.sheets ?? []).map(s => ({ sheetId: s.sheetId, name: s.name, visualCount: s.visuals?.length ?? 0 })),
    visuals: (definition.sheets ?? []).flatMap(s => (s.visuals ?? []).map(v => {
      const [kind, body] = singleVariant(v, '$');
      // assertBundleResource has validated this property before summarization.
      return { kind, visualId: body.visualId as string, sheetId: s.sheetId };
    })),
    calculatedFields: summarizeCalculations(definition.calculatedFields ?? []),
    parameters: (definition.parameterDeclarations ?? []).map(summarizeParameter),
    filterGroups,
    calculatedFieldCount: definition.calculatedFields?.length ?? 0,
    parameterCount: definition.parameterDeclarations?.length ?? 0,
    filterGroupCount: definition.filterGroups?.length ?? 0,
    filterCount: filterGroups.reduce((count, group) => count + group.filters.length, 0),
  };
}

/** Summary of all four resource kinds; revalidates JavaScript callers. */
export function summarizeQsBundle(bundle: QsBundle): QsBundleSummary {
  const b = object(bundle, '$');
  const members: QsBundleMember[] = [];
  const seen = new Set<string>();
  required(b, 'members', '$', array((value, p) => {
    const member = object(value, p);
    required(member, 'path', p, nonempty);
    const path = member.path as string;
    if (seen.has(path)) fail(p, 'duplicate bundle member path');
    seen.add(path);
    members.push(parseMember(path, member.resource));
  }));
  const resourceCounts = { analysis: 0, dashboard: 0, dataset: 0, datasource: 0 };
  return {
    memberCount: members.length,
    resourceCounts,
    members: members.map(({ path, resource }) => {
      resourceCounts[resource.resourceType]++;
      const member = { path, resourceType: resource.resourceType, id: resourceId(resource), name: resource.name };
      return resource.resourceType === 'analysis' || resource.resourceType === 'dashboard'
        ? { ...member, definition: summarizeDefinition(resource.definition) } : member;
    }),
  };
}
