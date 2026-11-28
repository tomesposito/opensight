import { isEmbedSurface } from '@opensight/embedding-sdk/surface';
import { createRoot } from 'react-dom/client';
import { EmbeddedApp } from './EmbeddedApp.js';
import { EmbedTheme } from './EmbedTheme.js';
import type { BrandedEmbedShell } from './embed-transport.js';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import './data-section.css';
import './style.css';
import './app-chrome.css';
import './embed-app-theme.css';

const element = document.getElementById('opensight-embed-data');
const shell = element?.textContent ? JSON.parse(element.textContent) as BrandedEmbedShell : undefined;
element?.remove();
const bootstrap = new URLSearchParams(window.location.hash.slice(1)).get('bootstrap') ?? '';
window.history.replaceState(null, '', window.location.pathname);
createRoot(document.getElementById('root')!).render(shell?.fullApp && shell.appearance && isEmbedSurface(shell.surface)
  ? <EmbedTheme tokens={shell.appearance.tokens}><EmbeddedApp shell={shell} bootstrap={bootstrap} /></EmbedTheme> : <p role="alert">EMBED_SCOPE_DENIED</p>);
