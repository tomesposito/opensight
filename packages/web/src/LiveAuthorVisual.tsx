import type { AnalysisTheme } from './themes.js';
import type { VisualInteraction } from './visual-selection.js';
import { executeFixtureQuery } from './fixture-query.js';
import type { AuthorParameter } from './parameters.js';
import { useEffect, useMemo, useState } from 'react';
import { VisualCard, type RowGroupToggle } from './VisualCard.js';
import { buildAuthorVisual } from './author-preview.js';
import { buildAuthorQuery, loadAuthorRows } from './author-query.js';
import type { AuthorRows, QueryClient } from './author-query.js';
import type { AuthorVisual, CalculatedField } from './authoring.js';
import type { QueryRequest } from './api-client.js';
import { clearVisualRows, storeVisualRows } from './visual-export.js';

export const PARAMETER_DEBOUNCE_MS = 250;

export function LiveAuthorVisual({ visual, theme, client, calculations, parameters = [], interaction, interactive = false, onRowGroupToggle }: { theme?: AnalysisTheme; interaction?: VisualInteraction; interactive?: boolean; parameters?: readonly AuthorParameter[]; visual: AuthorVisual; client?: QueryClient; calculations: readonly CalculatedField[]; onRowGroupToggle?: RowGroupToggle }) {
  const queryKey = JSON.stringify(buildAuthorQuery(visual, calculations, parameters, client?.dataset));
  const request: QueryRequest | null = useMemo(() => JSON.parse(queryKey) as QueryRequest | null, [queryKey]);
  const [state, setState] = useState<{ request: QueryRequest; client: QueryClient; result: AuthorRows }>();
  useEffect(() => {
    if (!request || !client) return;
    const controller = new AbortController();
    const run = () => { void loadAuthorRows(client, request, controller.signal).then(result => {
      if (!controller.signal.aborted) setState({ request, client, result });
    }).catch(() => { /* Only cancellation rejects loadAuthorRows. */ }); };
    const timer = (interactive || request.parameterDeclarations?.length) ? setTimeout(run, PARAMETER_DEBOUNCE_MS) : undefined;
    if (timer === undefined) run();
    return () => { clearTimeout(timer); controller.abort(); };
  }, [request, client, interactive]);
  const fixture = useMemo(() => !client && request ? executeFixtureQuery(request) : undefined, [client, request]);
  const current = client ? state?.request === request && state.client === client ? state.result : undefined : fixture;
  const preview = useMemo(() => ({ ...buildAuthorVisual(visual, calculations, client?.dataset), theme, rows: current?.rows ?? null }), [visual, current, calculations, theme, client?.dataset]);
  useEffect(() => { storeVisualRows(visual.id, preview.rows); return () => { clearVisualRows(visual.id); }; }, [visual.id, preview.rows]);
  // Clear previous results immediately when assignments change, even before the effect runs.
  return <VisualCard interaction={interaction} onRowGroupToggle={onRowGroupToggle} visual={preview} loading={!!request && !current} dataMessage={current?.message} />;
}
