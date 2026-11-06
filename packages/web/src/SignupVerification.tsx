import { useState } from 'react';
export function SignupVerification({ token, baseUrl = '/api' }: { token: string; baseUrl?: string }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [queued, setQueued] = useState(false);
  const verify = async () => {
    if (busy) return; setBusy(true); setMessage('');
    try {
      const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/signup/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
      const body = await response.json() as { queued?: boolean; message?: string; invitationToken?: string; errorCode?: string };
      if (!response.ok) throw new Error(body.errorCode === 'SIGNUP_TOKEN_EXPIRED' ? 'This link expired. Return to signup to request a fresh verification email.' : body.errorCode ?? 'Verification failed');
      if (body.queued) { setQueued(true); setMessage(body.message ?? "Signups are opening in batches; we'll email you when your workspace is ready."); }
      else if (body.invitationToken && /^[A-Za-z0-9_-]{43}$/.test(body.invitationToken)) window.location.replace(`#invite=${body.invitationToken}`);
      else throw new Error('Invalid verification response');
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Verification failed'); }
    finally { setBusy(false); }
  };
  return <div className="trial-page"><section className="trial-card"><h1>Confirm your OpenSight workspace</h1><p>Your 14-day trial starts when your workspace is ready.</p>
    {!queued && <button className="trial-primary" disabled={busy} onClick={() => void verify()}>{busy ? 'Creating workspace…' : 'Confirm email and create workspace'}</button>}
    {message && <p role="status">{message}</p>}
  </section></div>;
}
