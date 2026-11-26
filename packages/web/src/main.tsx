import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
// App-only surfaces stay out of the single-file embed response budget.
import './sign-in.css';
import './data-section.css';
import './style.css';
import './app-chrome.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
createRoot(root).render(<StrictMode><App /></StrictMode>);
