/** The static preview has no background service or SMTP connection. */
export function AutomationNotice() {
  return <section aria-labelledby="automation-title">
    <div className="dashboard-heading"><div><p className="eyebrow">Scheduled updates</p><h1 id="automation-title">Schedules, reports & alerts</h1></div><span className="phase-badge">Needs hosted API</span></div>
    <p className="fixture-notice">This preview cannot run background jobs or send notifications. Connect to a hosted OpenSight API to manage these services. No schedules, subscriptions or alert rules are created here.</p>
    <div className="automation-grid">
      <article className="automation-notice"><h2>Dataset refresh schedules</h2><p className="eyebrow">Needs hosted API</p><p>Refresh on an interval or at a daily or weekly time. The API records run history, the last successful refresh and source failures.</p><button disabled title="Requires a hosted API">Create refresh schedule</button></article>
      <article className="automation-notice"><h2>Email report subscriptions</h2><p className="eyebrow">Not configured · needs hosted API</p><p>Subscribe to scheduled dashboard snapshots. Delivery requires an API with SMTP configured by its administrator.</p><button disabled title="Requires a hosted API with email configured">Subscribe to report</button></article>
      <article className="automation-notice"><h2>Threshold alerts</h2><p className="eyebrow">Needs hosted API</p><p>Check visual metrics after a refresh and receive email when a threshold is crossed. This preview does not evaluate or deliver alerts.</p><button disabled title="Requires a hosted API with email configured">Create alert rule</button></article>
    </div>
  </section>;
}
