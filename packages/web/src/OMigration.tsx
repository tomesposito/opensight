import { useMemo, useState } from 'react';
import { interpretMigration, type MigrationSetup } from '@opensight/o-interpreter';
import { serializeImportReport } from '@opensight/bundle-parser/browser';
import type { AuthorDraft } from './authoring.js';

/** The existing Ask O interpreter produces advice only. Every change is made and
 * confirmed in the normal source/dataset/analysis authoring surface. */
export function OMigration({ draft }: { draft: AuthorDraft }) {
  const [os, setOs] = useState<MigrationSetup['os']>('posix');
  const [auth, setAuth] = useState<MigrationSetup['auth']>('sso');
  const before = useMemo(() => interpretMigration({ phase: 'before-import', setup: { os, auth } }), [os, auth]);
  const after = useMemo(() => draft.bundle ? interpretMigration({ phase: 'after-import', report: serializeImportReport(draft.bundle.report) }) : undefined, [draft.bundle]);
  return <details className="o-migration"><summary>QuickSight migration guide</summary>
    <p>Standard interpreter · No AI credits. Guidance proposes changes; review and confirm each fix in normal authoring before saving.</p>
    <label>Command shell <select value={os} onChange={e => setOs(e.target.value as MigrationSetup['os'])}><option value="posix">macOS / Linux</option><option value="powershell">Windows PowerShell</option></select></label>{' '}
    <label>AWS sign-in <select value={auth} onChange={e => setAuth(e.target.value as MigrationSetup['auth'])}><option value="sso">SSO profile</option><option value="profile">Existing profile</option><option value="environment">Temporary environment credentials</option></select></label>
    <p>Run these commands from the repository root after npm install. Set your account ID and region locally; replace the example profile and choose a new output directory. Never paste AWS credentials into Ask O.</p>
    <pre aria-label="Extractor commands">{before.commands.join('\n')}</pre>
    <p>{before.policyExplanation}</p>
    <ul>{before.knownLimits.map(limit => <li key={limit.code}>{limit.message}</li>)}</ul>
    {after && <section aria-label="Migration remediation checklist"><h3>Review import findings</h3>
      <p>Coverage counts constructs, not numerical or visual parity. Asset numbers are zero-based positions in the imported bundle.</p>
      <ul>{after.coverage?.map(a => <li key={a.asset}>Asset {a.asset}: {a.coverage.clean.count} clean, {a.coverage.convertedDifferently.count} converted differently, {a.coverage.failedClosed.count} failed closed.</li>)}</ul>
      {after.checklist.length ? <ul>{after.checklist.map(item => <li key={item.kind}><details><summary>{item.newKind ? 'New kind · ' : ''}{item.kind} · {item.count} findings · assets {item.assets.join(', ')}</summary>
        <p>{item.proposedFix}</p><p>Confirmation required in {item.authoringPath === 'data-sources' ? 'Data sources, then dataset and analysis authoring' : 'the analysis editor'}. This proposal has not applied any changes.</p>
      </details></li>)}</ul> : <p>No remediation findings in this report. Validate the numbers against QuickSight before moving readers.</p>}
    </section>}
    <p>{before.cutover}</p>
  </details>;
}
