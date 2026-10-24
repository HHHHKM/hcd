import React from 'react';
import { createRoot } from 'react-dom/client';
import ApplicationRouter from '../packages/web/src/app/ApplicationRouter';
import '../packages/web/src/styles.css';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ApplicationRouter />
  </React.StrictMode>,
);
