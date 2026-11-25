import { useEffect, useRef } from 'react';
import type Phaser from 'phaser';
import { EraManager } from './core/EraManager';
import { bindGamepad } from './core/GamepadBridge';
import { AchievementSystem } from './core/AchievementSystem';
import { SoundSynthesizer } from './core/SoundSynthesizer';
import { GAME_CONTAINER_ID } from './core/types';
import { createPhaserGame, destroyPhaserGame } from './game/PhaserGame';
import HUDContainer from './components/HUDContainer';
import TimelineSelector from './components/TimelineSelector';
import SoundUnlockNotice from './components/SoundUnlockNotice';
import TouchControls from './components/TouchControls';
import { bindInputModeTracking } from './core/InputMode';

/** Monta o canvas Phaser uma única vez (seguro sob StrictMode). */
function PhaserGame() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let game: Phaser.Game | null = null;
    let cancelled = false;
    // Texturas ASCII/pixel dependem de VT323 e Press Start 2P já carregadas.
    void document.fonts.ready.then(() => {
      if (cancelled || !containerRef.current) return;
      game = createPhaserGame(containerRef.current);
      // Gancho de depuração/testes E2E (apenas em dev).
      if ((process.env.NODE_ENV !== 'production')) (window as unknown as { __ERAS_GAME__?: Phaser.Game }).__ERAS_GAME__ = game;
    });
    // Celular: girar a tela / entrar em tela cheia muda o container depois do evento
    // de resize que o Phaser escuta, e o canvas ficava pequeno. Reajusta a cada mudança.
    const observer = new ResizeObserver(() => game?.scale.refresh());
    if (containerRef.current) observer.observe(containerRef.current);
    return () => {
      observer.disconnect();
      cancelled = true;
      if (game) destroyPhaserGame(game);
    };
  }, []);

  return <div id={GAME_CONTAINER_ID} ref={containerRef} className="absolute inset-0" />;
}

export default function App() {
  useEffect(() => {
    SoundSynthesizer.init();
    // Subscribes before broadcastInitial so it catches the starting era/state.
    const stopAchievements = AchievementSystem.init();
    const unbindKeys = EraManager.bindKeyboard();
    const unbindGamepad = bindGamepad();
    const unbindInputMode = bindInputModeTracking();
    EraManager.broadcastInitial();

    // AudioContext só pode iniciar após um gesto do usuário. O GamepadBridge despacha
    // keydown, então controle e teclado passam pelo mesmo desbloqueio.
    const unlockAudio = () => void SoundSynthesizer.resume();
    window.addEventListener('pointerdown', unlockAudio);
    window.addEventListener('keydown', unlockAudio);

    return () => {
      unbindKeys();
      unbindGamepad();
      unbindInputMode();
      stopAchievements();
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };
  }, []);

  return (
    <div className="w-screen h-screen flex flex-col bg-black overflow-hidden">
      <div className="relative flex-1 min-h-0">
        <PhaserGame />
        <HUDContainer />
        <TouchControls />
      </div>
      <TimelineSelector />
      <SoundUnlockNotice />
    </div>
  );
}
