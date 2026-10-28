import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, type createApiClient, type Enrollment, type LoginInput } from './api-client.js';
import { BrandMark } from './BrandMark.js';
import { encodeQr } from './qr.js';

export type EnrollmentCredentials = Pick<LoginInput, 'email' | 'password'>;
type Client = Partial<Pick<ReturnType<typeof createApiClient>, 'enroll' | 'acceptEnrollment'>>;
type Setup = { enrollment: Extract<Enrollment, { enrollmentRequired: true }>; email: string; issuer: string; modules: boolean[][] };

export function authenticatorDetails(uri: string, secret: string): { email: string; issuer: string } {
  const invalid = () => new ApiError('Invalid authenticator setup response. Contact your administrator.', undefined, 'AUTH_RESPONSE_INVALID');
  try {
    const url = new URL(uri), label = decodeURIComponent(url.pathname.slice(1)), issuer = url.searchParams.get('issuer');
    if (url.protocol !== 'otpauth:' || url.hostname !== 'totp' || url.username || url.password || url.port || url.hash || !issuer || !label.startsWith(`${issuer}:`)
      || url.searchParams.get('secret') !== secret || url.searchParams.get('algorithm') !== 'SHA1' || url.searchParams.get('digits') !== '6' || url.searchParams.get('period') !== '30') throw invalid();
    const email = label.slice(issuer.length + 1);
    if (!email || !email.includes('@')) throw invalid();
    return { email, issuer };
  } catch { throw invalid(); }
}
export function InvitationEnrollment({ token, client, onEnrolled, onSignIn }: {
  token: string; client: Client; onEnrolled(credentials: EnrollmentCredentials): void; onSignIn(): void;
}) {
  const [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState(''), [code, setCode] = useState('');
  const [setup, setSetup] = useState<Setup>(), [error, setError] = useState(''), [deadEnd, setDeadEnd] = useState(false), [busy, setBusy] = useState(false);
  const request = useRef<AbortController | undefined>(undefined), active = useRef(true), alert = useRef<HTMLParagraphElement>(null), codeField = useRef<HTMLInputElement>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; request.current?.abort(); }; }, []);
  useEffect(() => { if (error) alert.current?.focus(); }, [error]);
  useEffect(() => { if (setup) codeField.current?.focus(); }, [setup]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (request.current || deadEnd) return;
    setError('');
    if (!setup && password !== confirmation) { setError('Passwords do not match. Enter the same password twice.'); return; }
    if (setup && !/^\d{6}$/.test(code)) { setError('Enter the 6-digit code from your authenticator app.'); return; }
    const controller = new AbortController(); request.current = controller; setBusy(true);
    const deadline = window.setTimeout(() => controller.abort(), 10_000);
    try {
      if (!client.enroll || !client.acceptEnrollment) throw new ApiError('Browser enrollment needs a hosted API with built-in authentication.', 503, 'BUILTIN_AUTH_UNAVAILABLE');
      if (setup) {
        await client.acceptEnrollment(token, password, code, controller.signal);
        controller.signal.throwIfAborted();
        if (active.current) {
          const credentials = { email: setup.email, password };
          setPassword(''); setConfirmation(''); setCode(''); setSetup(undefined);
          onEnrolled(credentials);
        }
      } else {
        const enrollment = await client.enroll(token, password, controller.signal);
        controller.signal.throwIfAborted();
        if (!active.current) return;
        if (!enrollment.enrollmentRequired) { setPassword(''); setConfirmation(''); onSignIn(); return; }
        const details = authenticatorDetails(enrollment.uri, enrollment.secret);
        setSetup({ enrollment, ...details, modules: encodeQr(enrollment.uri).modules }); setConfirmation('');
      }
    } catch (failure: unknown) {
      if (!active.current) return;
      setCode('');
      const named = failure instanceof ApiError ? failure.errorCode : undefined;
      const invalidInvitation = ['AUTHENTICATION_FAILED', 'INVITATION_USED', 'INVITATION_ACCEPTED', 'INVITATION_EXPIRED', 'INVITATION_REVOKED', 'SECURITY_INVITATION_INVALID', 'SECURITY_INVITATION_EXPIRED'].includes(named ?? '');
      // The API deliberately gives the same error for bad credentials and an
      // invalid invitation. Never claim to distinguish them or retain a QR.
      if (invalidInvitation || named === 'AUTH_RESPONSE_INVALID') {
        setSetup(undefined); setPassword(''); setConfirmation(''); setDeadEnd(true);
      }
      setError(invalidInvitation
        ? `${named}: Setup could not be verified. This invitation may be used, expired or revoked, or the password or code may be incorrect. Contact your administrator for help. To resume interrupted setup, reopen your invitation and use the same password.`
        : failure instanceof ApiError ? `${named ? `${named}: ` : ''}${failure.message}` : 'Unable to complete setup. Check your connection and try again with the same password.');
    } finally {
      window.clearTimeout(deadline); request.current = undefined; if (active.current) setBusy(false);
    }
  };
  const size = (setup?.modules.length ?? 0) + 8;
  return <div className="sign-in-page"><main className="sign-in-main"><section className="sign-in-card" aria-labelledby="enrollment-title">
    <div className="sign-in-brand"><span className="brand-mark" aria-hidden="true"><BrandMark size={34} /></span><span className="brand-wordmark">opensight</span></div>
    <p className="sign-in-kicker">YOUR WORKSPACE INVITATION</p>
    <h1 id="enrollment-title">{deadEnd ? 'Unable to complete setup' : setup ? 'Set up your authenticator' : 'Set up your account'}</h1>
    {error && <p ref={alert} className="sign-in-alert" role="alert" tabIndex={-1}>{error}</p>}
    {!deadEnd && <form onSubmit={submit} aria-busy={busy}>
      {setup ? <>
        <p className="sign-in-description">Scan this QR code with your authenticator app, or enter the setup key manually.</p>
        <svg className="enrollment-qr" role="img" aria-label="Authenticator setup QR code" viewBox={`0 0 ${size} ${size}`} width={size * 4} height={size * 4} shapeRendering="crispEdges">
          <rect width={size} height={size} fill="#fff" />
          <path fill="#000" d={setup.modules.flatMap((row, y) => row.flatMap((dark, x) => dark ? [`M${x + 4},${y + 4}h1v1h-1z`] : [])).join('')} />
        </svg>
        <p className="sign-in-identity">Account: {setup.email}<br />Issuer: {setup.issuer}</p>
        <label className="sign-in-field" htmlFor="enrollment-secret">Setup key (base32)<input id="enrollment-secret" readOnly value={setup.enrollment.secret} onFocus={event => event.target.select()} /></label>
        <p className="sign-in-help">Keep this key private. Select it to copy for manual entry. Use time-based codes, SHA1, 6 digits, every 30 seconds.</p>
        <label className="sign-in-field" htmlFor="enrollment-code">Authenticator code<input ref={codeField} id="enrollment-code" className="sign-in-code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required disabled={busy} value={code} onChange={event => setCode(event.target.value)} /></label>
      </> : <>
        <p className="sign-in-description">Choose a password for the invited account. Next, you will register an authenticator app. To resume interrupted setup, enter the password you chose before.</p>
        <label className="sign-in-field" htmlFor="enrollment-password">New password<input id="enrollment-password" type="password" autoComplete="new-password" required maxLength={1024} disabled={busy} value={password} onChange={event => setPassword(event.target.value)} /></label>
        <p className="sign-in-help">Use at least 15 characters, up to 1,024 bytes.</p>
        <label className="sign-in-field" htmlFor="enrollment-confirmation">Confirm password<input id="enrollment-confirmation" type="password" autoComplete="new-password" required maxLength={1024} disabled={busy} value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>
      </>}
      <button className="sign-in-primary" type="submit" disabled={busy}>{busy ? 'Setting up…' : setup ? 'Confirm authenticator' : 'Continue'}</button>
    </form>}
    {!deadEnd && !setup && <button className="sign-in-secondary" type="button" disabled={busy} onClick={() => { setPassword(''); setConfirmation(''); onSignIn(); }}>Already have an account? Sign in</button>}
    <p className="sign-in-assistance">This invitation is bound to the invited account. Need help? Contact your administrator.</p>
  </section></main></div>;
}
