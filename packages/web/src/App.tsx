import { useEffect, useState } from 'react';
import { AcceptInvitation } from './UserManagement.js';
import { createApiClient } from './api-client.js';
import { SessionGate } from './SessionGate.js';
import { OperatorUsers } from './OperatorUsers.js';
import { Application } from './Application.js';
import type { Fixture } from './model.js';
import generated from './fixtures.generated.json' with { type: 'json' };

// Generated exclusively from the pinned repository fixtures; never external JSON.
const fixtures = generated as Fixture[];
const api = createApiClient(import.meta.env?.VITE_OPENSIGHT_API_URL);

export default function App() {
  const offline = import.meta.env?.VITE_OPENSIGHT_OFFLINE_DEMO === 'true';
  const [invite, setInvite] = useState(() => /^#invite=([a-f0-9]{64})$/.exec(window.location.hash)?.[1]);
  const [operator, setOperator] = useState(() => window.location.hash === '#operator-users');
  useEffect(() => {
    const changed = () => { setInvite(/^#invite=([a-f0-9]{64})$/.exec(window.location.hash)?.[1]); setOperator(window.location.hash === '#operator-users'); };
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  if (!offline && operator) return <OperatorUsers baseUrl={import.meta.env?.VITE_OPENSIGHT_API_URL} />;
  if (!offline && invite) return <AcceptInvitation token={invite} client={api} onAccepted={() => { window.history.replaceState(null, '', window.location.pathname + window.location.search); setInvite(undefined); }} />;
  return <SessionGate offline={offline} client={api}><Application api={api} fixtures={fixtures} /></SessionGate>;
}
