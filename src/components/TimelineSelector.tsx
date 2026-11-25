/**
 * Barra da linha do tempo (1958 → 2026) em estilo "seleção de fase": cada era é
 * um slot pixelado ligado por uma trilha. Reflete a era atual (indicador
 * deslizante com layoutId) e permite clique; teclas 1..0 ficam com o EraManager.
 */
import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { BookOpen, Lock, Pause, Play, RotateCcw } from 'lucide-react';
import { EventBus } from '../core/EventBus';
import { EraManager } from '../core/EraManager';
import { EraId } from '../core/types';
import { useEraConfig, useGameState, useInputMode, useUnlockedEras } from './eras-hud/hooks';
import { pauseGame, togglePause } from './eras-hud/PauseScreen';
import { ERA_ACCENTS } from './eras-hud/shared';

const hotkey = (id: EraId) => (id === EraId.NEON_2026 ? '0' : String(id));

/** Cantos recortados em pixel (mesmo recorte dos painéis das telas). */
const NOTCH = 'polygon(5px 0, calc(100% - 5px) 0, 100% 5px, 100% calc(100% - 5px), calc(100% - 5px) 100%, 5px 100%, 0 calc(100% - 5px), 0 5px)';

const ctrlBtn =
  'flex h-8 w-8 items-center justify-center bg-[#151826] text-slate-200 outline-none transition-colors hover:bg-[#1F2335]';

export function TimelineSelector() {
  const mode = useInputMode();
  const isPad = mode === 'gamepad';
  const current = useEraConfig();
  const unlocked = useUnlockedEras();
  const gameState = useGameState();
  const inGame = gameState === 'playing' || gameState === 'paused';
  const configs = EraManager.getAllConfigs();
  const accent = ERA_ACCENTS[current.id];
  const itemRefs = useRef<Partial<Record<EraId, HTMLButtonElement | null>>>({});

  // Mantém a era atual visível em telas estreitas.
  useEffect(() => {
    itemRefs.current[current.id]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [current.id]);

  const select = (id: EraId) => {
    if (id === current.id) return;
    EventBus.emit('PLAY_SFX', { sound: 'click' });
    EraManager.setEra(id, 'timeline');
  };

  return (
    <nav
      aria-label="Linha do tempo das eras"
      className="eras-timeline-zoom relative h-[84px] shrink-0 select-none bg-[#07080D]"
      style={{ boxShadow: `0 -1px 24px ${accent}22` }}
    >
      {/* Scanlines discretas */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'repeating-linear-gradient(180deg, transparent 0 2px, rgba(255,255,255,.025) 2px 3px)' }}
      />
      <div className="relative flex h-full items-stretch gap-1.5 overflow-x-auto px-2 pb-2 pt-[9px] [scrollbar-width:thin]">
        {inGame && (
          <div className="flex shrink-0 flex-col justify-center gap-1 pr-1">
            <button
              type="button"
              tabIndex={-1}
              onPointerDown={(e) => e.preventDefault()}
              onClick={togglePause}
              title={gameState === 'paused' ? 'Continuar (Esc / P)' : 'Pausar (Esc / P)'}
              aria-label={gameState === 'paused' ? 'Continuar' : 'Pausar'}
              className={ctrlBtn}
              style={{ clipPath: NOTCH, boxShadow: `inset 0 0 0 2px ${accent}66, inset 0 -3px 0 ${accent}44` }}
            >
              {gameState === 'paused' ? <Play size={13} fill="currentColor" /> : <Pause size={13} fill="currentColor" />}
            </button>
            <button
              type="button"
              tabIndex={-1}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => pauseGame(true)}
              title="Reiniciar jornada"
              aria-label="Reiniciar jornada"
              className={ctrlBtn}
              style={{ clipPath: NOTCH, boxShadow: 'inset 0 0 0 2px rgba(244,63,94,.45), inset 0 -3px 0 rgba(244,63,94,.3)' }}
            >
              <RotateCcw size={13} />
            </button>
          </div>
        )}
        {inGame && (
          <button
            type="button"
            tabIndex={-1}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => EventBus.emit('CODEX_OPENED', { tab: 'codex' })}
            title="Museu & Referências Históricas [M]"
            aria-label="Abrir Museu & Referências Históricas"
            className="flex w-11 shrink-0 flex-col items-center justify-center gap-1.5 bg-[#151826] text-[#FACC15] outline-none transition-colors hover:bg-[#1F2335]"
            style={{ clipPath: NOTCH, boxShadow: 'inset 0 0 0 2px rgba(250,204,21,.5), inset 0 -3px 0 rgba(250,204,21,.3)' }}
          >
            <BookOpen size={16} />
            {mode !== 'touch' && <span className="font-pixel text-[8px] leading-none">{isPad ? 'SEL' : '[M]'}</span>}
          </button>
        )}
        {configs.map((cfg, i) => {
          const active = cfg.id === current.id;
          const isUnlocked = unlocked.includes(cfg.id);
          const a = ERA_ACCENTS[cfg.id];
          const next = configs[i + 1];
          return (
            <div key={cfg.id} className="relative flex min-w-[106px] flex-1 items-stretch">
              {/* Faixa da era, alinhada ao próprio slot; acesa quando desbloqueada */}
              <span
                className="absolute inset-x-0 -top-[6px] h-[3px] transition-opacity"
                style={{ background: a, opacity: isUnlocked ? 0.95 : 0.18, boxShadow: isUnlocked ? `0 0 8px ${a}99` : 'none' }}
              />
              <button
                ref={(el) => {
                  itemRefs.current[cfg.id] = el;
                }}
                type="button"
                tabIndex={-1}
                // Evita foco no botão (Espaço do jogo não deve "clicar" nele).
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => select(cfg.id)}
                title={`${cfg.year} — ${cfg.name}: ${cfg.mechanicLabel}${isUnlocked ? '' : ' (bloqueada)'}`}
                className="group relative flex-1 px-2 py-[5px] text-left outline-none"
                style={{
                  clipPath: NOTCH,
                  background: isUnlocked ? '#0E1019' : 'repeating-linear-gradient(135deg, #0A0B11 0 6px, #0D0F16 6px 12px)',
                  boxShadow: `inset 0 0 0 1px ${isUnlocked ? 'rgba(255,255,255,.07)' : 'rgba(255,255,255,.04)'}`,
                }}
              >
                {active && (
                  <motion.div
                    layoutId="timeline-indicator"
                    className="absolute inset-0"
                    style={{
                      clipPath: NOTCH,
                      background: `linear-gradient(180deg, ${a}33, ${a}0D)`,
                      boxShadow: `inset 0 0 0 2px ${a}, inset 0 -4px 0 ${a}66`,
                    }}
                    transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                  />
                )}
                {!active && isUnlocked && (
                  <div
                    className="absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100"
                    style={{ clipPath: NOTCH, boxShadow: `inset 0 0 0 2px ${a}55` }}
                  />
                )}
                <div className="relative flex items-center gap-1.5">
                  <kbd
                    className="flex h-[16px] min-w-[16px] items-center justify-center px-[3px] font-pixel text-[8px] leading-none"
                    style={
                      active
                        ? { background: a, color: '#07080D' }
                        : {
                            background: '#1A1D2B',
                            color: isUnlocked ? 'rgba(226,232,240,.75)' : 'rgba(148,163,184,.4)',
                            boxShadow: 'inset 0 -2px 0 rgba(0,0,0,.4)',
                          }
                    }
                  >
                    {hotkey(cfg.id)}
                  </kbd>
                  <span
                    className="font-pixel text-[12px] leading-none"
                    style={{
                      color: active ? a : isUnlocked ? '#E2E8F0' : '#475569',
                      textShadow: active ? `0 0 10px ${a}AA, 2px 2px 0 #000` : '2px 2px 0 #000',
                    }}
                  >
                    {cfg.year}
                  </span>
                  {active && (
                    <span className="eras-cursor ml-auto font-pixel text-[8px]" style={{ color: a }}>
                      ◀
                    </span>
                  )}
                  {!isUnlocked && <Lock size={11} className="ml-auto text-slate-600" aria-label="bloqueada" />}
                </div>
                <div
                  className="relative mt-1 truncate font-terminal text-[17px] leading-none"
                  style={{ color: active ? '#F8FAFC' : isUnlocked ? '#CBD5E1' : '#475569' }}
                >
                  {isUnlocked ? cfg.name : '??????'}
                </div>
                <div
                  className="relative truncate font-terminal text-[14px] leading-none"
                  style={{ color: active ? a : isUnlocked ? 'rgba(148,163,184,.75)' : 'rgba(71,85,105,.8)' }}
                >
                  {isUnlocked ? cfg.mechanicLabel : 'BLOQUEADA'}
                </div>
              </button>
              {/* Trilha até a próxima era (acesa quando ela já foi liberada) */}
              {next && (
                <span
                  className="absolute -right-[6px] top-1/2 z-10 h-[4px] w-[6px] -translate-y-1/2"
                  style={{ background: unlocked.includes(next.id) ? ERA_ACCENTS[next.id] : '#1E2230' }}
                />
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}

export default TimelineSelector;
