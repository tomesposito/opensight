/** Wire values for tenant configuration and the API-served frame shell. */
export interface EmbedDesignTokens {
  surface?: string;
  text?: string;
  accent?: string;
  chartPaletteSeed?: string;
  fontFamily?: 'system' | 'sans' | 'serif' | 'mono';
  radius?: number;
  density?: 'comfortable' | 'compact';
}

export function isEmbedDesignTokens(raw: unknown): raw is EmbedDesignTokens {
  if (raw === null || typeof raw !== 'object') return false;
  const prototype: unknown = Object.getPrototypeOf(raw);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.entries(raw).every(([name, value]: [string, unknown]) => {
    switch (name) {
      case 'surface':
      case 'text':
      case 'accent':
      case 'chartPaletteSeed':
        return typeof value === 'string' && value.length === 7 && /^#[a-f\d]{6}$/i.test(value);
      case 'fontFamily':
        return value === 'system' || value === 'sans' || value === 'serif' || value === 'mono';
      case 'radius':
        return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 24;
      case 'density':
        return value === 'compact' || value === 'comfortable';
      default:
        return false;
    }
  });
}
