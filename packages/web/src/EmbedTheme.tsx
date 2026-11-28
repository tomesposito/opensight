import { isEmbedDesignTokens, type EmbedDesignTokens } from '@opensight/embedding-sdk/appearance';
import { createContext, useContext, useMemo, type CSSProperties, type ReactNode } from 'react';
import type { FixtureVisual } from './model.js';
import { FONTS, LIGHT_THEME } from './themes.js';

const fonts = { system: FONTS[0], sans: FONTS[1], serif: FONTS[2], mono: FONTS[3] };
const TokenContext = createContext<EmbedDesignTokens | undefined>(undefined);

/** The same boundary surrounds hosted fixed frames, FullApp and the offline fixture. */
export function EmbedTheme({ tokens, children }: { tokens?: EmbedDesignTokens; children: ReactNode }) {
  if (tokens === undefined) return children;
  if (!isEmbedDesignTokens(tokens)) return <p role="alert">EMBED_DESIGN_TOKENS_INVALID</p>;
  if (!Object.keys(tokens).length) return children;
  const style = {
    '--embed-surface': tokens.surface,
    '--embed-text': tokens.text,
    '--embed-token-accent': tokens.accent,
    '--embed-chart-seed': tokens.chartPaletteSeed,
    '--embed-font': tokens.fontFamily && fonts[tokens.fontFamily],
    '--embed-radius': tokens.radius === undefined ? undefined : `${tokens.radius}px`,
    '--embed-space': tokens.density && (tokens.density === 'compact' ? '4px' : '8px'),
  } as CSSProperties;
  return <TokenContext.Provider value={tokens}><div className="embed-theme" data-embed-tokens={Object.keys(tokens).join(' ')} style={style}>{children}</div></TokenContext.Provider>;
}

/** ECharts needs concrete colors, including for SVG graphics. Apply the same
 * validated values to the compiler input without editing the analysis definition. */
export function useEmbedVisual(visual: FixtureVisual): FixtureVisual {
  const tokens = useContext(TokenContext);
  return useMemo(() => {
    if (!tokens || !(tokens.surface || tokens.text || tokens.fontFamily || tokens.chartPaletteSeed)) return visual;
    const base = visual.theme ?? LIGHT_THEME;
    const seed = tokens.chartPaletteSeed;
    return { ...visual, theme: {
      surface: tokens.surface ?? base.surface, background: tokens.surface ?? base.background,
      textColor: tokens.text ?? base.textColor, fontFamily: tokens.fontFamily ? fonts[tokens.fontFamily] : base.fontFamily,
      palette: seed ? [seed, ...base.palette.slice(1).filter(color => color.toLowerCase() !== seed.toLowerCase())] : base.palette,
    } };
  }, [visual, tokens]);
}
