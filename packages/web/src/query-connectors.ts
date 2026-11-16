import { connectors } from '@opensight/query-engine/browser';

export const queryConnector = (id: string) => connectors.find(c => c.id === id && c.implementation === 'query');
