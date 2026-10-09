import { useMemo, useState } from 'react';
import { useAccess } from './access.js';
import { AppLink, type Navigate } from './AppNavigation.js';
import { LocalDrafts } from './LocalDrafts.js';
import { EmptyPageState } from './LocalEmptyState.js';
import { CollectionPage } from './CollectionPage.js';
import { browserDraftStorage, createDraftStore, draftStorageError, draftStorageKey } from './local-drafts.js';

export function Analyses({ navigate }: { navigate: Navigate }) {
  const access = useAccess(), key = draftStorageKey(access);
  const store = useMemo(() => createDraftStore(browserDraftStorage, access), [key]);
  const read = () => {
    try { return { entries: store.list(), message: '' }; }
    catch (error) { return { entries: [], message: draftStorageError(error) }; }
  };
  const [state, setState] = useState(read);
  const change = (action: () => void) => {
    try { action(); setState(read()); }
    catch (error) { setState(previous => ({ ...previous, message: draftStorageError(error) })); }
  };
  const empty = !state.entries.length && !state.message;
  const createAnalysis = <AppLink className="primary-button" to={{ page: 'author', newAnalysis: true }} navigate={navigate}>New analysis</AppLink>;
  return <div className="analyses-home"><CollectionPage title="My analyses" introduction="Create interactive analyses" description="Explore your data with charts and tables. Save drafts on this device and export definitions to share your work." actions={!empty && createAnalysis}>
    {empty && <EmptyPageState guidance="Create your first analysis and find it here.">{createAnalysis}<button type="button" className="empty-state-secondary" onClick={() => setState(read())}>Refresh drafts</button></EmptyPageState>}
    {state.message && <p role="alert">{state.message}</p>}
    {!empty && <LocalDrafts expanded entries={state.entries} onRefresh={() => setState(read())} onOpen={draftId => navigate({ page: 'author', draftId })} onRename={(id, name) => change(() => { store.rename(id, name); })} onDelete={id => change(() => store.delete(id))} />}
  </CollectionPage></div>;
}
