/**
 * "Item get" card shown on ARTIFACT_COLLECTED.
 *
 * Reading must never race the clock, so the card PAUSES gameplay (overlay pause: no pause
 * menu behind it, run timer stopped) and waits for the player: Enter / E / click continues,
 * M jumps to the museum entry. Text is deliberately short and reads top-down: what it is (name,
 * nickname, year), why it matters (one punchline), what it unlocks (eras + mechanic), then actions.
 * The full story lives in the museum.
 *
 * The card appears ~450 ms after the pickup so the collect VFX burst is seen first.
 * Suggested mount: z-[40] (above era HUD z-20, below pause/victory z-50).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { BookOpen, Sparkles } from 'lucide-react';
import { EventBus } from '../core/EventBus';
import { ERA_CONFIGS } from '../core/EraManager';
import { getArtifactLore } from '../core/HistoricalCodex';
import type { ArtifactId, ArtifactLore, EraId } from '../core/types';
import { ArtifactIcon, ERA_ACCENTS } from './eras-hud/shared';
import { pauseForOverlay, resumeFromOverlay } from './eras-hud/PauseScreen';
import { Blink } from './eras-hud/screenKit';
import { useInputMode } from './eras-hud/hooks';

/** Delay between pickup and card, so the in-world burst plays first. */
const SHOW_DELAY_MS = 450;
/** Ignore confirm keys for a moment so a held key doesn't dismiss the card unread. */
const INPUT_GRACE_MS = 600;

interface QueuedCard {
  key: number;
  artifact: ArtifactId;
  lore: ArtifactLore;
}

function UnlockCard({ card, onContinue, onMuseum }: { card: QueuedCard; onContinue: () => void; onMuseum: () => void }) {
  const mode = useInputMode();
  const isPad = mode === 'gamepad';
  const isTouch = mode === 'touch';
  const reduceMotion = useReducedMotion();
  const { lore } = card;
  const eras: EraId[] = lore.unlockedEras ?? [];
  const accent = eras.length ? ERA_ACCENTS[eras[0]] : '#10B981';

  return (
    <motion.div
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.92 }}
      animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
      transition={{ type: 'spring', stiffness: 320, damping: 24 }}
      className="pointer-events-auto relative w-full overflow-hidden text-slate-100"
      style={{
        background: 'linear-gradient(180deg, rgba(16,19,30,.97), rgba(7,8,13,.97))',
        boxShadow: `inset 0 0 0 2px ${accent}, 0 0 40px ${accent}55, 0 16px 40px rgba(0,0,0,.6)`,
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`Hardware encontrado: ${lore.name}`}
    >
      <div className="flex items-center justify-center gap-2 px-4 py-2" style={{ background: `${accent}22`, borderBottom: `1px solid ${accent}55` }}>
        <Sparkles size={13} style={{ color: accent }} />
        <span className="font-pixel text-[9px] tracking-widest" style={{ color: accent }}>
          NOVO HARDWARE
        </span>
        <Sparkles size={13} style={{ color: accent }} />
      </div>

      <div className="px-5 pb-4 pt-4 text-center">
        <motion.div
          className="mx-auto flex h-16 w-16 items-center justify-center"
          style={{ background: `${accent}1F`, boxShadow: `inset 0 0 0 2px ${accent}, 0 0 24px ${accent}88` }}
          initial={reduceMotion ? false : { rotate: -12, scale: 0.6 }}
          animate={{ rotate: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 12, delay: 0.1 }}
        >
          <ArtifactIcon id={card.artifact} size={34} style={{ color: accent }} />
        </motion.div>

        <div className="mt-3 font-pixel text-[13px] leading-snug text-white">{lore.name}</div>
        <div className="mt-1 font-terminal text-[21px] leading-tight" style={{ color: accent }}>
          “{lore.popularNickname}” · {lore.year}
        </div>

        {lore.impactQuote && (
          <p className="mt-3 font-terminal text-[18px] italic leading-tight text-slate-300">“{lore.impactQuote}”</p>
        )}

        {eras.length > 0 && (
          <div className="mt-4 pt-3" style={{ borderTop: `1px dashed ${accent}44` }}>
            <div className="font-pixel text-[8px] text-slate-400">AGORA VOCÊ PODE VIAJAR PARA</div>
            <div className="mt-2 flex flex-col gap-1.5">
              {eras.map((e) => (
                <div
                  key={e}
                  className="flex items-center gap-2.5 px-2.5 py-1.5 text-left"
                  style={{ background: `${ERA_ACCENTS[e]}1A`, boxShadow: `inset 0 0 0 1px ${ERA_ACCENTS[e]}` }}
                >
                  <span className="font-pixel text-[11px]" style={{ color: ERA_ACCENTS[e] }}>
                    {ERA_CONFIGS[e].year}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-terminal text-[19px] leading-none text-slate-100">
                    {ERA_CONFIGS[e].mechanicLabel}
                  </span>
                  <span className="font-terminal text-[16px] leading-none text-slate-500">[{e === 10 ? 0 : e}]</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            tabIndex={-1}
            onPointerDown={(e) => e.preventDefault()}
            onClick={onContinue}
            className="px-4 py-2 font-pixel text-[10px] text-[#07080D] outline-none"
            style={{ background: accent, boxShadow: 'inset 0 -3px 0 rgba(0,0,0,.25)' }}
          >
            ▶ CONTINUAR{isTouch ? '' : ` [${isPad ? 'A' : 'ENTER'}]`}
          </button>
          <button
            type="button"
            tabIndex={-1}
            onPointerDown={(e) => e.preventDefault()}
            onClick={onMuseum}
            className="flex items-center gap-1.5 px-3 py-2 font-pixel text-[9px] text-[#FACC15] outline-none hover:bg-white/5"
            style={{ boxShadow: 'inset 0 0 0 2px rgba(250,204,21,.5)' }}
          >
            <BookOpen size={12} /> HISTÓRIA{isTouch ? '' : ` [${isPad ? 'SELECT' : 'M'}]`}
          </button>
        </div>
        <div className="mt-2 font-pixel text-[7px] text-slate-500">
          <Blink>JOGO PAUSADO</Blink>
        </div>
      </div>
    </motion.div>
  );
}

export function ArtifactUnlockCard() {
  const [queue, setQueue] = useState<QueuedCard[]>([]);
  const [visible, setVisible] = useState(false);
  const seq = useRef(0);
  const shownAt = useRef(0);
  /** Mirrors `visible` synchronously (state updates lag behind the events fired by close()). */
  const visibleRef = useRef(false);

  useEffect(() => {
    const offCollected = EventBus.on('ARTIFACT_COLLECTED', (p) => {
      const id = p.artifactId ?? p.artifact;
      const lore = p.lore ?? getArtifactLore(id);
      if (!lore) return;
      setQueue((q) => (q.some((c) => c.artifact === id) ? q : [...q, { key: ++seq.current, artifact: id, lore }]));
    });
    const offRestart = EventBus.on('GAME_RESTART', () => {
      visibleRef.current = false;
      setQueue([]);
      setVisible(false);
    });
    return () => {
      offCollected();
      offRestart();
    };
  }, []);

  const current = queue[0];

  // Show the next card after a short beat, pausing the game while it's on screen.
  useEffect(() => {
    if (!current) return;
    const id = window.setTimeout(() => {
      pauseForOverlay('artifact');
      shownAt.current = performance.now();
      visibleRef.current = true;
      setVisible(true);
    }, SHOW_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [current]);

  const close = useCallback((openMuseum: boolean) => {
    if (!visibleRef.current) return;
    visibleRef.current = false;
    setVisible(false);
    setQueue((q) => q.slice(1));
    resumeFromOverlay();
    // The museum pauses on its own when it sees 'playing'.
    if (openMuseum) EventBus.emit('CODEX_OPENED', { tab: 'codex' });
  }, []);

  // Someone else resumed the game (e.g. the timeline ▶ button): drop the card.
  useEffect(
    () =>
      EventBus.on('GAME_STATE_CHANGED', ({ state }) => {
        if (state !== 'paused' && visibleRef.current) {
          visibleRef.current = false;
          setVisible(false);
          setQueue((q) => q.slice(1));
        }
      }),
    [],
  );

  // While visible, own the keyboard (capture phase) so the game and other menus don't react.
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(e.key)) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      if (e.repeat || performance.now() - shownAt.current < INPUT_GRACE_MS) return;
      if (e.key === 'Enter' || e.code === 'KeyE' || e.key === 'Escape') close(false);
      else if (e.code === 'KeyM') close(true);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [visible, close]);

  return (
    <AnimatePresence>
      {visible && current && (
        <motion.div
          key={current.key}
          className="pointer-events-auto absolute inset-0 z-[40] flex items-center justify-center bg-[#05060A]/55 p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.15 } }}
        >
          <div className="w-[min(420px,100%)]">
            <UnlockCard card={current} onContinue={() => close(false)} onMuseum={() => close(true)} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default ArtifactUnlockCard;
