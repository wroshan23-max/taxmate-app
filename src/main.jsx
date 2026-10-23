import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './contexts/AuthContext';
import { SettingsProvider } from './contexts/SettingsContext';
import App from './App';
import './index.css';
import { registerSW } from './lib/pwa';

// The app's address is now app.taxmatesolutions.com — old vercel links (invites, /join/…, /verify/…) move there with the same path.
const NEW_HOST = 'app.taxmatesolutions.com';
const moving = window.location.hostname === 'taxmate-app.vercel.app';
if (moving) window.location.replace(`https://${NEW_HOST}${window.location.pathname}${window.location.search}${window.location.hash}`);
else registerSW();

if (!moving) createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <SettingsProvider>
          <App />
        </SettingsProvider>
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: { fontFamily: 'Segoe UI, Arial, sans-serif', fontSize: '13px' },
          }}
        />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
