import { parseBundleJson, parseImportReport, assertNoCredentials, type MigrationImportReport, type QsBundle } from '@opensight/bundle-parser';
import { MetadataError } from './metadata-db.js';
import type { AnalysisRecord } from './analysis-model.js';

export interface ImportTarget { asset: number; state: 'staged' | 'imported'; analysisId?: string }
export interface MigrationRecord { bundle: QsBundle; report: MigrationImportReport; targets: ImportTarget[] }
export interface MigrationReply { importId: string; report: MigrationImportReport; targets: ImportTarget[] }
export interface MigrationWrite { id: string; record: MigrationRecord; analyses: AnalysisRecord[] }
export function migrationBundle(raw: unknown): QsBundle {
  try { assertNoCredentials(raw); return parseBundleJson(Buffer.from(JSON.stringify(raw))); }
  catch { throw new MetadataError('MIGRATION_BUNDLE_INVALID', 400); }
}
export function migrationRecord(raw: Record<string, unknown>): MigrationRecord {
  try {
    if (Object.keys(raw).some(k => !['bundle', 'report', 'targets'].includes(k)) || !Array.isArray(raw.targets)) throw new Error();
    const bundle = migrationBundle(raw.bundle), report = parseImportReport(raw.report);
    if (report.assets.length !== bundle.members.length || raw.targets.length !== bundle.members.length) throw new Error();
    const targets = raw.targets.map((value: unknown, asset) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
      const v = value as ImportTarget;
      if (Object.keys(v).some(k => !['asset', 'state', 'analysisId'].includes(k)) || v.asset !== asset
        || !['staged', 'imported'].includes(v.state) || (v.state === 'imported' ? typeof v.analysisId !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/.test(v.analysisId) : v.analysisId !== undefined)) throw new Error();
      return v;
    });
    return { bundle, report, targets };
  } catch { throw new MetadataError('MIGRATION_RECORD_INVALID', 400); }
}
