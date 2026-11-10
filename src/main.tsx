import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import App from './App';
import './styles.css';
import './liquid-glass.css';

async function start() {
  if (import.meta.env.MODE === 'web' && !window.phonegest) {
    const { createWebBridge } = await import('./web/bridge');
    window.phonegest = createWebBridge();
  }
  ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
}

void start();
