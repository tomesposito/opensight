/** This static preview neither configures nor enforces security. */
export function SecurityNotice() {
  return <section aria-labelledby="security-title">
    <div className="dashboard-heading"><div><p className="eyebrow">Data access</p><h1 id="security-title">Security &amp; namespaces</h1></div><span className="phase-badge">Needs hosted API</span></div>
    <p className="fixture-notice">This preview does not authenticate users or enforce data access policies. Its bundled sample data is public. Security configuration needs a hosted OpenSight API with authentication configured by its administrator. No rules, grants or namespaces are created here.</p>
    <div className="automation-grid">
      <article className="automation-notice"><h2>Row-level security</h2><p className="eyebrow">Needs hosted API</p><p>Grant users or groups access to matching rows. The hosted query engine applies these rules before calculations and aggregation. Protected datasets with no matching rule deny access.</p><button disabled title="Requires an authenticated hosted API">Configure row rules</button></article>
      <article className="automation-notice"><h2>Column-level security</h2><p className="eyebrow">Needs hosted API</p><p>Allow or deny access to individual columns. Deny overrides allow, and queries that reference a denied column fail with an explicit error.</p><button disabled title="Requires an authenticated hosted API">Configure column grants</button></article>
      <article className="automation-notice"><h2>Namespaces</h2><p className="eyebrow">Needs hosted API</p><p>Keep users, groups and assets in separate namespaces. The hosted API resolves the namespace from the authenticated identity.</p><button disabled title="Requires an authenticated hosted API">Manage namespaces</button></article>
    </div>
  </section>;
}
