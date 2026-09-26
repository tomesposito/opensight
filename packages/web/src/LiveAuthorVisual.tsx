import { useEffect, useMemo, useState } from 'react';
import { VisualCard } from './VisualCard.js';
import { buildAuthorVisual } from './author-preview.js';
import { buildAuthorQuery, loadAuthorRows } from './author-query.js';
import type { AuthorRows, QueryClient } from './author-query.js';
import type { AuthorVisual } from './authoring.js';
import type { QueryRequest } from './api-client.js';

export function LiveAuthorVisual({ visual, client }: { visual: AuthorVisual; client: QueryClient }) {
  const request = useMemo(() => buildAuthorQuery(visual), [visual.kind, visual.dimension, visual.measures]);
  const [state, setState] = useState<{ request: QueryRequest; result: AuthorRows }>();
  useEffect(() => {
    if (!request) return;
    const controller = new AbortController();
    void loadAuthorRows(client, request, controller.signal).then(result => {
      if (!controller.signal.aborted) setState({ request, result });
    }).catch(() => { /* Only cancellation rejects loadAuthorRows. */ });
    return () => controller.abort();
  }, [request, client]);
  const current = state?.request === request ? state.result : undefined;
  const preview = useMemo(() => ({ ...buildAuthorVisual(visual), rows: current?.rows ?? null }), [visual, current]);
  // Clear previous results immediately when assignments change, even before the effect runs.
  return <VisualCard visual={preview} loading={!!request && !current} dataMessage={current?.message} />;
}
