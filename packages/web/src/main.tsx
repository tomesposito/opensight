import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import './style.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
createRoot(root).render(<StrictMode><App /></StrictMode>);
