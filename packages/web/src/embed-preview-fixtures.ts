import { defaultEmbedBrand, type EmbedBrand } from './EmbedFrame.js';

/** Synthetic raster and labels only. This fixture is never an API configuration. */
export const previewAssets = { 'atlas-logo': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAARklEQVR4nGMQSYn9P5CYYdQBow4YdQA+SWqBUQcMLwcQSlSjDhh1AM0dQA4YdcDwcsCAJ8JRB4w6gK4OoAcedcCoAwbcAQDMw3Q4K3c14wAAAABJRU5ErkJggg==', 'atlas-favicon': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAARklEQVR4nGMQSYn9P5CYYdQBow4YdQA+SWqBUQcMLwcQSlSjDhh1AM0dQA4YdcDwcsCAJ8JRB4w6gK4OoAcedcCoAwbcAQDMw3Q4K3c14wAAAABJRU5ErkJggg==' };
export const atlasBrand: EmbedBrand = { palette: 'teal', font: 'sans', layout: 'compact', productName: 'Atlas Analytics', iframeTitle: 'Atlas analytics dashboard', logoAssetId: 'atlas-logo', faviconAssetId: 'atlas-favicon' };
export const previewBrands = { opensight: defaultEmbedBrand, atlas: atlasBrand };
