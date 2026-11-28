import { defaultEmbedBrand, type EmbedBrand } from './EmbedFrame.js';

/** Synthetic raster and labels only. This fixture is never an API configuration. */
export const previewAssets = { 'atlas-logo': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAARklEQVR4nGMQSYn9P5CYYdQBow4YdQA+SWqBUQcMLwcQSlSjDhh1AM0dQA4YdcDwcsCAJ8JRB4w6gK4OoAcedcCoAwbcAQDMw3Q4K3c14wAAAABJRU5ErkJggg==', 'atlas-favicon': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAARklEQVR4nGMQSYn9P5CYYdQBow4YdQA+SWqBUQcMLwcQSlSjDhh1AM0dQA4YdcDwcsCAJ8JRB4w6gK4OoAcedcCoAwbcAQDMw3Q4K3c14wAAAABJRU5ErkJggg==' };
export const atlasBrand: EmbedBrand = { palette: 'teal', font: 'sans', layout: 'compact', productName: 'Atlas Analytics', iframeTitle: 'Atlas analytics dashboard', logoAssetId: 'atlas-logo', faviconAssetId: 'atlas-favicon' };
export const cedarBrand: EmbedBrand = {
  ...defaultEmbedBrand, productName: 'Cedar Analytics', iframeTitle: 'Cedar analytics dashboard',
  tokens: { surface: '#fffaf1', text: '#302b25', accent: '#814527', chartPaletteSeed: '#ae633b', fontFamily: 'serif', radius: 10, density: 'compact' },
};
const cedarDark: EmbedBrand = { ...cedarBrand, tokens: {
  ...cedarBrand.tokens, surface: '#292521', text: '#f4e7d6', accent: '#f3bc8e', chartPaletteSeed: '#e59963',
} };
export const previewBrands = { opensight: defaultEmbedBrand, atlas: atlasBrand, cedar: cedarBrand };
export function previewBrand(name: keyof typeof previewBrands, host: 'light' | 'dark') {
  return name === 'cedar' && host === 'dark' ? cedarDark : previewBrands[name];
}
