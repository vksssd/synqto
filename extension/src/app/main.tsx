// ─── App React Entry Point ───

import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { setupChromePolyfill } from '@/core/chrome-polyfill';
import './synqtoDesign.css';

// Ensure chrome API polyfills exist for standalone web mode
setupChromePolyfill();

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
