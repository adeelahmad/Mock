import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/dm-sans/opsz.css';
import '@fontsource-variable/dm-sans/opsz-italic.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import './styles/tokens.css';
import './styles/app.css';
import { AppProvider } from './app/store.tsx';
import App from './app/App.tsx';
import { openRepo } from './db/open.ts';
import { registerPwa } from './app/pwa.ts';

const repo = openRepo();
void registerPwa();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppProvider repo={repo}>
      <App />
    </AppProvider>
  </React.StrictMode>,
);
