import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { EmbedFrame, embedAsset, embedStates, embedTitle, type EmbedBrand } from './EmbedFrame.js';
import { EmbedTheme } from './EmbedTheme.js';
import { previewAssets, previewBrand, previewBrands } from './embed-preview-fixtures.js';
import './embed.css';
import './embed-preview-host.css';

const states = ['loading', 'empty', 'error', 'expired'] as const;
const params = new URLSearchParams(window.location.search);
const frameState = states.find(s => s === params.get('state')) ?? 'loading';
function brandName(value: string | null) { return value === 'atlas' || value === 'cedar' ? value : 'opensight'; }
const initialBrand = brandName(params.get('brand'));
const initialHost = params.get('host') === 'dark' ? 'dark' : 'light';
const palettes = ['navy', 'teal', 'plum'] as const;
function PreviewFrame() {
  const base = previewBrand(initialBrand, initialHost), appearance: EmbedBrand = { ...base, palette: palettes.find(p => p === params.get('palette')) ?? base.palette };
  useEffect(() => {
    document.title = embedTitle(appearance);
    const src = embedAsset(appearance.faviconAssetId, previewAssets);
    if (!src) return;
    const link = document.createElement('link'); link.rel = 'icon'; link.type = 'image/png'; link.href = src; document.head.append(link);
    return () => link.remove();
  }, [appearance.iframeTitle, appearance.faviconAssetId]);
  return <EmbedTheme tokens={appearance.tokens}><EmbedFrame state={frameState} appearance={appearance} assets={previewAssets} /></EmbedTheme>;
}
function Preview() {
  const [brand, setBrand] = useState<keyof typeof previewBrands>(initialBrand);
  const [host, setHost] = useState<'light' | 'dark'>(initialHost);
  const [palette, setPalette] = useState<EmbedBrand['palette']>(previewBrands[initialBrand].palette);
  const appearance = previewBrand(brand, host);
  return <main className="embed-preview" data-host={host}>
    <header className="embed-preview-head"><p className="embed-preview-eyebrow">Embedding · Offline fixture</p><h1>Embed appearance preview</h1>
      <p className="embed-preview-description">Illustrative states with public sample branding. These frames have no active session or dashboard data. Live embedding needs a hosted API.</p>
      <div className="embed-preview-controls"><label>Branding<select aria-label="Branding" value={brand} onChange={e => {
        const next = brandName(e.target.value); setBrand(next); setPalette(previewBrands[next].palette);
      }}><option value="opensight">OpenSight default</option><option value="atlas">Atlas sample · logo, favicon, compact</option><option value="cedar">Cedar sample · design tokens</option></select></label>
        {brand !== 'cedar' && <label>Palette<select aria-label="Palette" value={palette} onChange={e => setPalette(palettes.find(p => p === e.target.value) ?? 'navy')}>
          <option value="navy">Navy</option><option value="teal">Teal</option><option value="plum">Plum</option></select></label>}
        <label>Host context<select value={host} onChange={e => setHost(e.target.value === 'dark' ? 'dark' : 'light')}>
          <option value="light">Light</option><option value="dark">Dark</option></select></label></div>
    </header>
    <div className="embed-preview-grid">{states.map(state => {
      const src = new URL(window.location.href); src.search = new URLSearchParams({ frame: 'true', state, brand, palette, host }).toString(); src.hash = '';
      return <section className="embed-preview-card" key={state} data-preview-state={state}><h2>{state === 'error' ? 'Permission error' : state === 'expired' ? 'Expiry' : state}</h2>
        <iframe src={src.href} title={`${appearance.iframeTitle} — ${embedStates[state].title}`} />
      </section>;
    })}</div>
    <p className="embed-preview-note">Theme choices preserve permissions and error messages. A fully branded tenant (its own product name and logo) gets frames without OpenSight notices; other frames keep them. No authoring, export, download or saved reader state. Visual fidelity not measured.</p>
  </main>;
}
createRoot(document.getElementById('root')!).render(params.get('frame') === 'true' ? <PreviewFrame /> : <Preview />);
