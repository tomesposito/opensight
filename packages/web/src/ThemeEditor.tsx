import type { Dispatch } from 'react';
import type { AuthorAction, AuthorDraft, AuthorVisual } from './authoring.js';
import { FONTS, PALETTES, LIGHT_THEME, DARK_THEME } from './themes.js';
export function ThemeEditor({ draft, visual, dispatch }: { draft: AuthorDraft; visual?: AuthorVisual; dispatch: Dispatch<AuthorAction> }) {
  const theme = draft.theme ?? LIGHT_THEME;
  return <>
    {visual && <details className="property-section"><summary>Visual palette</summary>
      <label>Palette override<select aria-label="Visual palette override" value={visual.palette ? 'custom' : 'inherit'} onChange={e => dispatch({ type: 'palette', palette: e.target.value === 'inherit' ? undefined : [...PALETTES[e.target.value as keyof typeof PALETTES]] })}>
        <option value="inherit">Inherit analysis palette</option><option value="custom" disabled>Custom palette</option>{Object.keys(PALETTES).map(name => <option key={name}>{name}</option>)}
      </select></label>
      {visual.palette && <div className="color-inputs">{visual.palette.map((color, i) => <label key={i}>Color {i + 1}<input type="color" value={color} onChange={e => dispatch({ type: 'palette', palette: visual.palette!.map((v, j) => i === j ? e.target.value : v) })} /></label>)}</div>}
    </details>}
    <details className="property-section"><summary data-author-control="theme">Analysis theme</summary>
      <div className="theme-presets"><button type="button" onClick={() => dispatch({ type: 'theme', theme: structuredClone(LIGHT_THEME) })}>Light theme</button><button type="button" onClick={() => dispatch({ type: 'theme', theme: structuredClone(DARK_THEME) })}>Dark theme</button></div>
      <label>Analysis palette<select value="" onChange={e => dispatch({ type: 'theme', theme: { ...theme, palette: [...PALETTES[e.target.value as keyof typeof PALETTES]] } })}><option value="" disabled>Choose palette…</option>{Object.keys(PALETTES).map(name => <option key={name}>{name}</option>)}</select></label>
      <div className="color-inputs">{theme.palette.map((color, i) => <label key={i}>Analysis color {i + 1}<input type="color" value={color} onChange={e => dispatch({ type: 'theme', theme: { ...theme, palette: theme.palette.map((v, j) => i === j ? e.target.value : v) } })} /></label>)}</div>
      <label>Analysis font<select value={theme.fontFamily} onChange={e => dispatch({ type: 'theme', theme: { ...theme, fontFamily: e.target.value } })}>{FONTS.map(font => <option key={font}>{font}</option>)}</select></label>
      {(['background', 'surface', 'textColor'] as const).map(key => <label key={key}>{key === 'textColor' ? 'Text color' : key === 'surface' ? 'Visual background' : 'Canvas background'}<input type="color" value={theme[key]} onChange={e => dispatch({ type: 'theme', theme: { ...theme, [key]: e.target.value } })} /></label>)}
      <p>The analysis theme applies to this analysis. Imported secondary resources retain their original themes.</p>
    </details>
  </>;
}
