import type { VisualKind } from './visual-catalog.js';

type SkeletonVariant = 'bars' | 'pie' | 'rows' | 'kpi' | 'block';

const CARTESIAN: ReadonlySet<VisualKind> = new Set(['bar', 'bar100', 'combo', 'waterfall', 'histogram', 'line', 'area', 'funnel']);

export function skeletonVariant(kind: VisualKind): SkeletonVariant {
  if (kind === 'table' || kind === 'pivot') return 'rows';
  if (kind === 'kpi') return 'kpi';
  if (kind === 'pie' || kind === 'gauge') return 'pie';
  if (CARTESIAN.has(kind)) return 'bars';
  return 'block';
}

function Bars() {
  // Fixed proportions keep the shimmer deterministic for tests and screenshots.
  const heights = [55, 80, 40, 68, 92, 50, 74, 34];
  return <div className="skeleton-bars" aria-hidden="true">{heights.map(height => <span key={height} className="skeleton-shape" style={{ height: `${height}%` }} />)}</div>;
}

function Pie() {
  return <div className="skeleton-pie" aria-hidden="true"><span className="skeleton-shape skeleton-disc" /></div>;
}

function Rows() {
  return <div className="skeleton-rows" aria-hidden="true">
    <span className="skeleton-shape skeleton-row-head" />
    {[0, 1, 2, 3, 4].map(i => <span key={i} className="skeleton-shape skeleton-row" />)}
  </div>;
}

function Kpi() {
  return <div className="skeleton-kpi" aria-hidden="true">
    <span className="skeleton-shape skeleton-kpi-value" />
    <span className="skeleton-shape skeleton-kpi-label" />
    <span className="skeleton-shape skeleton-kpi-delta" />
  </div>;
}

function Block() {
  return <div className="skeleton-block" aria-hidden="true"><span className="skeleton-shape skeleton-fill" /></div>;
}

/**
 * Shimmer placeholder shown inside a visual card while its data loads or
 * recomputes (live query, interaction, parameter change). The shapes roughly
 * match the visual so the card does not read as blank or broken. Motion is a
 * pure CSS shimmer; `prefers-reduced-motion` renders a static placeholder.
 */
export function VisualSkeleton({ kind }: { kind: VisualKind }) {
  const variant = skeletonVariant(kind);
  return <div className={`visual-skeleton skeleton-${variant}`} role="status" aria-label="Loading data">
    <span className="sr-only">Waiting for query results. No data is shown until the query completes.</span>
    {variant === 'bars' && <Bars />}
    {variant === 'pie' && <Pie />}
    {variant === 'rows' && <Rows />}
    {variant === 'kpi' && <Kpi />}
    {variant === 'block' && <Block />}
  </div>;
}
