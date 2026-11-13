import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import './shipart.css';
import { ShipArt } from './ShipArt';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ShipArt />
  </StrictMode>,
);
