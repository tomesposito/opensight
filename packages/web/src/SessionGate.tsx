import { useEffect, useState, type ReactNode } from 'react';
import { AccessProvider, demoAccess, type Session, type Access } from './access.js';
import { ApiError, type createApiClient } from './api-client.js';
import { FirstRun, type StartupIssue } from './FirstRun.js';

type Client = Pick<ReturnType<typeof createApiClient>, 'getSession'> & Partial<Pick<ReturnType<typeof createApiClient>, 'getLocalData'>> & Access['aiClient'];
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
  useEffect(() => {
    if (offline || demo) return;
    let active = true;
    let request: AbortController | undefined;
    let deadline: number | undefined;
    const refresh = async () => {
      if (request) return;
      const controller = new AbortController();
      request = controller;
      setChecking(true);
      deadline = window.setTimeout(() => controller.abort(), SESSION_TIMEOUT_MS);
      try {
        const value = await client.getSession(controller.signal);
        if (active) { setSession(value); setLocal(false); setIssue(undefined); }
      } catch (error: unknown) {
        let localData = false;
        if (error instanceof ApiError && error.errorCode === 'SECURITY_NOT_CONFIGURED' && client.getLocalData) {
          try { localData = await client.getLocalData(controller.signal); } catch { /* A failed probe never enables local access. */ }
        }
        if (active) { setSession(undefined); setLocal(localData); setIssue(startupIssue(error)); }
      } finally {
        window.clearTimeout(deadline);
        request = undefined;
        if (active) setChecking(false);
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      request?.abort();
      window.clearTimeout(deadline);
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [client, offline, demo, attempt]);

  if (offline) return <AccessProvider access={demoAccess}>{children}</AccessProvider>;
  if (demo) return <>
    <aside className="fixture-demo-banner" aria-label="Fixture demo">
      <span><strong>Fixture demo</strong> · Public samples only · No hosted session</span>
      <button type="button" onClick={() => { setSession(undefined); setDemo(false); }}>Return to setup</button>
    </aside>
    <AccessProvider access={demoAccess}>{children}</AccessProvider>
  </>;
  if (local) return <AccessProvider access={{ mode: 'local' }}>{children}</AccessProvider>;
  if (!session) return <FirstRun issue={issue} checking={checking} onRetry={() => setAttempt(n => n + 1)} onDemo={() => setDemo(true)} />;
  return <AccessProvider access={{ mode: 'hosted', session, aiClient: client }}>{children}</AccessProvider>;
}
