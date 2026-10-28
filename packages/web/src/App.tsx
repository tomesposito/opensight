import { useEffect, useState } from 'react';
import { createApiClient } from './api-client.js';
import { SessionGate } from './SessionGate.js';
import { OperatorUsers } from './OperatorUsers.js';
import { Application } from './Application.js';
import type { Fixture } from './model.js';
import generated from './fixtures.generated.json' with { type: 'json' };

// Generated exclusively from the pinned repository fixtures; never external JSON.
const fixtures = generated as Fixture[];
const api = createApiClient(import.meta.env?.VITE_OPENSIGHT_API_URL, globalThis.fetch, { onDemand: import.meta.env?.VITE_OPENSIGHT_SERVERLESS === 'true' });
// Hosted built-in invitations use base64url; legacy namespace invitations use hex.
export const invitationToken = (hash: string): string | undefined => /^#invite=([A-Za-z0-9_-]{43}|[a-f0-9]{64})$/.exec(hash)?.[1];

export default function App() {
  const offline = import.meta.env?.VITE_OPENSIGHT_OFFLINE_DEMO === 'true';
  const [invite, setInvite] = useState(() => invitationToken(window.location.hash));
  const [operator, setOperator] = useState(() => window.location.hash === '#operator-users');
  useEffect(() => {
    const changed = () => { setInvite(invitationToken(window.location.hash)); setOperator(window.location.hash === '#operator-users'); };
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  if (!offline && operator) return <OperatorUsers baseUrl={import.meta.env?.VITE_OPENSIGHT_API_URL} />;
  const invitation = invite ? { token: invite, onAccepted: () => { window.history.replaceState(null, '', window.location.pathname + window.location.search); setInvite(undefined); } } : undefined;
  return <SessionGate offline={offline} client={api} invitation={invitation}><Application api={api} fixtures={fixtures} /></SessionGate>;
}
