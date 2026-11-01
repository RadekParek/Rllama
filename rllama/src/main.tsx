import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

// Capacitor reports safe-area insets as 0 on Android WebView, so the shell adds
// a fixed inset when it runs natively.
if (typeof window !== 'undefined' && 'Capacitor' in window) {
  document.documentElement.classList.add('native');
}

const root = document.getElementById('root');
if (!root) {
  throw new Error('missing #root');
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
