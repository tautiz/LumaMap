import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { LanguageProvider } from './i18n';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

// ?camera=<id>: the phone camera page for calibrating the wall photo (opened from a QR code). Loaded
// separately, so the phone does not load the whole editor.
const CameraPage = React.lazy(() => import('./components/CameraPage'));
const cameraId = new URLSearchParams(window.location.search).get('camera');

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <LanguageProvider>
      {cameraId ? (
        <React.Suspense fallback={null}>
          <CameraPage computerId={cameraId} />
        </React.Suspense>
      ) : (
        <App />
      )}
    </LanguageProvider>
  </React.StrictMode>
);
// Lets the app open without internet after the first visit (see public/sw.js). Only in the built
// app: in development it would serve stale files.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(e => console.warn('Offline support unavailable', e));
  });
}
