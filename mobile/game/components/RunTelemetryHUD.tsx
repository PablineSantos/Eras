/**
 * Compact run telemetry (timer · deaths · "Museu [M]" button) + a one-line reference banner
 * shown after the player uses an era mechanic (REFERENCE_CALLOUT).
 * Visible only while 'playing' / 'paused'.
 *
 * Placement (checked against the 9 era HUDs):
 *  - Telemetry pill: LEFT edge at top = max(190px, 36%). Every HUD's top-left block ends above
 *    ~170 px (tallest: the 1999 CHRONAMP window, ~16 + 125 px) and every bottom element (DOS help
 *    line, Win95 taskbar/Start menu, Mac/Flat hint boxes, oscilloscope knobs) stays in the lower
 *    ~35 %. The top-center is NOT free (DOS command bar, Mac menu bar and NES/SNES score rows are
 *    full width) and the left edge is "behind" the runner (levels scroll left → right).
 *  - Banner: horizontally centered, bottom = max(118px, 22%), i.e. just above the hint lines /
 *    taskbar / Win95 yellow tooltip, so it reads like a subtitle without hiding the player.
 * Root is pointer-events-none; only the museum button takes the pointer. Suggested mount: z-[35]
 * (above the era HUD z-20, below pause/victory z-50).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { BookOpen, Landmark, Lightbulb, ShieldCheck, Skull, Timer } from 'lucide-react';
import { EventBus } from '../core/EventBus';
import { ERA_CONFIGS } from '../core/EraManager';
import { AchievementSystem } from '../core/AchievementSystem';
import type { EraId, RunStats } from '../core/types';
import { useEraConfig, useGameState, useInputMode } from './eras-hud/hooks';
import { ERA_ACCENTS } from './eras-hud/shared';

/** mm:ss (h:mm:ss after one hour). */
export function formatRunTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
}


function initialStats(): RunStats | undefined {
  return EventBus.getLast('STATS_UPDATED')?.stats ?? AchievementSystem.getRunStats();
}

interface Banner {
  key: number;
  era: EraId;
  kind: 'era' | 'callout';
  title: string;
  text: string;
}

/** Long enough to read one sentence calmly; callouts only fire after the player uses a mechanic. */
const BANNER_MS = 9000;

export function RunTelemetryHUD() {
  const mode = useInputMode();
  const isPad = mode === 'gamepad';
  const gameState = useGameState();
  const config = useEraConfig();
  const reduceMotion = useReducedMotion();
  const accent = ERA_ACCENTS[config.id];

  // --- Timer: last authoritative value + local interpolation while playing ---------------
  const [initial] = useState(() => initialStats());
  const base = useRef({ ms: initial?.elapsedMs ?? 0, at: 0 });
  const running = useRef(false);
  const msAt = (now: number) => base.current.ms + (running.current ? now - base.current.at : 0);
  const [timeText, setTimeText] = useState(() => formatRunTime(initial?.elapsedMs ?? 0));
  const [deaths, setDeaths] = useState(() => initial?.deaths ?? 0);

  const refreshTime = useCallback(() => setTimeText(formatRunTime(msAt(performance.now()))), []);

  useEffect(
    () =>
      EventBus.on('STATS_UPDATED', ({ stats }) => {
        const now = performance.now();
        const shown = msAt(now);
        const incoming = stats.elapsedMs;
        // Ignore small backwards corrections (keeps the clock monotonic); a big drop is a new run.
        const ms = incoming < shown && shown - incoming < 1500 ? shown : incoming;
        base.current = { ms, at: now };
        setDeaths(stats.deaths);
        refreshTime();
      }),
    [refreshTime],
  );

  useEffect(() => {
    const now = performance.now();
    base.current = { ms: msAt(now), at: now };
    running.current = gameState === 'playing';
    refreshTime();
    if (!running.current) return;
    const id = window.setInterval(refreshTime, 250);
    return () => window.clearInterval(id);
  }, [gameState, refreshTime]);

  // --- "Contexto rápido" banner -----------------------------------------------------------
  const [banner, setBanner] = useState<Banner | null>(null);
  const bannerSeq = useRef(0);
  const bannerTimer = useRef<number | undefined>(undefined);

  const showBanner = useCallback((b: Omit<Banner, 'key'>) => {
    window.clearTimeout(bannerTimer.current);
    setBanner({ ...b, key: ++bannerSeq.current });
    bannerTimer.current = window.setTimeout(() => setBanner(null), BANNER_MS);
  }, []);

  useEffect(() => {
    const offCallout = EventBus.on('REFERENCE_CALLOUT', ({ era, title, explanation }) =>
      showBanner({ era, kind: 'callout', title, text: explanation }),
    );
    return () => {
      offCallout();
      window.clearTimeout(bannerTimer.current);
    };
  }, [showBanner]);

  // No automatic per-era tip: the level signs already say what to do; the banner only explains
  // the real reference right after the player uses a mechanic (REFERENCE_CALLOUT).
  useEffect(() => {
    if (gameState === 'title' || gameState === 'victory') setBanner(null);
  }, [gameState]);

  if (gameState !== 'playing' && gameState !== 'paused') return null;

  const clean = deaths === 0;
  const bannerAccent = banner ? ERA_ACCENTS[banner.era] ?? accent : accent;

  return (
    <div className="pointer-events-none absolute inset-0">
      {/* Telemetry pill */}
      <div className="absolute left-3 flex items-center gap-2" style={{ top: 'max(190px, 36%)' }}>
        <div
          className="flex items-center gap-2.5 px-2.5 py-1 font-terminal text-[20px] leading-none text-slate-100"
          style={{ background: 'rgba(7,8,13,.78)', boxShadow: `inset 0 0 0 1px ${accent}66, 0 2px 8px rgba(0,0,0,.4)` }}
        >
          <span className="flex items-center gap-1.5 tabular-nums" title="Tempo da run">
            <Timer size={14} style={{ color: accent }} />
            {timeText}
          </span>
          <span className="h-4 w-px bg-white/15" />
          <span
            className="flex items-center gap-1.5 tabular-nums"
            title={clean ? 'Nenhuma morte nesta run: Kernel Panic Zero ativo' : 'Mortes nesta run'}
          >
            {clean ? <ShieldCheck size={14} className="text-emerald-400" /> : <Skull size={14} className="text-rose-400" />}
            <span className={clean ? 'text-emerald-300' : 'text-rose-200'}>{deaths}</span>
          </span>
        </div>
        <button
          type="button"
          tabIndex={-1}
          title="Museu & Referências Históricas [M]"
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => EventBus.emit('CODEX_OPENED', { tab: 'codex' })}
          className="pointer-events-auto flex items-center gap-1.5 px-2 py-1 font-pixel text-[9px] leading-none text-slate-100 outline-none transition-colors hover:text-white"
          style={{ background: `${accent}26`, boxShadow: `inset 0 0 0 1px ${accent}99, inset 0 -2px 0 ${accent}55` }}
        >
          <Landmark size={13} style={{ color: accent }} />
          <span>Museu</span>
          {mode !== 'touch' && (
            <span className="px-1 py-[2px] text-[8px]" style={{ background: '#151826', boxShadow: `inset 0 0 0 1px ${accent}88` }}>
              {isPad ? 'SELECT' : 'M'}
            </span>
          )}
        </button>
      </div>

      {/* "Contexto rápido" banner */}
      <div
        className="absolute left-1/2 flex w-[min(680px,92%)] -translate-x-1/2 justify-center"
        style={{ bottom: 'max(118px, 22%)' }}
      >
        <AnimatePresence mode="wait">
          {banner && (
            <motion.div
              key={banner.key}
              role="status"
              aria-live="polite"
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
              animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.2 } }}
              transition={{ duration: 0.22 }}
              className="flex max-w-full items-start gap-2 px-3 py-1.5 font-terminal text-[18px] leading-[1.1] text-slate-100"
              style={{ background: 'rgba(7,8,13,.8)', boxShadow: `inset 3px 0 0 ${bannerAccent}, 0 4px 14px rgba(0,0,0,.45)` }}
            >
              {banner.kind === 'era' ? (
                <Lightbulb size={15} className="mt-[2px] shrink-0" style={{ color: bannerAccent }} />
              ) : (
                <BookOpen size={15} className="mt-[2px] shrink-0" style={{ color: bannerAccent }} />
              )}
              <span className="line-clamp-2">
                <span className="mr-1.5 font-pixel text-[9px] uppercase" style={{ color: bannerAccent }}>
                  {banner.kind === 'era' ? `Contexto rápido · ${ERA_CONFIGS[banner.era]?.year ?? ''}` : 'Referência'}
                </span>
                <span className="font-bold text-white">{banner.title}</span>
                <span className="text-slate-300"> — {banner.text}</span>
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default RunTelemetryHUD;
