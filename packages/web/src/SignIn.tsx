import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { LoginInput } from './api-client.js';
import { authNotice, type AuthNotice } from './auth-errors.js';

export function SignIn({ onSignIn, notice, onRetry, onDemo }: {
  onSignIn(input: LoginInput, remember: boolean): Promise<void>;
  notice?: AuthNotice; onRetry(): void; onDemo(): void;
}) {
  const [step, setStep] = useState<'credentials' | 'totp'>('credentials');
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [tenantId, setTenantId] = useState('');
  const [code, setCode] = useState(''), [remember, setRemember] = useState(false), [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<AuthNotice>(), [busy, setBusy] = useState(false);
  const active = useRef(true), submitting = useRef(false);
  const emailField = useRef<HTMLInputElement>(null), codeField = useRef<HTMLInputElement>(null), alert = useRef<HTMLDivElement>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { (step === 'totp' ? codeField : emailField).current?.focus(); }, [step]);
  useEffect(() => { if (error || notice) alert.current?.focus(); }, [error, notice]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting.current) return;
    setError(undefined);
    if (step === 'credentials') { setShowPassword(false); setStep('totp'); return; }
    if (!/^\d{6}$/.test(code)) { setError({ message: 'Enter the 6-digit code from your authenticator app.' }); return; }
    submitting.current = true; setBusy(true);
    try {
      await onSignIn({ email: email.trim(), password, code, tenantId: tenantId.trim() }, remember);
      if (active.current) { setPassword(''); setCode(''); }
    } catch (failure: unknown) {
      if (active.current) { setCode(''); setError(authNotice(failure)); }
    } finally { submitting.current = false; if (active.current) setBusy(false); }
  };
  const message = error ?? (step === 'credentials' ? notice : undefined);
  return <div className="sign-in-page">
    <main className="sign-in-main">
      <section className="sign-in-card" aria-labelledby="sign-in-title">
        <div className="sign-in-brand"><span className="brand-mark" aria-hidden="true">◈</span><span>OpenSight</span></div>
        <p className="sign-in-kicker">YOUR HOSTED WORKSPACE</p>
        <h1 id="sign-in-title">{step === 'credentials' ? 'Sign in' : 'Verify your identity'}</h1>
        {message && <div ref={alert} className="sign-in-alert" role="alert" tabIndex={-1}><p>{message.message}</p>{message.code && <span className="sign-in-error-code">{message.code}</span>}</div>}
        <form onSubmit={submit} aria-busy={busy}>
          {step === 'credentials' ? <>
            <label className="sign-in-field" htmlFor="signin-email">Email address<input ref={emailField} id="signin-email" type="email" autoComplete="username" required maxLength={320} value={email} onChange={event => setEmail(event.target.value)} /></label>
            <label className="sign-in-field" htmlFor="signin-password">Password<input id="signin-password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required maxLength={1024} value={password} onChange={event => setPassword(event.target.value)} /></label>
            <label className="sign-in-check"><input type="checkbox" checked={showPassword} onChange={event => setShowPassword(event.target.checked)} />Show password</label>
            <label className="sign-in-field" htmlFor="signin-workspace">Workspace ID<input id="signin-workspace" type="text" autoComplete="off" required pattern="[A-Za-z0-9_\-]{1,512}" maxLength={512} value={tenantId} onChange={event => setTenantId(event.target.value)} aria-describedby="signin-workspace-help" /></label>
            <p id="signin-workspace-help" className="sign-in-help">Use the workspace ID provided by your administrator.</p>
            <label className="sign-in-check"><input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} aria-describedby="signin-lifetime" />Remember me for this session</label>
            <p id="signin-lifetime" className="sign-in-help">{remember ? 'Stay signed in for your workspace’s configured session, up to 600 minutes.' : 'Sign out after 15 minutes.'} Reloading or closing this page ends sign-in.</p>
          </> : <>
            <p className="sign-in-identity">{email}</p>
            <p className="sign-in-description">Enter the 6-digit code from your authenticator app. Your sign-in details will be checked together.</p>
            <label className="sign-in-field" htmlFor="signin-code">Authenticator code<input ref={codeField} id="signin-code" className="sign-in-code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} disabled={busy} onChange={event => setCode(event.target.value)} /></label>
          </>}
          <button className="sign-in-primary" type="submit" disabled={busy}>{busy ? 'Signing in…' : step === 'credentials' ? 'Continue' : 'Sign in'}</button>
          {step === 'totp' && <button className="sign-in-secondary" type="button" disabled={busy} onClick={() => { setCode(''); setPassword(''); setError(undefined); setStep('credentials'); }}>Back to sign in</button>}
        </form>
        <p className="sign-in-assistance">Need an invitation, a password reset or help with a locked account? Contact your administrator.</p>
      </section>
      <nav className="sign-in-links" aria-label="Sign-in help"><button type="button" disabled={busy} onClick={onRetry}>Retry connection</button><button type="button" disabled={busy} onClick={onDemo}>Explore sample data</button></nav>
    </main>
    <footer className="sign-in-footer">OpenSight · Open-source business intelligence</footer>
  </div>;
}
