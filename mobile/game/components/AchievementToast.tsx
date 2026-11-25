/**
 * Corner toast for ACHIEVEMENT_UNLOCKED. Its skin follows the era the player is in when the
 * achievement pops (oscilloscope phosphor, DOS terminal, 1-bit Mac, NES/SNES, Win95, Winamp,
 * Aero, Flat, Neon glass). Queued: one at a time, 7–9 s each, held while the artifact card is open.
 *
 * Placement: right edge, vertically at max(190px, 34%). Every era HUD keeps the right edge free
 * between its top-right panel (tallest: the 1984 "Status" window, ends ~170 px) and its bottom
 * hint line / taskbar / knobs (start ~100 px above the bottom), so the toast never covers HUD data.
 * z-[65]: above the pause/victory screens (z-50) so run-end achievements are visible, below the
 * museum (z-[70]).
 *
 * Also exports the achievement helpers shared with MuseumModal (icon map, rarity meta, first sentence).
 */
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Activity,
  AppWindow,
  BookOpen,
  Code,
  Gem,
  History,
  Layers,
  Power,
  ShieldCheck,
  Shuffle,
  Skull,
  Sparkles,
  SquareX,
  Timer,
  Trophy,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { EventBus } from '../core/EventBus';
import { ERA_CONFIGS, EraManager } from '../core/EraManager';
import type { Achievement, AchievementCategory, AchievementIcon, AchievementRarity, EraId, HudTheme } from '../core/types';
import { win95Raised } from './eras-hud/windowSkins';
import { useOverlayPause } from './eras-hud/PauseScreen';

// ---------------------------------------------------------------------------
// Shared helpers (also used by MuseumModal)
// ---------------------------------------------------------------------------

export const ACHIEVEMENT_ICONS: Record<AchievementIcon, LucideIcon> = {
  Power,
  Trophy,
  BookOpen,
  ShieldCheck,
  Skull,
  Zap,
  Activity,
  Code,
  AppWindow,
  SquareX,
  Timer,
  Layers,
  Gem,
  Shuffle,
  History,
};

/** Lucide component for an achievement icon name (unknown → Trophy). */
export function achievementIcon(name: string): LucideIcon {
  return (ACHIEVEMENT_ICONS as Record<string, LucideIcon | undefined>)[name] ?? Trophy;
}

export const RARITY_META: Record<AchievementRarity, { label: string; color: string }> = {
  common: { label: 'Comum', color: '#94A3B8' },
  rare: { label: 'Rara', color: '#38BDF8' },
  epic: { label: 'Épica', color: '#C084FC' },
};

export const CATEGORY_LABELS: Record<AchievementCategory, string> = {
  collection: 'Coleção',
  hardcore: 'Sem Mortes',
  history: 'História',
  mastery: 'Maestria',
};

/** First sentence of a text, trimmed to `max` chars (adds an ellipsis when cut). */
export function firstSentence(text: string, max = 120): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  const match = /^.*?[.!?…](?=\s|$)/.exec(clean);
  const sentence = (match ? match[0] : clean).trim();
  if (sentence.length <= max) return sentence;
  const cut = sentence.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.]+$/, '')}…`;
}

// ---------------------------------------------------------------------------
// Era skins
// ---------------------------------------------------------------------------

interface Skin {
  font: string;
  fontFamily?: string;
  frame: CSSProperties;
  /** Wrapper around the body (e.g. Winamp's black LCD). */
  inner?: CSSProperties;
  bar?: 'mac' | 'win95' | 'winamp';
  label: string;
  labelStyle: CSSProperties;
  title: CSSProperties;
  text: CSSProperties;
  iconBox: CSSProperties;
  /** Monochrome eras print the rarity in their own ink instead of the rarity color. */
  mono?: boolean;
  sizes: { label: string; title: string; text: string; rarity: string };
  uppercase?: boolean;
}

const TERMINAL_SIZES = { label: 'text-[15px]', title: 'text-[23px]', text: 'text-[17px]', rarity: 'text-[15px]' };
const PIXEL_SIZES = { label: 'text-[8px]', title: 'text-[11px]', text: 'text-[9px] leading-[1.5]', rarity: 'text-[8px]' };
const SANS_SIZES = { label: 'text-[10px]', title: 'text-[15px]', text: 'text-[12px]', rarity: 'text-[10px]' };

function skinFor(theme: HudTheme): Skin {
  switch (theme) {
    case 'oscilloscope': {
      const g = '#00FF66';
      return {
        font: 'font-terminal',
        frame: { background: 'rgba(2,16,8,.92)', border: `1px solid ${g}80`, borderRadius: 6, boxShadow: `inset 0 0 18px ${g}2E, 0 0 18px ${g}33` },
        label: '▸ CH3 · CONQUISTA DESBLOQUEADA',
        labelStyle: { color: '#7dffb0' },
        title: { color: g, textShadow: `0 0 6px ${g}` },
        text: { color: '#7dffb0' },
        iconBox: { color: g, border: `1px solid ${g}`, borderRadius: 999, boxShadow: `0 0 8px ${g}` },
        mono: true,
        sizes: TERMINAL_SIZES,
      };
    }
    case 'msdos':
      return {
        font: 'font-terminal',
        frame: { background: '#000', border: '3px double #AAAAAA' },
        label: 'C:\\ERAS> CONQUISTA DESBLOQUEADA',
        labelStyle: { color: '#AAAAAA' },
        title: { color: '#000', background: '#33FF00', padding: '0 4px', display: 'inline-block' },
        text: { color: '#33FF00', textShadow: '0 0 4px rgba(51,255,0,.6)' },
        iconBox: { color: '#33FF00', border: '1px solid #33FF00' },
        mono: true,
        uppercase: true,
        sizes: TERMINAL_SIZES,
      };
    case 'macintosh':
      return {
        font: 'font-terminal',
        frame: { background: '#fff', border: '2px solid #000', boxShadow: '4px 4px 0 #000' },
        bar: 'mac',
        label: '',
        labelStyle: {},
        title: { color: '#000' },
        text: { color: '#000' },
        iconBox: { color: '#fff', background: '#000' },
        mono: true,
        sizes: TERMINAL_SIZES,
      };
    case 'arcade8':
      return {
        font: 'font-pixel',
        frame: { background: '#000', border: '4px solid #fff', boxShadow: '4px 4px 0 rgba(0,0,0,.6)' },
        label: '★ CONQUISTA DESBLOQUEADA ★',
        labelStyle: { color: '#D82800' },
        title: { color: '#FCBC3C' },
        text: { color: '#fff' },
        iconBox: { color: '#000', background: '#FCBC3C', boxShadow: '2px 2px 0 #E45C10' },
        uppercase: true,
        sizes: PIXEL_SIZES,
      };
    case 'arcade16':
      return {
        font: 'font-pixel',
        frame: {
          background: 'linear-gradient(180deg, #4060E8 0%, #2034A8 55%, #101C70 100%)',
          border: '3px solid #fff',
          borderRadius: 10,
          boxShadow: '0 0 0 2px #10104a, 0 4px 0 rgba(0,0,0,.35)',
        },
        label: 'CONQUISTA DESBLOQUEADA!',
        labelStyle: { color: '#58B858', textShadow: '1px 1px 0 #000' },
        title: { color: '#F8D030', textShadow: '1px 1px 0 #000' },
        text: { color: '#fff', textShadow: '1px 1px 0 #000' },
        iconBox: { color: '#101C70', background: '#F8D030', borderRadius: 6, border: '2px solid #fff' },
        uppercase: true,
        sizes: PIXEL_SIZES,
      };
    case 'win95':
      return {
        font: '',
        fontFamily: '"MS Sans Serif", Tahoma, "Segoe UI", sans-serif',
        frame: { ...win95Raised, padding: 2 },
        bar: 'win95',
        label: '',
        labelStyle: {},
        title: { color: '#000', fontWeight: 700 },
        text: { color: '#000' },
        iconBox: { color: '#000080' },
        sizes: { label: 'text-[11px]', title: 'text-[13px]', text: 'text-[11px]', rarity: 'text-[11px]' },
      };
    case 'winamp': {
      const lime = '#A6FF00';
      return {
        font: 'font-terminal',
        frame: {
          background: 'linear-gradient(180deg, #F4F6F8 0%, #B9C0C8 22%, #8A939D 50%, #C9CFD6 78%, #6E7680 100%)',
          border: '1px solid #2a2f35',
          borderRadius: 4,
          padding: 3,
          boxShadow: '0 6px 18px rgba(0,0,0,.6)',
        },
        inner: { background: '#000', border: '1px solid #000', borderRadius: 2, boxShadow: `inset 0 0 8px ${lime}26` },
        bar: 'winamp',
        label: '*** CONQUISTA DESBLOQUEADA ***',
        labelStyle: { color: '#5f8f00' },
        title: { color: lime, textShadow: `0 0 4px ${lime}` },
        text: { color: '#b8ff4d' },
        iconBox: { color: lime, border: `1px solid ${lime}66`, filter: `drop-shadow(0 0 3px ${lime})` },
        mono: true,
        uppercase: true,
        sizes: TERMINAL_SIZES,
      };
    }
    case 'aero':
      return {
        font: '',
        fontFamily: '"Trebuchet MS", "Segoe UI", sans-serif',
        frame: {
          background: 'linear-gradient(180deg, rgba(255,255,255,.88) 0%, rgba(215,244,255,.7) 48%, rgba(170,225,250,.62) 52%, rgba(215,244,255,.78) 100%)',
          border: '1px solid rgba(255,255,255,.9)',
          borderRadius: 14,
          boxShadow: '0 6px 18px rgba(0,80,140,.35)',
          backdropFilter: 'blur(8px)',
        },
        label: 'Conquista desbloqueada',
        labelStyle: { color: '#0A86CC', fontWeight: 700 },
        title: { color: '#06345C', fontWeight: 700 },
        text: { color: '#0b4a7a' },
        iconBox: {
          color: '#fff',
          borderRadius: 999,
          background: 'linear-gradient(180deg, #8FE6FF 0%, #2FB4EE 48%, #0A86CC 52%, #3CC4F2 100%)',
          border: '1px solid rgba(255,255,255,.9)',
        },
        sizes: SANS_SIZES,
      };
    case 'flat':
      return {
        font: 'font-poppins',
        frame: { background: '#FFFFFF', borderLeft: '6px solid #1ABC9C', boxShadow: '0 2px 0 rgba(0,0,0,.08)' },
        label: 'CONQUISTA DESBLOQUEADA',
        labelStyle: { color: '#1ABC9C', letterSpacing: '0.18em', fontWeight: 600 },
        title: { color: '#2C3E50', fontWeight: 600 },
        text: { color: '#5D6D7E', fontWeight: 300 },
        iconBox: { color: '#fff', background: '#9B59B6' },
        sizes: SANS_SIZES,
      };
    case 'neon':
    default:
      return {
        font: 'font-poppins',
        frame: {
          background: 'rgba(15,23,42,.66)',
          border: '1px solid rgba(16,185,129,.35)',
          borderRadius: 16,
          boxShadow: '0 0 24px rgba(16,185,129,.2)',
          backdropFilter: 'blur(12px)',
        },
        label: 'Conquista desbloqueada',
        labelStyle: { color: '#6EE7B7', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase' },
        title: { color: '#F1F5F9', fontWeight: 700 },
        text: { color: '#CBD5E1' },
        iconBox: { color: '#6EE7B7', background: 'rgba(16,185,129,.18)', border: '1px solid rgba(16,185,129,.5)', borderRadius: 12 },
        sizes: SANS_SIZES,
      };
  }
}

function TitleBar({ kind, text }: { kind: NonNullable<Skin['bar']>; text: string }) {
  if (kind === 'mac') {
    return (
      <div
        className="relative flex h-[18px] items-center border-b-2 border-black"
        style={{ backgroundImage: 'repeating-linear-gradient(#000 0 1px, #fff 1px 3px)', backgroundClip: 'content-box', padding: '3px 2px' }}
      >
        <span className="mx-auto bg-white px-2 font-terminal text-[16px] leading-none text-black">{text}</span>
      </div>
    );
  }
  if (kind === 'win95') {
    return (
      <div className="flex h-[20px] items-center gap-1 px-[3px]" style={{ background: 'linear-gradient(90deg, #000080 0%, #1084D0 100%)' }}>
        <Trophy size={12} className="shrink-0 text-[#FFD84A]" />
        <span className="flex-1 truncate text-[12px] font-bold text-white">{text}</span>
        <span className="flex h-[14px] w-[16px] items-center justify-center text-[10px] font-bold leading-none text-black" style={win95Raised}>
          ✕
        </span>
      </div>
    );
  }
  return (
    <div className="flex h-[14px] items-center gap-2 px-1">
      <div className="h-[6px] flex-1" style={{ backgroundImage: 'repeating-linear-gradient(0deg,#5b636c 0 1px,transparent 1px 2px)' }} />
      <span className="font-terminal text-[13px] font-bold leading-none tracking-[0.25em] text-[#20262c]">CHRONAMP</span>
      <div className="h-[6px] flex-1" style={{ backgroundImage: 'repeating-linear-gradient(0deg,#5b636c 0 1px,transparent 1px 2px)' }} />
    </div>
  );
}

function ToastCard({ achievement, era, queued }: { achievement: Achievement; era: EraId; queued: number }) {
  const reduceMotion = useReducedMotion();
  const theme = ERA_CONFIGS[era]?.hudTheme ?? 'neon';
  const skin = skinFor(theme);
  const rarity = RARITY_META[achievement.rarity] ?? RARITY_META.common;
  const epic = achievement.rarity === 'epic';
  const Icon = achievementIcon(achievement.icon);
  const glow = skin.mono ? (skin.title.color as string) : rarity.color;
  const up = (s: string) => (skin.uppercase ? s.toUpperCase() : s);
  const barText = epic ? 'Conquista ÉPICA desbloqueada!' : 'Conquista desbloqueada';
  const label = epic && skin.label ? up('★ Conquista ÉPICA desbloqueada! ★') : skin.label;
  // One short line only: the full story is in the museum.
  const reference = firstSentence(achievement.referenceExplained, 80);

  const body: ReactNode = (
    <div className="flex gap-3 p-2.5" style={skin.inner}>
      <div className="flex h-10 w-10 shrink-0 items-center justify-center" style={skin.iconBox}>
        <Icon size={20} strokeWidth={2.2} />
      </div>
      <div className="min-w-0 flex-1 leading-tight">
        {label && (
          <div className={`flex items-center gap-1 ${skin.sizes.label} leading-tight`} style={skin.labelStyle}>
            {epic && <Sparkles size={11} className="shrink-0" />}
            <span>{label}</span>
          </div>
        )}
        <div className={`mt-1 ${skin.sizes.title} leading-tight`}>
          <span style={skin.title}>{up(achievement.title)}</span>
        </div>
        <div className={`mt-1 flex items-center gap-1.5 ${skin.sizes.rarity} leading-none`}>
          <span
            className="px-1 py-[2px]"
            style={
              skin.mono
                ? { color: skin.text.color, boxShadow: `inset 0 0 0 1px ${skin.text.color as string}` }
                : { color: rarity.color, boxShadow: `inset 0 0 0 1px ${rarity.color}`, background: `${rarity.color}1F` }
            }
          >
            {up(rarity.label)}
          </span>
          {queued > 0 && <span style={skin.text}>+{queued} na fila</span>}
        </div>
        {reference && (
          <div className={`mt-1.5 flex gap-1 ${skin.sizes.text}`} style={skin.text}>
            <BookOpen size={12} className="mt-[2px] shrink-0 opacity-80" />
            <span>{reference}</span>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <motion.div
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 48, scale: epic ? 0.9 : 1 }}
      animate={reduceMotion ? { opacity: 1 } : { opacity: 1, x: 0, scale: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 32, transition: { duration: 0.18 } }}
      transition={{ type: 'spring', stiffness: 360, damping: 26 }}
      className="relative"
    >
      {epic && (
        <motion.div
          className="pointer-events-none absolute -inset-1"
          style={{ boxShadow: `0 0 0 2px ${glow}, 0 0 26px ${glow}` , borderRadius: skin.frame.borderRadius }}
          animate={reduceMotion ? { opacity: 0.8 } : { opacity: [0.35, 1, 0.35] }}
          transition={reduceMotion ? undefined : { duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}
      <div
        className={`relative overflow-hidden ${skin.font}`}
        style={{ ...skin.frame, fontFamily: skin.fontFamily }}
        role="status"
        aria-live="polite"
      >
        {skin.bar && <TitleBar kind={skin.bar} text={skin.bar === 'winamp' ? '' : barText} />}
        {body}
        {epic && !reduceMotion && (
          <motion.div
            className="pointer-events-none absolute inset-y-0 w-1/3"
            style={{ background: 'linear-gradient(100deg, transparent, rgba(255,255,255,.45), transparent)', mixBlendMode: 'screen' }}
            initial={{ left: '-40%' }}
            animate={{ left: '140%' }}
            transition={{ duration: 1.1, delay: 0.25, repeat: 2, repeatDelay: 0.9, ease: 'easeInOut' }}
          />
        )}
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

interface QueuedToast {
  key: number;
  achievement: Achievement;
  era: EraId;
}

/** Long enough to read the title + one line without pausing. */
const TOAST_MS = { common: 7000, rare: 8000, epic: 9000 } as const;

export function AchievementToast() {
  const [queue, setQueue] = useState<QueuedToast[]>([]);
  const seq = useRef(0);
  // Hold toasts while the artifact card is up, so only one thing asks to be read at a time.
  const holding = useOverlayPause() === 'artifact';

  useEffect(
    () =>
      EventBus.on('ACHIEVEMENT_UNLOCKED', ({ achievement, currentEra }) => {
        setQueue((q) =>
          q.some((t) => t.achievement.id === achievement.id)
            ? q
            : [...q, { key: ++seq.current, achievement, era: currentEra ?? EraManager.getCurrentEra() }],
        );
      }),
    [],
  );

  const current = holding ? undefined : queue[0];
  useEffect(() => {
    if (!current) return;
    const id = window.setTimeout(() => setQueue((q) => q.filter((t) => t.key !== current.key)), TOAST_MS[current.achievement.rarity]);
    return () => window.clearTimeout(id);
  }, [current]);

  return (
    <div
      className="pointer-events-none absolute right-3 z-[65] w-[300px] max-w-[calc(100%-24px)]"
      style={{ top: 'max(190px, 34%)' }}
    >
      <AnimatePresence mode="wait">
        {current && <ToastCard key={current.key} achievement={current.achievement} era={current.era} queued={queue.length - 1} />}
      </AnimatePresence>
    </div>
  );
}

export default AchievementToast;
