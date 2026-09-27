import { executeFixtureQuery } from './fixture-query.js';
import type { AuthorParameter } from './parameters.js';
import { useEffect, useMemo, useState } from 'react';
import { VisualCard } from './VisualCard.js';
import { buildAuthorVisual } from './author-preview.js';
import { buildAuthorQuery, loadAuthorRows } from './author-query.js';
import type { AuthorRows, QueryClient } from './author-query.js';
import type { AuthorVisual, CalculatedField } from './authoring.js';
import type { QueryRequest } from './api-client.js';

export function LiveAuthorVisual({ visual, client, calculations, parameters = [] }: { parameters?: readonly AuthorParameter[]; visual: AuthorVisual; client?: QueryClient; calculations: readonly CalculatedField[] }) {
  const queryKey = JSON.stringify(buildAuthorQuery(visual, calculations, parameters));
  const request: QueryRequest | null = useMemo(() => JSON.parse(queryKey) as QueryRequest | null, [queryKey]);
  const [state, setState] = useState<{ request: QueryRequest; result: AuthorRows }>();
  useEffect(() => {
    if (!request || !client) return;
    const controller = new AbortController();
    void loadAuthorRows(client, request, controller.signal).then(result => {
      if (!controller.signal.aborted) setState({ request, result });
    }).catch(() => { /* Only cancellation rejects loadAuthorRows. */ });
    return () => controller.abort();
  }, [request, client]);
  const fixture = useMemo(() => !client && request ? executeFixtureQuery(request) : undefined, [client, request]);
  const current = client ? state?.request === request ? state.result : undefined : fixture;
  const preview = useMemo(() => ({ ...buildAuthorVisual(visual), rows: current?.rows ?? null }), [visual, current]);
  // Clear previous results immediately when assignments change, even before the effect runs.
  return <VisualCard visual={preview} loading={!!request && !current} dataMessage={current?.message} />;
}
