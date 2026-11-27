import { useEffect, useState } from 'react';
import App, { type EmbeddedAppProps } from './App.js';
import { startEmbedTransport, type EmbedShell, type SessionState } from './embed-transport.js';
import { embedAppClient } from './embed-app-client.js';

export function EmbeddedApp({ shell, bootstrap }: { shell: EmbedShell; bootstrap: string }) {
  const [state, setState] = useState<SessionState>('loading');
  const [application, setApplication] = useState<EmbeddedAppProps>();
  useEffect(() => {
    let client: ReturnType<typeof embedAppClient> | undefined;
    const transport = startEmbedTransport(shell, bootstrap, state => {
      setState(state);
      if (['expired', 'revoked', 'error', 'saved'].includes(state)) { client?.clear(); setApplication(undefined); }
    }, async transport => {
      client = embedAppClient(transport);
      const session = await client.session();
      window.history.replaceState(null, '', `#${shell.fullApp!.landingRoute}`);
      setApplication({ api: client.api, session, embed: { surface: shell.surface, loadAnalysis: client.loadAnalysis, authorizeRoute: client.authorizeRoute, storage: client.storage } });
      transport.ready();
    });
    return () => { transport.destroy(); client?.clear(); };
  }, [shell, bootstrap]);
  return <>
    {state !== 'ready' && <section role="status"><h1>{state === 'expired' ? 'Session expired' : state === 'revoked' ? 'Access revoked' : state === 'error' ? 'Embedded application unavailable' : 'Checking access…'}</h1></section>}
    {application && <div hidden={state !== 'ready'}><App embedded={application} /></div>}
  </>;
}
