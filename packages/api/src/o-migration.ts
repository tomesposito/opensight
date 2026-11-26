import { interpretMigration, migrationSetup } from '@opensight/o-interpreter';
import { parseExtractionManifest } from '@opensight/bundle-parser';
import { MetadataError } from './metadata-db.js';
import { object, identifier } from './metadata-resources.js';
import type { TenantContext, TenantMetadata } from './metadata.js';

/** An alternate input to the existing governed Ask O operation, not another tool.
 * Report IDs resolve on the server; a caller cannot supply another member's report. */
export async function migrationAnswer(raw: unknown, metadata?: TenantMetadata, context?: TenantContext) {
  try {
    const input = object(raw, ['phase', 'setup', 'manifest', 'importId']);
    if (input.phase === 'before-import') {
      if (input.importId !== undefined) throw new MetadataError('O_MIGRATION_INPUT_INVALID', 400);
      return { migration: interpretMigration({ phase: 'before-import', setup: migrationSetup(input.setup),
        ...(input.manifest === undefined ? {} : { manifest: parseExtractionManifest(input.manifest) }) }) };
    }
    if (input.phase !== 'after-import' || input.setup !== undefined || input.manifest !== undefined) throw new MetadataError('O_MIGRATION_INPUT_INVALID', 400);
    if (!metadata || !context) throw new MetadataError('HOSTED_API_REQUIRED', 503);
    const report = await metadata.importReport(context, identifier(input.importId));
    return { migration: interpretMigration({ phase: 'after-import', report }) };
  } catch (error) {
    if (error instanceof MetadataError) throw error;
    throw new MetadataError('O_MIGRATION_INPUT_INVALID', 400);
  }
}
