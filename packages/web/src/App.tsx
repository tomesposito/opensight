import { SignupVerification } from './SignupVerification.js';
import { OperatorTenants } from './OperatorTenants.js';
import { OperatorTenant } from './OperatorTenant.js';
import { OperatorIdeas } from './OperatorIdeas.js';
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
  const [operator, setOperator] = useState(() => window.location.hash);
  useEffect(() => {
    const changed = () => { setInvite(invitationToken(window.location.hash)); setOperator(window.location.hash); };
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  const signupToken = /^#signup=([A-Za-z0-9_-]{43})$/.exec(operator)?.[1];
  if (!offline && signupToken) return <SignupVerification token={signupToken} baseUrl={import.meta.env?.VITE_OPENSIGHT_API_URL} />;
  const operatorTenant = /^#operator-tenant\/([A-Za-z0-9_-]+)$/.exec(operator);
  if (!offline && operator === '#operator-tenants') return <OperatorTenants baseUrl={import.meta.env?.VITE_OPENSIGHT_API_URL} />;
  if (!offline && operatorTenant) return <OperatorTenant key={operatorTenant[1]} tenantId={operatorTenant[1]!} baseUrl={import.meta.env?.VITE_OPENSIGHT_API_URL} />;
  if (!offline && operator === '#operator-ideas') return <OperatorIdeas baseUrl={import.meta.env?.VITE_OPENSIGHT_API_URL} />;
  if (!offline && operator === '#operator-users') return <OperatorUsers baseUrl={import.meta.env?.VITE_OPENSIGHT_API_URL} />;
  const invitation = invite ? { token: invite, onAccepted: () => { window.history.replaceState(null, '', window.location.pathname + window.location.search); setInvite(undefined); } } : undefined;
  return <SessionGate offline={offline} client={api} invitation={invitation}><Application api={api} fixtures={fixtures} /></SessionGate>;
}
