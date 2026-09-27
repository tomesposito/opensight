/** The static demo has no identity, resource store or signing service. */
export function OrganizationNotice() {
  return <section aria-labelledby="organization-title">
    <div className="dashboard-heading"><div><p className="eyebrow">Organize &amp; share</p><h1 id="organization-title">Folders, sharing &amp; embedding</h1></div><span className="phase-badge">Needs hosted API</span></div>
    <p className="fixture-notice">This preview uses public sample data. It does not create folders, share assets or generate signed embed URLs. These actions need a hosted OpenSight API with authentication configured by its administrator.</p>
    <div className="automation-grid">
      <article className="automation-notice"><h2>Folders</h2><p className="eyebrow">Needs hosted API</p><p>Organize analyses and dashboards, then move or copy them between folders. Folder permissions inherit namespace access and cannot grant more than the namespace allows.</p><button disabled title="Requires an authenticated hosted API">Manage folders</button></article>
      <article className="automation-notice"><h2>Asset sharing</h2><p className="eyebrow">Needs hosted API</p><p>Share analyses and dashboards with users or groups as viewers or co-owners, list their grants and revoke access. Namespace permissions remain the ceiling. Shared viewers still see only their permitted rows and columns.</p><button disabled title="Requires an authenticated hosted API">Manage sharing</button></article>
      <article className="automation-notice"><h2>Embedding</h2><p className="eyebrow">Needs hosted API</p><p>Embed a dashboard or individual visual with the browser SDK and a short-lived signed URL. Signing keys stay in the server environment. SSO hooks are integration stubs; your host must supply credential verification.</p><button disabled title="Requires a hosted API with authentication and environment signing configuration">Generate embed URL</button></article>
    </div>
  </section>;
}
