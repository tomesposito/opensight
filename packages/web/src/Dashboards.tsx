import { AppLink, type Navigate } from './AppNavigation.js';
import { CollectionPage } from './CollectionPage.js';
import { EmptyPageState } from './LocalEmptyState.js';

export function Dashboards({ navigate }: { navigate: Navigate }) {
  return <CollectionPage title="Dashboards" introduction="Bring your analysis together" description="Start with an analysis to explore your data. Publishing dashboards needs a hosted API.">
    <EmptyPageState guidance="Build an analysis to get started."><AppLink className="primary-button" to={{ page: 'analyses' }} navigate={navigate}>My analyses</AppLink></EmptyPageState>
    <p className="collection-note">Publishing dashboards needs a hosted API.</p>
  </CollectionPage>;
}
