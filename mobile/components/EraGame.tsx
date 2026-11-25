'use dom';

import { useEffect } from 'react';
import App from '../game/App';
import '../game/index.css';

const FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;600;700;800&family=Press+Start+2P&family=VT323&display=swap';

/**
 * Componente DOM do Expo: roda o jogo original (Phaser + HUDs React) dentro de uma
 * WebView, sem reescrever nada. Toda a lógica das 10 eras fica em ../game.
 */
export default function EraGame(_props: { dom?: import('expo/dom').DOMProps }) {
  useEffect(() => {
    if (document.getElementById('eras-fonts')) return;
    const link = document.createElement('link');
    link.id = 'eras-fonts';
    link.rel = 'stylesheet';
    link.href = FONTS_HREF;
    document.head.appendChild(link);
    document.body.style.margin = '0';
    document.body.style.background = '#000';
  }, []);

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000' }}>
      <App />
    </div>
  );
}
