import { useEffect, useRef, useState } from 'react';
import type { BundleDefinition } from '@opensight/bundle-parser';
import { importBundle } from './bundle-authoring.js';
import { useAccess } from './access.js';
import { createDraftStore, draftStorageKey } from './local-drafts.js';
import type { Navigate } from './AppNavigation.js';
import type { AuthorDataset } from './authoring.js';

export interface EmbeddedAnalysisRecord {
  id: string; name: string; version: number; definition: BundleDefinition;
  datasetBindings: Record<string, { kind: 'dataset' | 'prepared-dataset'; id: string }>;
  schemas: Record<string, { columns: AuthorDataset['columns'] }>;
}
export function embeddedAnalysisDraft(record: EmbeddedAnalysisRecord) {
  const resource = { resourceType: 'analysis' as const, analysisId: record.id, name: record.name, definition: record.definition };
  const draft = importBundle({ members: [{ path: `analysis/${record.id}.json`, resource }] });
  const bindings = Object.entries(record.datasetBindings);
  if (bindings.length === 1 && bindings[0]![1].kind === 'prepared-dataset') {
    const [identifier, binding] = bindings[0]!;
    const columns = record.schemas[identifier]?.columns;
    if (!columns) throw new Error('UNRESOLVED_BINDING');
    draft.dataset = { id: binding.id, name: binding.id, columns };
    for (const sheet of draft.sheets) for (const visual of sheet.visuals) {
      if (visual.imported?.dataSets.length === 1 && visual.imported.dataSets[0]!.identifier === identifier) visual.imported.local = true;
    }
  }
  return draft;
}
export function EmbeddedAnalysis({ id, navigate }: { id: string; navigate: Navigate }) {
  const access = useAccess(), navigation = useRef(navigate);
  navigation.current = navigate;
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    const embed = access.embed;
    if (!embed) { setError('HOSTED_API_REQUIRED'); return; }
    void embed.loadAnalysis(id).then(record => {
      if (!active) return;
      const draft = embeddedAnalysisDraft(record), draftId = createDraftStore(embed.storage, access).save(draft);
      embed.storage().setItem(`${draftStorageKey(access)}:hosted:${draftId}`, JSON.stringify({ analysisId: record.id, revision: record.version }));
      navigation.current({ page: 'author', draftId }, true);
    }).catch((error: unknown) => { if (active) setError(error instanceof Error ? error.message : 'EMBED_UNAVAILABLE'); });
    return () => { active = false; };
  }, [id, access.embed]);
  return <p role={error ? 'alert' : 'status'}>{error ?? 'Opening analysis…'}</p>;
}
