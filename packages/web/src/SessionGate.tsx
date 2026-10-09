import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessProvider, demoAccess, type Session, type Access } from './access.js';
import { ApiError, type createApiClient, type LoginInput } from './api-client.js';
import { FirstRun, type StartupIssue } from './FirstRun.js';
import { SignIn } from './SignIn.js';
import { authNotice, type AuthNotice } from './auth-errors.js';

type Client = Pick<ReturnType<typeof createApiClient>, 'getSession'> & Partial<Pick<ReturnType<typeof createApiClient>, 'getLocalData' | 'login' | 'logout' | 'clearSession'>> & Access['aiClient'];
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
  const [checking, setChecking] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [expiresAt, setExpiresAt] = useState<number>();
  const [notice, setNotice] = useState<AuthNotice>();
  const [signingOut, setSigningOut] = useState(false);
  const currentSession = useRef(session); currentSession.current = session;
  const currentExpiry = useRef(expiresAt); currentExpiry.current = expiresAt;
  const refreshRequest = useRef<AbortController | undefined>(undefined);
  const authRequest = useRef<AbortController | undefined>(undefined);
  const revision = useRef(0), requireSignIn = useRef(false);
  function cancelRefresh() { revision.current++; refreshRequest.current?.abort(); refreshRequest.current = undefined; }
  function expire() {
    cancelRefresh(); client.clearSession?.(); requireSignIn.current = true;
    setSession(undefined); setExpiresAt(undefined); setLocal(false); setChecking(false); setIssue('sign-in');
    setNotice(authNotice(new ApiError('Expired', 401, 'SESSION_EXPIRED')));
  }
  useEffect(() => () => { authRequest.current?.abort(); client.clearSession?.(); }, [client]);
  useEffect(() => {
    if (expiresAt === undefined || offline || demo) return;
    const timer = window.setTimeout(expire, Math.max(0, expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [expiresAt, client, offline, demo]);
  useEffect(() => {
    if (offline || demo) return;
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
    const timer = window.setInterval(() => void refresh(), 30_000);
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      cancelRefresh();
      window.clearTimeout(deadline);
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [client, offline, demo, attempt]);

  async function signIn(input: LoginInput, remember: boolean) {
    if (!client.login) throw new ApiError('Unavailable', 503, 'BUILTIN_AUTH_UNAVAILABLE');
    cancelRefresh();
    const controller = new AbortController(); authRequest.current = controller;
    const deadline = window.setTimeout(() => controller.abort(), SESSION_TIMEOUT_MS);
    try {
      const value = await client.login(input, remember, controller.signal);
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
      if (!controller.signal.aborted) setNotice({ message: 'You have signed out.' });
    } catch (error: unknown) {
      setNotice({ ...authNotice(error), message: `Sign-out could not be confirmed by the server. This page has cleared your sign-in. ${authNotice(error).message}` });
    } finally {
      window.clearTimeout(deadline);
      if (authRequest.current === controller) authRequest.current = undefined;
      setSigningOut(false); setChecking(false);
    }
  }
  const retry = () => { requireSignIn.current = false; setAttempt(n => n + 1); };
  const explore = () => { client.clearSession?.(); setSession(undefined); setExpiresAt(undefined); setDemo(true); };
  if (offline) return <AccessProvider access={demoAccess}>{children}</AccessProvider>;
  if (demo) return <>
    <aside className="fixture-demo-banner" aria-label="Fixture demo">
      <span><strong>Fixture demo</strong> · Public samples only · No hosted session</span>
      <button type="button" onClick={() => { setSession(undefined); requireSignIn.current = false; setDemo(false); }}>Return to setup</button>
    </aside>
    <AccessProvider access={demoAccess}>{children}</AccessProvider>
  </>;
  if (local) return <AccessProvider access={{ mode: 'local' }}>{children}</AccessProvider>;
  if (signingOut) return <div className="sign-in-page"><main className="sign-in-main"><p role="status">Signing out…</p></main></div>;
  if (!session && issue === 'sign-in') return <SignIn notice={notice} onSignIn={signIn} onRetry={retry} onDemo={explore} />;
  if (!session) return <FirstRun issue={issue} checking={checking} onRetry={retry} onDemo={explore} />;
  return <AccessProvider access={{ mode: 'hosted', session, aiClient: client, ...(client.logout ? { signOut } : {}) }}>{children}</AccessProvider>;
}
