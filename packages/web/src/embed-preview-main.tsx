import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { EmbedFrame, embedAsset, embedStates, type EmbedBrand } from './EmbedFrame.js';
import { previewAssets, previewBrands } from './embed-preview-fixtures.js';
import './embed.css';

const states = ['loading', 'empty', 'error', 'expired'] as const;
const params = new URLSearchParams(window.location.search);
const frameState = states.find(s => s === params.get('state')) ?? 'loading';
const initialBrand = params.get('brand') === 'atlas' ? 'atlas' : 'opensight';
const palettes = ['navy', 'teal', 'plum'] as const;
function PreviewFrame() {
  const base = previewBrands[initialBrand], appearance: EmbedBrand = { ...base, palette: palettes.find(p => p === params.get('palette')) ?? base.palette };
  useEffect(() => {
    document.title = appearance.iframeTitle;
    const src = embedAsset(appearance.faviconAssetId, previewAssets);
    if (!src) return;
    const link = document.createElement('link'); link.rel = 'icon'; link.type = 'image/png'; link.href = src; document.head.append(link);
    return () => link.remove();
  }, [appearance.iframeTitle, appearance.faviconAssetId]);
  return <EmbedFrame state={frameState} appearance={appearance} assets={previewAssets} />;
}
function Preview() {
  const [brand, setBrand] = useState<'opensight' | 'atlas'>(initialBrand);
  const [palette, setPalette] = useState<EmbedBrand['palette']>(previewBrands[initialBrand].palette);
  const appearance = previewBrands[brand];
  return <main className="embed-preview">
    <header className="embed-preview-head"><p className="embed-preview-eyebrow">Embedding · Offline fixture</p><h1>Embed appearance preview</h1>
      <p className="embed-preview-description">Illustrative states with public sample branding. These frames have no active session or dashboard data. Live embedding needs a hosted API.</p>
      <div className="embed-preview-controls"><label>Branding<select aria-label="Branding" value={brand} onChange={e => {
        const next = e.target.value === 'atlas' ? 'atlas' : 'opensight'; setBrand(next); setPalette(previewBrands[next].palette);
      }}><option value="opensight">OpenSight default</option><option value="atlas">Atlas sample · logo, favicon, compact</option></select></label>
        <label>Palette<select aria-label="Palette" value={palette} onChange={e => setPalette(palettes.find(p => p === e.target.value) ?? 'navy')}>
          <option value="navy">Navy</option><option value="teal">Teal</option><option value="plum">Plum</option></select></label></div>
    </header>
    <div className="embed-preview-grid">{states.map(state => {
      const src = new URL(window.location.href); src.search = new URLSearchParams({ frame: 'true', state, brand, palette }).toString(); src.hash = '';
      return <section className="embed-preview-card" key={state} data-preview-state={state}><h2>{state === 'error' ? 'Permission error' : state === 'expired' ? 'Expiry' : state}</h2>
        <iframe src={src.href} title={`${appearance.iframeTitle} — ${embedStates[state].title}`} />
      </section>;
    })}</div>
    <p className="embed-preview-note">Theme choices preserve permissions, error messages and OpenSight notices. No authoring, export, download or saved reader state. Visual fidelity not measured.</p>
  </main>;
}
createRoot(document.getElementById('root')!).render(params.get('frame') === 'true' ? <PreviewFrame /> : <Preview />);
