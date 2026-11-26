#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractQuickSight, writeExtraction, readPrevious, type QuickSightReader, type ExtractionOptions } from './index.js';
import { validateOutput } from './files.js';
export const usage = `opensight-extract --out <new-local-directory> [--previous <manifest-or-import-report.json>]
  [--analysis <id>] [--dashboard <id>] [--dataset <id>]
opensight-extract --policy

Set AWS_ACCOUNT_ID and AWS_REGION in your environment. Authentication uses the
standard AWS SDK credential chain (AWS_PROFILE/SSO or temporary environment
credentials). Never pass credentials as CLI arguments. No credentials are saved.
Without selections, inventories all analyses, dashboards and datasets in this
account/region. Dependencies are included. Namespaces are not an API list filter.
Output: bundle.json and manifest.json. Existing output directories are refused.
Exit 0: extracted; 2: one or more assets failed closed; 1: extraction failed.
`;
type ReaderFactory = (accountId: string, region: string) => Promise<QuickSightReader & { close?(): void }>;
export async function runCli(args: string[], env: NodeJS.ProcessEnv,
  io: { out(text: string): void; error(text: string): void } = { out: s => process.stdout.write(s), error: s => process.stderr.write(s) },
  factory: ReaderFactory = async (account, region) => (await import('./aws.js')).awsReader(account, region)): Promise<number> {
  let reader: (QuickSightReader & { close?(): void }) | undefined;
  try {
    if (args.length === 1 && ['--help', '-h'].includes(args[0]!)) { io.out(usage); return 0; }
    if (args.length === 1 && args[0] === '--policy') { io.out(await readFile(new URL('../policy/read-only.json', import.meta.url), 'utf8')); return 0; }
    const values = new Map<string, string>(), selection: NonNullable<ExtractionOptions['selection']> = [];
    for (let i = 0; i < args.length; i += 2) {
      const flag = args[i], value = args[i + 1];
      if (!flag || !['--out', '--previous', '--analysis', '--dashboard', '--dataset'].includes(flag) || !value || value.startsWith('--')) throw new Error('EXTRACTOR_ARGUMENT_INVALID');
      if (['--analysis', '--dashboard', '--dataset'].includes(flag)) {
        if (!/^[A-Za-z0-9_-]{1,512}$/.test(value)) throw new Error('EXTRACTOR_ARGUMENT_INVALID');
        selection.push({ kind: flag.slice(2) as 'analysis' | 'dashboard' | 'dataset', id: value });
      } else { if (values.has(flag)) throw new Error('EXTRACTOR_ARGUMENT_INVALID'); values.set(flag, value); }
    }
    const out = values.get('--out'), account = env.AWS_ACCOUNT_ID, region = env.AWS_REGION ?? env.AWS_DEFAULT_REGION;
    if (!out || !account || !/^\d{12}$/.test(account) || !region || !/^[a-z]{2}(?:-[a-z]+)+-\d$/.test(region)) throw new Error('EXTRACTION_CONFIGURATION_INVALID');
    // Validate prior artifacts before credential resolution or any SDK request.
    const prior = values.get('--previous');
    const previous = prior === undefined ? undefined : await readPrevious(prior);
    await validateOutput(out);
    reader = await factory(account, region);
    const result = await extractQuickSight(reader, { accountId: account, region, ...(selection.length ? { selection } : {}), previous });
    await writeExtraction(out, result);
    const failed = result.manifest.assets.filter(a => a.state === 'failed-closed').length;
    io.out(`Wrote bundle.json and manifest.json: ${result.bundle.members.length} extracted, ${failed} failed closed.\n`);
    return failed ? 2 : 0;
  } catch (error) {
    // SDK and filesystem errors can contain account IDs, paths and credentials.
    const code = error instanceof Error && /^(?:EXTRACTION_[A-Z_]+|EXTRACTOR_ARGUMENT_INVALID|LOCAL_[A-Z_]+|MIGRATION_MANIFEST_INVALID|CREDENTIAL_MATERIAL_REFUSED|DEFINITION_INVALID)$/.test(error.message) ? error.message : 'EXTRACTION_FAILED';
    io.error(`${code}. See --help; raw errors and credentials are never printed.\n`);
    return 1;
  } finally { reader?.close?.(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await runCli(process.argv.slice(2), process.env);
