export const PALETTES = {
  coastal: ['#157f88', '#e5a046', '#4f6fc6', '#b76b88', '#8b9465'],
  vivid: ['#5965d8', '#de6a47', '#26968b', '#b25ba8', '#c7a327'],
  dusk: ['#8cb9ff', '#ffbd75', '#67d8c7', '#e59ed8', '#b2cb82'],
} as const;
export const FONTS = ['system-ui, sans-serif', 'Arial, sans-serif', 'Georgia, serif', 'monospace'] as const;
export interface AnalysisTheme { palette: string[]; fontFamily: string; background: string; surface: string; textColor: string }
export const LIGHT_THEME: AnalysisTheme = { palette: [...PALETTES.coastal], fontFamily: FONTS[0], background: '#f3f6f7', surface: '#ffffff', textColor: '#19384a' };
export const DARK_THEME: AnalysisTheme = { palette: [...PALETTES.dusk], fontFamily: FONTS[0], background: '#141e2c', surface: '#202e40', textColor: '#e7eef7' };
export const colorValid = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
export const paletteValid = (v: unknown): v is string[] => Array.isArray(v) && v.length >= 1 && v.length <= 12 && v.every(colorValid);
export function themeValid(v: unknown): v is AnalysisTheme {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const t = v as Record<string, unknown>;
  return Object.keys(t).every(k => ['palette', 'fontFamily', 'background', 'surface', 'textColor'].includes(k)) && paletteValid(t.palette) && FONTS.some(f => f === t.fontFamily) && [t.background, t.surface, t.textColor].every(colorValid);
}
