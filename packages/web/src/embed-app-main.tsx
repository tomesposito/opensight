import { isEmbedSurface } from '@opensight/embedding-sdk/surface';
import { createRoot } from 'react-dom/client';
import { EmbeddedApp } from './EmbeddedApp.js';
import type { EmbedShell } from './embed-transport.js';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import './data-section.css';
import './style.css';
import './app-chrome.css';

const element = document.getElementById('opensight-embed-data');
const shell = element?.textContent ? JSON.parse(element.textContent) as EmbedShell : undefined;
element?.remove();
const bootstrap = new URLSearchParams(window.location.hash.slice(1)).get('bootstrap') ?? '';
window.history.replaceState(null, '', window.location.pathname);
createRoot(document.getElementById('root')!).render(shell?.fullApp && isEmbedSurface(shell.surface) ? <EmbeddedApp shell={shell} bootstrap={bootstrap} /> : <p role="alert">EMBED_SCOPE_DENIED</p>);
