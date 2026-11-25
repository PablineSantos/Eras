/** Tela de pausa (menu de console na cor da era): continuar ou reiniciar a jornada (com confirmação). */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { EventBus } from '../../core/EventBus';
import { ALL_ERAS } from '../../core/types';
import type { EraConfig } from '../../core/types';
import { ERA_ACCENTS, controlHints } from './shared';
import { useInputMode } from './hooks';
import { restartGame } from './VictoryScreen';
import { CrtOverlay, EraStripe, GameMenu, KeyCap, PixelPanel } from './screenKit';

/** Modo inicial da próxima abertura (o botão ↻ da timeline abre já pedindo confirmação). */
let openWithConfirm = false;
/** Tela já aberta: o botão ↻ só troca para a confirmação. */
const confirmListeners = new Set<() => void>();

export function pauseGame(confirmRestart = false): void {
  const state = EventBus.getLast('GAME_STATE_CHANGED')?.state;
  if (state === 'paused' && confirmRestart) confirmListeners.forEach((fn) => fn());
  if (state !== 'playing') return;
  openWithConfirm = confirmRestart;
  EventBus.emit('PLAY_SFX', { sound: 'click' });
  EventBus.emit('GAME_STATE_CHANGED', { state: 'paused' });
}

export function resumeGame(): void {
  if (EventBus.getLast('GAME_STATE_CHANGED')?.state !== 'paused') return;
  setOverlayPause(null);
  EventBus.emit('PLAY_SFX', { sound: 'click' });
  EventBus.emit('GAME_STATE_CHANGED', { state: 'playing' });
}

// ---------------------------------------------------------------------------
// Overlay pause: freezes gameplay under a modal (artifact card, museum) WITHOUT
// showing the pause menu. The timer stops too (AchievementSystem only counts 'playing').
// ---------------------------------------------------------------------------

export type OverlayPauseReason = 'artifact' | 'museum';

let overlayPause: OverlayPauseReason | null = null;
const overlayListeners = new Set<() => void>();

function setOverlayPause(reason: OverlayPauseReason | null): void {
  if (overlayPause === reason) return;
  overlayPause = reason;
  overlayListeners.forEach((fn) => fn());
}

/** Pauses for an overlay if the game is running. Returns true when it did pause. */
export function pauseForOverlay(reason: OverlayPauseReason): boolean {
  if (EventBus.getLast('GAME_STATE_CHANGED')?.state !== 'playing') return false;
  setOverlayPause(reason);
  EventBus.emit('GAME_STATE_CHANGED', { state: 'paused' });
  return true;
}

/** Resumes a pause started by pauseForOverlay (no-op otherwise, e.g. the player paused manually). */
export function resumeFromOverlay(): void {
  if (!overlayPause) return;
  setOverlayPause(null);
  if (EventBus.getLast('GAME_STATE_CHANGED')?.state === 'paused') {
    EventBus.emit('GAME_STATE_CHANGED', { state: 'playing' });
  }
}

export function getOverlayPause(): OverlayPauseReason | null {
  return overlayPause;
}

/** Current overlay pause reason (null when none) — React hook. */
export function useOverlayPause(): OverlayPauseReason | null {
  return useSyncExternalStore(
    (fn) => {
      overlayListeners.add(fn);
      return () => overlayListeners.delete(fn);
    },
    getOverlayPause,
  );
}

export function togglePause(): void {
  const state = EventBus.getLast('GAME_STATE_CHANGED')?.state;
  if (state === 'playing') pauseGame();
  else if (state === 'paused') resumeGame();
}

const DANGER = '#F43F5E';
/** Museum entries use the same gold across menus. */
const MUSEUM = '#FACC15';

export default function PauseScreen({ config }: { config: EraConfig }) {
  const inputMode = useInputMode();
  const [confirm, setConfirm] = useState(openWithConfirm);
  const accent = ERA_ACCENTS[config.id];
  const eraNumber = ALL_ERAS.indexOf(config.id) + 1;

  useEffect(() => {
    const show = () => setConfirm(true);
    confirmListeners.add(show);
    return () => {
      confirmListeners.delete(show);
    };
  }, []);

  // Esc: sai da confirmação ou volta ao jogo (↑↓/Enter ficam com o GameMenu).
  useEffect(() => {
    openWithConfirm = false;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.key !== 'Escape') return;
      e.preventDefault();
      if (confirm) setConfirm(false);
      else resumeGame();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirm]);

  const items = useMemo(
    () =>
      confirm
        ? [
            { label: 'NÃO, VOLTAR', onSelect: () => { EventBus.emit('PLAY_SFX', { sound: 'click' }); setConfirm(false); } },
            { label: 'SIM, REINICIAR', onSelect: restartGame, color: DANGER },
          ]
        : [
            { label: 'CONTINUAR', onSelect: resumeGame },
            { label: 'MUSEU & REFERÊNCIAS', onSelect: () => EventBus.emit('CODEX_OPENED', { tab: 'codex' }), color: MUSEUM },
            { label: 'REINICIAR JORNADA', onSelect: () => { EventBus.emit('PLAY_SFX', { sound: 'click' }); setConfirm(true); }, color: DANGER },
          ],
    [confirm],
  );

  return (
    <motion.div
      className="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center overflow-y-auto overflow-x-hidden bg-[#05060A]/80 p-4 text-slate-100 backdrop-blur-[2px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
    >
      <motion.div
        className="relative w-full max-w-md"
        initial={{ y: 12, scale: 0.96 }}
        animate={{ y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 320, damping: 24 }}
      >
        <div className="mb-4 text-center">
          <div
            className="font-pixel text-[32px] leading-none text-white sm:text-[40px]"
            style={{ textShadow: `3px 3px 0 ${confirm ? DANGER : accent}, 6px 6px 0 #000` }}
          >
            {confirm ? 'CERTEZA?' : 'PAUSA'}
          </div>
        </div>

        <PixelPanel accent={confirm ? DANGER : accent}>
          {/* Cartucho da era atual */}
          <div className="flex items-center gap-3">
            <div
              className="flex h-12 w-12 shrink-0 items-center justify-center font-pixel text-[14px] text-[#07080D]"
              style={{ background: accent, boxShadow: `0 0 18px ${accent}88, inset 0 -4px 0 rgba(0,0,0,.25)` }}
            >
              {String(eraNumber).padStart(2, '0')}
            </div>
            <div className="min-w-0 text-left">
              <div className="font-pixel text-[9px] text-slate-400">ERA {eraNumber}/10</div>
              <div className="mt-1 truncate font-terminal text-[26px] leading-none text-white">
                {config.year} · {config.name}
              </div>
            </div>
          </div>
          <EraStripe height={4} className="mt-3 opacity-80" />

          <AnimatePresence mode="wait" initial={false}>
            {confirm ? (
              <motion.p
                key="confirm"
                className="mt-4 font-terminal text-[20px] leading-tight text-rose-200"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                Você volta para 1958 e perde moedas, artefatos e checkpoints.
              </motion.p>
            ) : (
              <motion.ul
                key="hints"
                className="mt-4 grid grid-cols-1 gap-x-4 gap-y-1.5 font-terminal text-[19px] leading-tight sm:grid-cols-2"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                {controlHints(config, inputMode).map((h) => (
                  <li key={h.keys + h.action} className="flex items-center gap-2 text-slate-300">
                    <KeyCap accent={accent}>{h.keys}</KeyCap>
                    {h.action}
                  </li>
                ))}
              </motion.ul>
            )}
          </AnimatePresence>

          <div className="mt-5">
            <GameMenu items={items} accent={accent} />
          </div>
        </PixelPanel>

        <div className="mt-3 text-center font-pixel text-[9px] text-slate-400">
          {inputMode === 'touch' ? (
            'TOQUE PARA ESCOLHER'
          ) : (
            <>
              ↑↓ ESCOLHER · {inputMode === 'gamepad' ? 'A' : 'ENTER'} CONFIRMAR ·{' '}
              {inputMode === 'gamepad' ? 'START' : 'ESC'} {confirm ? 'CANCELAR' : 'VOLTAR'}
            </>
          )}
        </div>
      </motion.div>
      <CrtOverlay strength={0.7} />
    </motion.div>
  );
}
