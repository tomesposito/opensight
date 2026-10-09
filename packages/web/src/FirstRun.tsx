export type StartupIssue = 'not-configured' | 'sign-in' | 'unavailable';

const messages = {
  'not-configured': {
    title: 'Authentication is not configured',
    detail: 'The API returned SECURITY_NOT_CONFIGURED. The default fixture server does not issue authenticated sessions. Configure authentication to use a connected workspace, or explore the public samples below.',
  },
  'sign-in': {
    title: 'A verified session is required',
    detail: 'The API did not accept this session. Sign in through your configured authentication integration, or ask your administrator to check your membership and access. Then retry the connection.',
  },
  unavailable: {
    title: 'Unable to connect to your workspace',
    detail: 'The session service could not be reached or returned an unexpected response. Check that the API is running on port 3000 and that the web proxy or VITE_OPENSIGHT_API_URL points to it. Authentication may also need configuration.',
  },
} as const;

const docs = 'https://github.com/tomesposito/opensight/blob/master/docs/';

export function FirstRun({ issue, checking, onRetry, onDemo }: {
  issue?: StartupIssue; checking: boolean; onRetry(): void; onDemo(): void;
}) {
  const message = issue ? messages[issue] : undefined;
  return <div className="first-run">
    <header className="first-run-header"><a className="brand" href="./"><span className="brand-mark" aria-hidden="true">◈</span>OpenSight</a><span>Open-source business intelligence</span></header>
    <main className="first-run-main">
      <div className="first-run-intro"><p className="eyebrow">WELCOME TO OPENSIGHT</p><h1>From data to dashboards.</h1>
        <p>OpenSight is open-source, QuickSight-compatible BI for dashboards, analysis authoring, data preparation, connectors and embedding.</p>
        <p>Explore an analysis with public sample data, or connect an authenticated workspace for your own data.</p>
      </div>
      <section className="first-run-status" aria-labelledby="startup-title">
        <div role="status" aria-live="polite"><h2 id="startup-title">{message?.title ?? 'Checking your workspace…'}</h2><p>{message?.detail ?? 'Resolving your authenticated session. You can explore the fixture demo while you set up the API.'}</p>{checking && issue && <p>Checking the connection…</p>}</div>
        <button type="button" onClick={onRetry} disabled={checking}>{checking ? 'Checking…' : 'Retry connection'}</button>
      </section>
      <div className="first-run-paths">
        <section className="first-run-demo" aria-labelledby="demo-title">
          <p className="eyebrow">EXPLORE NOW</p><h2 id="demo-title">Try the fixture demo</h2>
          <p>Open a sample dashboard, build visuals on the analysis canvas, and explore data preparation and the connector gallery.</p>
          <ul><li>Public, bundled samples only</li><li>No sign-in or server connection</li><li>No access to your own or tenant data</li></ul>
          <button className="first-run-primary" type="button" onClick={onDemo}>Explore sample data</button>
          <p className="first-run-note">Local demo only. This does not create a hosted session. Uploads, live connectors, publishing and server saves need a hosted API.</p>
        </section>
        <section className="first-run-setup" aria-labelledby="setup-title">
          <p className="eyebrow">CONNECT YOUR DATA</p><h2 id="setup-title">Configure authentication</h2>
          <ol>
            <li><strong>Select the hosted API.</strong> Set <code>OPENSIGHT_MODE=hosted</code> in the API process environment. The default fixture mode has no credential verifier.</li>
            <li><strong>Set up durable storage and keys.</strong> Configure the existing variables below, keep secrets on the server, and restart the API. Hosted mode requires HTTPS through a trusted reverse proxy.</li>
            <li><strong>Provision a tenant and sign in.</strong> Configure SMTP for invitations, use the operator API to invite an administrator, then enroll a password and TOTP. The existing H2 API issues a bearer token; your authentication integration must supply it on browser API requests. There is no built-in browser login form.</li>
          </ol>
          <details><summary>Required API environment variables</summary>
            <dl className="first-run-config">
              <dt><code>OPENSIGHT_METADATA_DATABASE</code></dt><dd>Durable SQLite file, for example <code>.opensight/metadata.sqlite</code>; never <code>:memory:</code>.</dd>
              <dt><code>OPENSIGHT_PUBLIC_ORIGIN</code></dt><dd>Exact HTTPS origin, with no path or trailing slash. Preserve its Host at the proxy.</dd>
              <dt><code>OPENSIGHT_AUTH_ISSUER</code><br /><code>OPENSIGHT_AUTH_AUDIENCE</code></dt><dd>Explicit nonempty identifiers without whitespace.</dd>
              <dt><code>OPENSIGHT_AUTH_KEY_ID</code></dt><dd>Unique identifier for the active signing key.</dd>
              <dt><code>OPENSIGHT_AUTH_SIGNING_KEY</code><br /><code>OPENSIGHT_AUTH_ENCRYPTION_KEY</code><br /><code>OPENSIGHT_OPERATOR_KEY</code></dt><dd>Three distinct random 32-byte keys, each in canonical base64. Never put secrets in <code>VITE_*</code> variables.</dd>
              <dt><code>OPENSIGHT_SESSION_SECONDS</code><br /><code>OPENSIGHT_INVITATION_SECONDS</code></dt><dd>Explicit lifetimes: 900–36000 and 1–604800 seconds respectively.</dd>
              <dt><code>OPENSIGHT_SMTP_HOST</code><br /><code>OPENSIGHT_SMTP_FROM</code></dt><dd>Invitation delivery. <code>OPENSIGHT_SMTP_PORT</code> defaults to 465 (implicit TLS). If needed, set both <code>OPENSIGHT_SMTP_USER</code> and <code>OPENSIGHT_SMTP_PASSWORD</code>.</dd>
            </dl>
          </details>
          <p className="first-run-note">These are the existing hosted settings. A library deployment can instead supply its own trusted <code>SecurityOptions.authenticate</code> verifier and registered users.</p>
        </section>
      </div>
      <nav className="first-run-docs" aria-label="Setup documentation"><strong>Setup guides</strong><a href={`${docs}first-run.md`}>First-run guide</a><a href={`${docs}h2-tenant-sessions.md`}>Hosted authentication</a><a href={`${docs}security-namespaces.md`}>Custom verifier</a><a href={`${docs}hosted-architecture.md`}>Architecture and limits</a><span>Repository links open online. The same guides are available locally in <code>docs/</code>.</span></nav>
    </main>
    <footer className="app-footer">OpenSight · visual fidelity not measured</footer>
  </div>;
}
