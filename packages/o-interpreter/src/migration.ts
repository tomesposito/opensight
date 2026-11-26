import { MIGRATION_LIMITS, parseExtractionManifest, parseImportReport, type ExtractionManifest, type MigrationImportReport, type MigrationOutcome } from '@opensight/bundle-parser/browser';
import { migrationPolicyActions } from './migration-policy.generated.js';
export interface MigrationSetup {
  os: 'posix' | 'powershell';
  auth: 'profile' | 'sso' | 'environment';
  profile?: string;
  region?: string;
  outputDirectory?: string;
  previous?: string;
}
export type MigrationGuidanceInput = { phase: 'before-import'; setup: MigrationSetup; manifest?: ExtractionManifest }
  | { phase: 'after-import'; report: MigrationImportReport };
export interface MigrationProposal {
  kind: string;
  newKind: boolean;
  assets: number[];
  outcomes: MigrationOutcome[];
  count: number;
  proposedFix: string;
  authoringPath: 'data-sources' | 'datasets' | 'analysis';
  requiresConfirmation: true;
}
export interface MigrationGuidance {
  mode: 'deterministic';
  phase: MigrationGuidanceInput['phase'];
  applied: false;
  commands: string[];
  policyExplanation: string;
  policyActions: readonly string[];
  knownLimits: typeof MIGRATION_LIMITS;
  checklist: MigrationProposal[];
  coverage?: MigrationImportReport['assets'];
  inventory?: { extracted: number; failedClosed: number; changed: number; added: number; removed: number };
  cutover: string;
}
const fail = (): never => { throw new Error('O_MIGRATION_INPUT_INVALID'); };
/** Strict setup data, never a shell prompt or arbitrary command from a model. */
export function migrationSetup(raw: unknown): MigrationSetup {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail();
  const s = raw as MigrationSetup;
  if (Object.keys(s).some(k => !['os', 'auth', 'profile', 'region', 'outputDirectory', 'previous'].includes(k))
    || !['posix', 'powershell'].includes(s.os) || !['profile', 'sso', 'environment'].includes(s.auth)
    || s.profile !== undefined && !/^[A-Za-z0-9_-]{1,128}$/.test(s.profile)
    || s.region !== undefined && !/^[a-z]{2}(?:-[a-z]+)+-\d$/.test(s.region)
    || [s.outputDirectory, s.previous].some(p => p !== undefined && (typeof p !== 'string' || !/^(?:\.\/)?[A-Za-z0-9_./-]{1,200}$/.test(p) || p.startsWith('-') || p.includes('..')))
    || s.auth === 'environment' && s.profile !== undefined) fail();
  return structuredClone(s);
}
/** Ask O's deterministic interpreter: pure data -> proposals. No authoring callback,
 * credentials, execution tool or charge/provider path is available to this function. */
export function interpretMigration(input: MigrationGuidanceInput): MigrationGuidance {
  const guidance: MigrationGuidance = { mode: 'deterministic', phase: input.phase, applied: false, commands: [], checklist: [],
    policyActions: migrationPolicyActions, policyExplanation: `The shipped IAM policy grants ${migrationPolicyActions.filter(a => a.includes(':List')).length} List and ${migrationPolicyActions.filter(a => a.includes(':Describe')).length} Describe actions only. List operations inventory the account/region; Describe operations are scoped to the principal's account. It grants no writes, exports, S3 access or access to source passwords. Authentication stays in your local AWS credential chain.`,
    knownLimits: MIGRATION_LIMITS, cutover: 'Migrate one analysis, compare its numbers side by side with QuickSight, move its readers after review, then repeat. Conversion coverage does not measure numerical or visual parity.' };
  if (input.phase === 'before-import') {
    const s = migrationSetup(input.setup), profile = s.profile ?? 'migration-readonly';
    const env = (name: string, value: string) => s.os === 'powershell' ? `$env:${name} = '${value}'` : `export ${name}='${value}'`;
    guidance.commands = [env('AWS_ACCOUNT_ID', '<your-12-digit-account-id>'), env('AWS_REGION', s.region ?? 'us-east-1'),
      ...(s.auth === 'environment' ? [] : [env('AWS_PROFILE', profile)]),
      ...(s.auth === 'sso' ? [`aws sso login --profile '${profile}'`] : []), 'npm run build --workspace @opensight/migration-extractor', 'node packages/migration-extractor/dist/cli.js --policy',
      `node packages/migration-extractor/dist/cli.js --out '${s.outputDirectory ?? './migration-001'}'${s.previous ? ` --previous '${s.previous}'` : ''}`];
    if (input.manifest) {
      const m = parseExtractionManifest(input.manifest);
      guidance.inventory = { extracted: m.assets.filter(a => a.state === 'extracted').length, failedClosed: m.assets.filter(a => a.state === 'failed-closed').length,
        changed: m.diff.changed.length, added: m.diff.added.length, removed: m.diff.removed.length };
    }
    return guidance;
  }
  if (input.phase !== 'after-import') fail();
  const report = parseImportReport(input.report);
  guidance.coverage = report.assets;
  guidance.checklist = report.groups.flatMap(group => {
    const findings = report.assets.flatMap(a => a.findings.filter(f => f.kind === group.kind && f.outcome !== 'clean').map(f => ({ asset: a.asset, finding: f })));
    if (!findings.length) return [];
    const outcomes = [...new Set(findings.map(f => f.finding.outcome))];
    const remap = findings.some(f => f.finding.code === 'REMAP_REQUIRED');
    const deliberate = outcomes.every(o => o === 'converted-differently');
    const narrative = /customNarrative|insightVisual|computations/.test(group.kind);
    return [{ kind: group.kind, newKind: group.newKind, count: findings.length, assets: [...new Set(findings.map(f => f.asset))], outcomes,
      proposedFix: remap ? 'Re-create the connection locally in Data sources, prepare and re-ingest the dataset, then review each analysis binding. Confirm the remap through normal authoring before saving.'
        : deliberate ? 'Review this deliberate conversion difference against QuickSight. Keep it only after confirming the intended behavior in the analysis editor; it is not a conversion failure.'
        : narrative ? 'Review a rewrite using the supported D-96 narrative computations. Preview the replacement, then confirm and save it in the analysis editor; the original remains failed closed.'
        : 'Review a supported replacement for this construct in the analysis editor. Compare its result with QuickSight, then confirm and save each change. Preserve the unsupported original until reviewed.',
      authoringPath: remap ? 'data-sources' as const : 'analysis' as const, requiresConfirmation: true as const }];
  });
  return guidance;
}
