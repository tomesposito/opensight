import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessProvider, demoAccess, type Session, type Access } from './access.js';
import { ApiError, type createApiClient, type LoginInput, type LoginResult } from './api-client.js';
import { FirstRun, type StartupIssue } from './FirstRun.js';
import { SignIn } from './SignIn.js';
import { authNotice, type AuthNotice } from './auth-errors.js';
import { StartupError } from './workspace-startup.js';

type Client = Pick<ReturnType<typeof createApiClient>, 'getSession'> & Partial<Pick<ReturnType<typeof createApiClient>, 'getLocalData' | 'login' | 'selectWorkspace' | 'logout' | 'clearSession' | 'onDemand' | 'connect' | 'subscribeAvailability'>> & Access['aiClient'];
export const SESSION_TIMEOUT_MS = 10_000;

function startupIssue(error: unknown): StartupIssue {
  if (error instanceof ApiError) {
    if (error.errorCode === 'SECURITY_NOT_CONFIGURED') return 'not-configured';
    if (error.status === 401 || error.status === 403) return 'sign-in';
  }
  return 'unavailable';
}

/** Samples are an explicit UI choice, never a credential or auth fallback. */
export function SessionGate({ client, offline, children }: { client: Client; offline: boolean; children: ReactNode }) {
  const [demo, setDemo] = useState(false);
  const [session, setSession] = useState<Session>();
  const [local, setLocal] = useState(false);
  const [issue, setIssue] = useState<StartupIssue>();
  const [connected, setConnected] = useState(!client.onDemand);
  const [connecting, setConnecting] = useState(false), [connectionError, setConnectionError] = useState('');
  const [checking, setChecking] = useState(!client.onDemand);
  const [attempt, setAttempt] = useState(0);
  const [expiresAt, setExpiresAt] = useState<number>();
  const [notice, setNotice] = useState<AuthNotice>();
  const [signingOut, setSigningOut] = useState(false);
  const currentSession = useRef(session); currentSession.current = session;
  const currentExpiry = useRef(expiresAt); currentExpiry.current = expiresAt;
  const refreshRequest = useRef<AbortController | undefined>(undefined);
  const authRequest = useRef<AbortController | undefined>(undefined);
  const connectRequest = useRef<AbortController | undefined>(undefined);
  const revision = useRef(0), requireSignIn = useRef(false);
  function cancelRefresh() { revision.current++; refreshRequest.current?.abort(); refreshRequest.current = undefined; }
  function expire() {
    cancelRefresh(); client.clearSession?.(); requireSignIn.current = true;
    setSession(undefined); setExpiresAt(undefined); setLocal(false); setChecking(false); setIssue('sign-in');
    setNotice(authNotice(new ApiError('Expired', 401, 'SESSION_EXPIRED')));
  }
  useEffect(() => () => { connectRequest.current?.abort(); authRequest.current?.abort(); client.clearSession?.(); }, [client]);
  useEffect(() => {
    if (!client.onDemand || offline || demo) return;
    const resumed = () => { if (currentExpiry.current !== undefined && Date.now() >= currentExpiry.current) expire(); };
    window.addEventListener('focus', resumed); window.document?.addEventListener('visibilitychange', resumed);
    const unsubscribe = client.subscribeAvailability?.(event => {
      cancelRefresh(); authRequest.current?.abort();
      setSession(undefined); setLocal(false); setChecking(false);
      if (event.kind === 'authentication-required') {
        requireSignIn.current = true; setExpiresAt(undefined); setIssue('sign-in');
        setNotice(authNotice(new ApiError('Sign in again.', 401, event.errorCode)));
      } else {
        setConnected(false); setIssue(undefined);
        setConnectionError(new StartupError(event.errorCode ?? 'WORKSPACE_UNAVAILABLE').message);
      }
    });
    return () => { unsubscribe?.(); window.removeEventListener('focus', resumed); window.document?.removeEventListener('visibilitychange', resumed); };
  }, [client, offline, demo]);
  useEffect(() => {
    if (expiresAt === undefined || offline || demo) return;
    const timer = window.setTimeout(expire, Math.max(0, expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [expiresAt, client, offline, demo]);
  useEffect(() => {
    if (offline || demo || !connected) return;
    let active = true;
    let deadline: number | undefined;
    const refresh = async () => {
      if (authRequest.current || requireSignIn.current) return;
      if (currentExpiry.current !== undefined && Date.now() >= currentExpiry.current) { expire(); return; }
      if (refreshRequest.current) return;
      const controller = new AbortController(), version = revision.current;
      refreshRequest.current = controller;
      setChecking(true);
      const requestDeadline = window.setTimeout(() => controller.abort(), SESSION_TIMEOUT_MS);
      deadline = requestDeadline;
      try {
        const value = await client.getSession(controller.signal);
        if (active && version === revision.current && !controller.signal.aborted) { setSession(value); setLocal(false); setIssue(undefined); setNotice(undefined); }
      } catch (error: unknown) {
        let localData = false;
        if (error instanceof ApiError && error.errorCode === 'SECURITY_NOT_CONFIGURED' && client.getLocalData) {
          try { localData = await client.getLocalData(controller.signal); } catch { /* A failed probe never enables local access. */ }
        }
        if (active && version === revision.current) {
          const nextIssue = startupIssue(error);
          if (nextIssue === 'sign-in') {
            if (currentSession.current || error instanceof ApiError && !['AUTHENTICATION_FAILED', 'PRINCIPAL_REQUIRED', undefined].includes(error.errorCode)) {
              setNotice(currentSession.current && error instanceof ApiError && error.errorCode === 'AUTHENTICATION_FAILED'
                ? { code: error.errorCode, message: 'Your session is no longer valid. Sign in again to continue.' } : authNotice(error));
            }
            if (currentSession.current) { client.clearSession?.(); requireSignIn.current = true; }
            setExpiresAt(undefined);
          }
          setSession(undefined); setLocal(localData); setIssue(nextIssue);
        }
      } finally {
        window.clearTimeout(requestDeadline);
        if (refreshRequest.current === controller) refreshRequest.current = undefined;
        if (active && version === revision.current) setChecking(false);
      }
    };
    void refresh();
    const timer = client.onDemand ? undefined : window.setInterval(() => void refresh(), 30_000);
    if (!client.onDemand) window.addEventListener('focus', refresh);
    return () => {
      active = false;
      cancelRefresh();
      window.clearTimeout(deadline);
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [client, offline, demo, attempt, connected]);

  async function connect() {
    if (connectRequest.current) return;
    const controller = new AbortController(); connectRequest.current = controller;
    setConnecting(true); setConnectionError('');
    try {
      if (!client.connect) throw new StartupError('WORKSPACE_UNAVAILABLE');
      await client.connect(controller.signal);
      if (controller.signal.aborted) return;
      requireSignIn.current = false; setIssue(undefined); setChecking(true); setConnected(true); setAttempt(n => n + 1);
    } catch (error) {
      if (!controller.signal.aborted) setConnectionError(error instanceof StartupError ? error.message : new StartupError('WORKSPACE_UNAVAILABLE').message);
    } finally {
      if (connectRequest.current === controller) { connectRequest.current = undefined; setConnecting(false); }
    }
  }

  async function signIn(input: LoginInput, remember: boolean): Promise<LoginResult | void> {
    if (!client.login) throw new ApiError('Unavailable', 503, 'BUILTIN_AUTH_UNAVAILABLE');
    cancelRefresh();
    const controller = new AbortController(); authRequest.current = controller;
    const deadline = window.setTimeout(() => controller.abort(), SESSION_TIMEOUT_MS);
    try {
      const value = await client.login(input, remember, controller.signal);
      if (controller.signal.aborted) throw new ApiError('Sign-in timed out.');
      // A picker challenge is not a session: the SignIn screen keeps the
      // challenge and completes it through selectWorkspace below.
      if (!('session' in value)) return value;
      requireSignIn.current = false;
      setSession(value.session); setExpiresAt(value.expiresAt); setLocal(false); setIssue(undefined); setNotice(undefined);
    } finally {
      window.clearTimeout(deadline);
      if (authRequest.current === controller) authRequest.current = undefined;
      if (!controller.signal.aborted) setChecking(false);
    }
  }
  async function selectWorkspace(selectionToken: string, tenantId: string, remember: boolean) {
    if (!client.selectWorkspace) throw new ApiError('Unavailable', 503, 'BUILTIN_AUTH_UNAVAILABLE');
    cancelRefresh();
    const controller = new AbortController(); authRequest.current = controller;
    const deadline = window.setTimeout(() => controller.abort(), SESSION_TIMEOUT_MS);
    try {
      const value = await client.selectWorkspace(selectionToken, tenantId, remember, controller.signal);
      if (controller.signal.aborted) throw new ApiError('Sign-in timed out.');
      requireSignIn.current = false;
      setSession(value.session); setExpiresAt(value.expiresAt); setLocal(false); setIssue(undefined); setNotice(undefined);
    } finally {
      window.clearTimeout(deadline);
      if (authRequest.current === controller) authRequest.current = undefined;
      if (!controller.signal.aborted) setChecking(false);
    }
  }
  async function signOut() {
    if (authRequest.current) return;
    cancelRefresh(); requireSignIn.current = true;
    setSession(undefined); setExpiresAt(undefined); setIssue('sign-in'); setSigningOut(true);
    const controller = new AbortController(); authRequest.current = controller;
    const deadline = window.setTimeout(() => controller.abort(), SESSION_TIMEOUT_MS);
    try {
      if (!client.logout) throw new ApiError('Unavailable', 503, 'BUILTIN_AUTH_UNAVAILABLE');
      await client.logout(controller.signal);
      if (!controller.signal.aborted) setNotice({ message: 'You have signed out.', kind: 'info' });
    } catch (error: unknown) {
      setNotice({ ...authNotice(error), message: `Sign-out could not be confirmed by the server. This page has cleared your sign-in. ${authNotice(error).message}` });
    } finally {
      window.clearTimeout(deadline);
      if (authRequest.current === controller) authRequest.current = undefined;
      setSigningOut(false); setChecking(false);
    }
  }
  const retry = () => { if (client.onDemand) { setConnected(false); setSession(undefined); setIssue(undefined); } else { requireSignIn.current = false; setAttempt(n => n + 1); } };
  const explore = () => { client.clearSession?.(); setSession(undefined); setExpiresAt(undefined); setDemo(true); };
  if (offline) return <AccessProvider access={demoAccess}>{children}</AccessProvider>;
  if (demo) return <>
    <aside className="fixture-demo-banner" aria-label="Fixture demo">
      <span><strong>Fixture demo</strong> · Public samples only · No hosted session</span>
      <button type="button" onClick={() => { setSession(undefined); requireSignIn.current = false; setDemo(false); }}>Return to setup</button>
    </aside>
    <AccessProvider access={demoAccess}>{children}</AccessProvider>
  </>;
  if (client.onDemand && !connected) return <div className="sign-in-page"><main className="sign-in-main">
    <section className="sign-in-card" aria-labelledby="connect-title">
    <p className="sign-in-kicker">YOUR HOSTED WORKSPACE</p><h1 id="connect-title">Connect to OpenSight</h1><p className="sign-in-description">The workspace sleeps when it is idle. Connecting may take a moment.</p>
    {connectionError && <p className="sign-in-alert" role="alert">{connectionError}</p>}
    <button className="sign-in-primary" type="button" disabled={connecting} onClick={() => void connect()}>{connecting ? 'Connecting…' : 'Connect'}</button>
    {connecting && <button className="sign-in-secondary" type="button" onClick={() => { connectRequest.current?.abort(); }}>Cancel</button>}
    </section>
    <nav className="sign-in-links" aria-label="Startup options"><button type="button" onClick={() => { connectRequest.current?.abort(); explore(); }}>Explore sample data</button></nav>
  </main></div>;
  if (local) return <AccessProvider access={{ mode: 'local' }}>{children}</AccessProvider>;
  if (signingOut) return <div className="sign-in-page"><main className="sign-in-main"><p role="status">Signing out…</p></main></div>;
  if (!session && issue === 'sign-in') return <SignIn notice={notice} onSignIn={signIn} onSelectWorkspace={selectWorkspace} onRetry={retry} onDemo={explore} />;
  // While the first session check is in flight we know nothing yet — render a minimal
  // loading state in the sign-in shell so the landing page never flashes before auth.
  // The sample-data escape hatch stays available for slow checks.
  if (!session && checking && !issue) return <div className="sign-in-page"><main className="sign-in-main">
    <p role="status">Checking your workspace…</p>
    <nav className="sign-in-links" aria-label="Startup options"><button type="button" onClick={explore}>Explore sample data</button></nav>
  </main></div>;
  if (!session) return <FirstRun issue={issue} checking={checking} onRetry={retry} onDemo={explore} />;
  return <AccessProvider access={{ mode: 'hosted', session, aiClient: client, ...(client.logout ? { signOut } : {}) }}>{children}</AccessProvider>;
}
