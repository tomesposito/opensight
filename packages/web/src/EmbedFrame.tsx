import type { ReactNode } from 'react';

export type EmbedState = 'loading' | 'empty' | 'error' | 'expired' | 'ready';
export interface EmbedBrand {
  palette: 'navy' | 'teal' | 'plum'; font: 'system' | 'sans'; layout: 'comfortable' | 'compact';
  productName: string; iframeTitle: string; logoAssetId: string | null; faviconAssetId: string | null;
}
export const defaultEmbedBrand: EmbedBrand = { palette: 'navy', font: 'system', layout: 'comfortable', productName: 'OpenSight', iframeTitle: 'OpenSight dashboard', logoAssetId: null, faviconAssetId: null };
export const embedStates = {
  loading: { title: 'Loading dashboard', detail: 'Checking access and preparing your view.', symbol: '…' },
  empty: { title: 'No visuals in this dashboard', detail: 'There is no content to display in this view.', symbol: '□' },
  error: { title: 'Dashboard unavailable', detail: 'Data access was denied. Ask your administrator to review your permissions.', symbol: '!' },
  expired: { title: 'Embed URL expired', detail: 'Request a fresh URL through the hosted API to continue.', symbol: '◷' },
} as const;
/** Only server-validated raster bytes belong here. No external URL or SVG fallback. */
export function embedAsset(id: string | null, assets: Readonly<Record<string, string>>): string | undefined {
  const value = id && Object.hasOwn(assets, id) ? assets[id] : undefined;
  return value && value.length <= 90022 && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value) ? value : undefined;
}
export function EmbedFrame({ state, appearance = defaultEmbedBrand, assets = {}, title, detail, children, viewLabel = 'Dashboard view', description = 'Dashboard snapshot · rendered with your data access permissions' }: {
  state: EmbedState; appearance?: EmbedBrand; assets?: Readonly<Record<string, string>>; title?: string; detail?: string; children?: ReactNode; viewLabel?: string; description?: string;
}) {
  // Classes always come from the fixed table, never from caller-supplied CSS.
  const palette = { navy: 'embed-navy', teal: 'embed-teal', plum: 'embed-plum' }[appearance.palette] ?? 'embed-navy';
  const font = appearance.font === 'sans' ? 'embed-sans' : 'embed-system';
  const layout = appearance.layout === 'compact' ? 'embed-compact' : 'embed-comfortable';
  const logo = embedAsset(appearance.logoAssetId, assets), message = state === 'ready' ? undefined : embedStates[state];
  return <main className={`embed-frame ${palette} ${font} ${layout}`} aria-label={appearance.iframeTitle}>
    <header className="embed-brand">{logo && <img src={logo} alt="" width="32" height="32" />}<span>{appearance.productName}</span><span className="embed-view-label">{viewLabel}</span></header>
    {message ? <section className={`embed-state embed-state-${state}`} role={state === 'error' ? 'alert' : 'status'} aria-live="polite">
      <span className="embed-state-symbol" aria-hidden="true">{message.symbol}</span><h1>{message.title}</h1><p>{detail ?? message.detail}</p>
    </section> : <section className="embed-content"><h1>{title}</h1><p>{description}</p>{children}</section>}
    <footer className="embed-notices"><span>OpenSight · Apache-2.0</span><span>Data access permissions apply</span></footer>
  </main>;
}
