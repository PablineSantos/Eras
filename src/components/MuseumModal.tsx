/**
 * "Museu & Referências Históricas": the in-game codex (6 hardwares + 10 eras explained as
 * real world → game mechanic → practical tip) and the achievements list with run telemetry.
 *
 * - Opens on CODEX_OPENED (on the requested tab). Owns the [M] key: while closed, M emits
 *   CODEX_OPENED { tab: 'codex' } (so the sound plays) and the modal opens from that event.
 * - Esc or M closes and emits CODEX_CLOSED.
 * - If the game was 'playing' when it opened, it pauses it (overlay pause: no pause menu behind) and resumes it on close.
 *   Opened from pause/victory/title, the game state is left untouched.
 * - While open, a window keydown listener in CAPTURE phase swallows every key
 *   (stopImmediatePropagation + preventDefault), so Phaser, the pause menu and the 1..0 era keys
 *   never react. keyup is left alone so Phaser doesn't keep a key "stuck" down after closing;
 *   browser shortcuts (Ctrl/Cmd/Alt + key, F1..F12) keep their default action but still don't
 *   reach the game.
 * - z-[70]: above the pause/victory screens (z-50) and the achievement toast (z-[65]).
 */
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { Dispatch, ReactNode, RefObject, SetStateAction } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  BookOpen,
  Check,
  Cpu,
  Gamepad2,
  Globe,
  HelpCircle,
  Landmark,
  Layers,
  Lightbulb,
  Lock,
  ShieldCheck,
  Skull,
  Sparkles,
  Timer,
  Trophy,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { EventBus } from '../core/EventBus';
import { ERA_CONFIGS, EraManager } from '../core/EraManager';
import { AchievementSystem } from '../core/AchievementSystem';
import { ARTIFACT_LORE, ERA_LORE } from '../core/HistoricalCodex';
import { ALL_ERAS, eraLoreId } from '../core/types';
import type { Achievement, AchievementCategory, ArtifactId, EraId, LoreId, RunStats } from '../core/types';
import { ARTIFACT_ORDER, ArtifactIcon, ERA_ACCENTS } from './eras-hud/shared';
import { CrtOverlay, EraStripe, PixelPanel } from './eras-hud/screenKit';
import { pauseForOverlay, resumeFromOverlay } from './eras-hud/PauseScreen';
import { useEraConfig, useInputMode } from './eras-hud/hooks';
import { CATEGORY_LABELS, RARITY_META, achievementIcon } from './AchievementToast';
import { formatRunTime } from './RunTelemetryHUD';

type Tab = 'codex' | 'achievements';
type Filter = 'all' | AchievementCategory;

type Entry =
  | { loreId: LoreId; kind: 'artifact'; artifact: ArtifactId }
  | { loreId: LoreId; kind: 'era'; era: EraId };

/** Fixed order of the codex list: 6 hardwares, then the 10 eras. */
const ENTRIES: Entry[] = [
  ...ARTIFACT_ORDER.map((artifact): Entry => ({ loreId: artifact, kind: 'artifact', artifact })),
  ...ALL_ERAS.map((era): Entry => ({ loreId: eraLoreId(era), kind: 'era', era })),
];

const COLORS = {
  real: '#38BDF8',
  game: '#A78BFA',
  tip: '#FBBF24',
  ok: '#34D399',
  danger: '#F43F5E',
};

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Todas' },
  { id: 'collection', label: 'Coleção' },
  { id: 'hardcore', label: 'Sem Mortes' },
  { id: 'history', label: 'História' },
  { id: 'mastery', label: 'Maestria' },
];

const click = () => EventBus.emit('PLAY_SFX', { sound: 'click' });
const noFocus = (e: { preventDefault: () => void }) => e.preventDefault();

/**
 * Re-render on any AchievementSystem change (getters return new arrays on every call, so they
 * are read during render instead of being used as external-store snapshots).
 */
function useAchievementVersion(): number {
  const [version, bump] = useReducer((v: number) => v + 1, 0);
  useEffect(() => {
    const offSystem = AchievementSystem.subscribe(() => bump());
    const offStats = EventBus.on('STATS_UPDATED', () => bump());
    return () => {
      offSystem();
      offStats();
    };
  }, []);
  return version;
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export function MuseumModal() {
  const inputMode = useInputMode();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('codex');
  const [selected, setSelected] = useState<LoreId>(() => eraLoreId(EraManager.getCurrentEra()));
  const openRef = useRef(false);
  const pausedByUs = useRef(false);
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const achievementsScroll = useRef<HTMLDivElement>(null);
  const config = useEraConfig();
  const reduceMotion = useReducedMotion();
  const accent = ERA_ACCENTS[config.id];

  const close = useCallback(() => {
    if (!openRef.current) return;
    openRef.current = false;
    setOpen(false);
    EventBus.emit('CODEX_CLOSED', {});
    if (pausedByUs.current) {
      pausedByUs.current = false;
      resumeFromOverlay();
    }
  }, []);

  useEffect(
    () =>
      EventBus.on('CODEX_OPENED', ({ tab: requested }) => {
        setTab(requested === 'achievements' ? 'achievements' : 'codex');
        if (openRef.current) return;
        openRef.current = true;
        setSelected(eraLoreId(EraManager.getCurrentEra()));
        setOpen(true);
        if (pauseForOverlay('museum')) pausedByUs.current = true;
      }),
    [],
  );

  // Keyboard: closed → only [M] opens; open → capture-phase swallow of every keydown.
  useEffect(() => {
    if (!open) {
      const onKey = (e: KeyboardEvent) => {
        if (e.code !== 'KeyM' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
        e.preventDefault();
        EventBus.emit('CODEX_OPENED', { tab: 'codex' });
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }

    const switchTab = () => {
      click();
      setTab((t) => (t === 'codex' ? 'achievements' : 'codex'));
    };
    const move = (delta: number) => {
      if (tabRef.current === 'achievements') {
        achievementsScroll.current?.scrollBy({ top: delta * 110 });
        return;
      }
      click();
      setSelected((cur) => {
        const i = Math.max(0, ENTRIES.findIndex((en) => en.loreId === cur));
        return ENTRIES[(i + delta + ENTRIES.length) % ENTRIES.length].loreId;
      });
    };
    const onKey = (e: KeyboardEvent) => {
      e.stopImmediatePropagation();
      const mods = e.ctrlKey || e.metaKey || e.altKey;
      if (!mods && !/^F\d{1,2}$/.test(e.key)) e.preventDefault();
      if (mods) return;
      switch (e.code) {
        case 'Escape':
        case 'KeyM':
          if (!e.repeat) close();
          break;
        case 'ArrowLeft':
        case 'ArrowRight':
        case 'KeyA':
        case 'KeyD':
        case 'Tab':
          if (!e.repeat) switchTab();
          break;
        case 'ArrowUp':
        case 'KeyW':
          move(-1);
          break;
        case 'ArrowDown':
        case 'KeyS':
          move(1);
          break;
        case 'PageUp':
          achievementsScroll.current?.scrollBy({ top: -320 });
          break;
        case 'PageDown':
          achievementsScroll.current?.scrollBy({ top: 320 });
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [open, close]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="museum"
          role="dialog"
          aria-modal="true"
          aria-label="Museu & Referências Históricas"
          className="pointer-events-auto absolute inset-0 z-[70] flex items-center justify-center bg-[#05060A]/85 p-2 text-slate-100 backdrop-blur-[2px] sm:p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.15 } }}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <motion.div
            className="relative w-full max-w-[1040px]"
            style={{ height: 'min(700px, 100%)' }}
            initial={reduceMotion ? false : { y: 14, scale: 0.97 }}
            animate={{ y: 0, scale: 1 }}
            transition={{ type: 'spring', stiffness: 320, damping: 26 }}
          >
            <PixelPanel accent={accent} className="h-full">
              <div className="flex h-full min-h-0 flex-col">
                <Header accent={accent} onClose={close} />
                <EraStripe height={4} className="mt-3 shrink-0 opacity-80" />
                <Tabs tab={tab} accent={accent} onChange={(t) => { if (t !== tab) click(); setTab(t); }} />
                <div className="mt-3 min-h-0 flex-1">
                  {tab === 'codex' ? (
                    <CodexTab selected={selected} setSelected={setSelected} />
                  ) : (
                    <AchievementsTab scrollRef={achievementsScroll} accent={accent} />
                  )}
                </div>
                <div className="mt-2 hidden shrink-0 text-center font-pixel text-[8px] text-slate-500 sm:block">
                  {inputMode === 'touch'
                    ? 'TOQUE NAS ABAS E ITENS · ✕ FECHA'
                    : inputMode === 'gamepad'
                    ? 'D-PAD ←→ ABAS · ↑↓ NAVEGAR · START OU SELECT FECHAR'
                    : '←→ ABAS · ↑↓ NAVEGAR · ESC OU M FECHAR'}
                </div>
              </div>
            </PixelPanel>
          </motion.div>
          <CrtOverlay strength={0.3} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Header({ accent, onClose }: { accent: string; onClose: () => void }) {
  return (
    <div className="flex shrink-0 items-start gap-3">
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center text-[#07080D]"
        style={{ background: accent, boxShadow: `0 0 16px ${accent}88, inset 0 -3px 0 rgba(0,0,0,.25)` }}
      >
        <Landmark size={22} />
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="font-pixel text-[11px] leading-snug text-white sm:text-[15px]" style={{ textShadow: `2px 2px 0 ${accent}66` }}>
          MUSEU & REFERÊNCIAS HISTÓRICAS
        </h2>
        <p className="mt-1 font-terminal text-[17px] leading-tight text-slate-400">
          Cada fase é uma piada com a tela de um ano real. Aqui você descobre qual — e por que ela vira mecânica.
        </p>
      </div>
      <button
        type="button"
        tabIndex={-1}
        title="Fechar [Esc]"
        aria-label="Fechar"
        onPointerDown={noFocus}
        onClick={onClose}
        className="flex shrink-0 items-center gap-1.5 px-2 py-1.5 font-pixel text-[8px] text-slate-200 outline-none transition-colors hover:text-white"
        style={{ boxShadow: `inset 0 0 0 2px ${accent}66` }}
      >
        <X size={15} />
        <span className="hidden sm:inline">ESC</span>
      </button>
    </div>
  );
}

function Tabs({ tab, accent, onChange }: { tab: Tab; accent: string; onChange: (t: Tab) => void }) {
  const items: { id: Tab; label: string; icon: LucideIcon }[] = [
    { id: 'codex', label: 'Códice Histórico', icon: BookOpen },
    { id: 'achievements', label: 'Conquistas', icon: Trophy },
  ];
  return (
    <div className="mt-3 flex shrink-0 gap-2">
      {items.map(({ id, label, icon: Icon }) => {
        const on = tab === id;
        return (
          <button
            key={id}
            type="button"
            tabIndex={-1}
            onPointerDown={noFocus}
            onClick={() => onChange(id)}
            className="flex flex-1 items-center justify-center gap-2 px-2 py-2 font-pixel text-[9px] uppercase outline-none transition-colors sm:flex-none sm:px-4 sm:text-[10px]"
            style={{
              color: on ? '#07080D' : '#CBD5E1',
              background: on ? accent : 'transparent',
              boxShadow: on ? `0 0 18px ${accent}55, inset 0 -3px 0 rgba(0,0,0,.25)` : `inset 0 0 0 2px ${accent}33`,
            }}
          >
            <Icon size={14} />
            {label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 1 — Códice Histórico
// ---------------------------------------------------------------------------

function CodexTab({ selected, setSelected }: { selected: LoreId; setSelected: Dispatch<SetStateAction<LoreId>> }) {
  useAchievementVersion();
  const discoveredArtifacts = AchievementSystem.getDiscoveredArtifacts();
  const discoveredEras = AchievementSystem.getDiscoveredEras();
  const inspected = AchievementSystem.getInspectedLoreIds();
  const isDiscovered = (en: Entry) =>
    en.kind === 'artifact' ? discoveredArtifacts.includes(en.artifact) : discoveredEras.includes(en.era);

  const entry = ENTRIES.find((en) => en.loreId === selected) ?? ENTRIES[ENTRIES.length - 10];
  const discovered = isDiscovered(entry);
  const listRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  // Reading a discovered entry counts as "inspected" (history achievements).
  useEffect(() => {
    if (!discovered) return;
    if (AchievementSystem.getInspectedLoreIds().includes(entry.loreId)) return;
    EventBus.emit('ARTIFACT_INSPECTED', { loreId: entry.loreId });
  }, [entry.loreId, discovered]);

  // Keep the selected row visible (keyboard navigation) and reset the detail scroll.
  useEffect(() => {
    listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    if (detailRef.current) detailRef.current.scrollTop = 0;
  }, [selected]);

  const pick = (en: Entry) => {
    if (en.loreId !== selected) click();
    setSelected(en.loreId);
    // Narrow layout: the detail is below the list, bring it into view.
    if (window.matchMedia?.('(max-width: 767px)').matches) {
      requestAnimationFrame(() => detailRef.current?.scrollIntoView({ block: 'start' }));
    }
  };

  const row = (en: Entry) => (
    <EntryRow
      key={en.loreId}
      entry={en}
      selected={en.loreId === selected}
      discovered={isDiscovered(en)}
      read={inspected.includes(en.loreId)}
      onSelect={() => pick(en)}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="grid shrink-0 grid-cols-2 gap-2">
        <ProgressStat icon={Cpu} label="Hardwares" value={discoveredArtifacts.length} max={6} color="#22D3EE" />
        <ProgressStat icon={Layers} label="Eras" value={discoveredEras.length} max={10} color="#F472B6" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1 md:grid md:grid-cols-[minmax(220px,270px)_1fr] md:gap-4 md:overflow-hidden md:pr-0">
        <div ref={listRef} className="md:min-h-0 md:overflow-y-auto md:pr-1">
          <ListHeading>Hardwares</ListHeading>
          <div className="grid grid-cols-2 gap-1.5 md:grid-cols-1">{ENTRIES.filter((en) => en.kind === 'artifact').map(row)}</div>
          <ListHeading className="mt-3">Eras</ListHeading>
          <div className="grid grid-cols-2 gap-1.5 md:grid-cols-1">{ENTRIES.filter((en) => en.kind === 'era').map(row)}</div>
        </div>

        <div ref={detailRef} className="mt-4 scroll-mt-2 md:mt-0 md:min-h-0 md:overflow-y-auto md:pr-1">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`${entry.loreId}-${discovered}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
            >
              {discovered ? <DiscoveredDetail entry={entry} /> : <LockedDetail entry={entry} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function ListHeading({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`mb-1.5 font-pixel text-[8px] uppercase tracking-wider text-slate-500 ${className}`}>{children}</div>;
}

function ProgressStat({ icon: Icon, label, value, max, color }: { icon: LucideIcon; label: string; value: number; max: number; color: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="px-2.5 py-2" style={{ background: `${color}12`, boxShadow: `inset 0 0 0 1px ${color}44` }}>
      <div className="flex items-center gap-2">
        <Icon size={15} style={{ color }} />
        <span className="font-terminal text-[22px] leading-none text-white">
          {value}/{max}
        </span>
        <span className="font-pixel text-[8px] uppercase text-slate-400">{label}</span>
      </div>
      <div className="mt-1.5 h-[6px] w-full bg-[#151826]">
        <div className="h-full transition-[width] duration-500" style={{ width: `${pct}%`, background: color, boxShadow: `0 0 8px ${color}` }} />
      </div>
    </div>
  );
}

function entryColor(en: Entry): string {
  if (en.kind === 'era') return ERA_ACCENTS[en.era];
  const first = ARTIFACT_LORE[en.artifact]?.unlockedEras?.[0];
  return first ? ERA_ACCENTS[first] : '#10B981';
}

function EntryRow({
  entry,
  selected,
  discovered,
  read,
  onSelect,
}: {
  entry: Entry;
  selected: boolean;
  discovered: boolean;
  read: boolean;
  onSelect: () => void;
}) {
  const color = discovered ? entryColor(entry) : '#64748B';
  let label: string;
  let sub: string;
  let chip: ReactNode;
  if (entry.kind === 'artifact') {
    const lore = ARTIFACT_LORE[entry.artifact];
    label = discovered ? lore?.name ?? entry.artifact : '???';
    sub = `Hardware · ${lore?.year ?? '????'}`;
    chip = <ArtifactIcon id={entry.artifact} size={15} style={{ color: discovered ? color : '#000', filter: discovered ? undefined : 'drop-shadow(0 0 1px #64748B)' }} />;
  } else {
    const cfg = ERA_CONFIGS[entry.era];
    label = discovered ? `${cfg.year} · ${cfg.name}` : `${cfg.year} · ???`;
    sub = `Era ${ALL_ERAS.indexOf(entry.era) + 1}/10`;
    chip = (
      <span className="font-pixel text-[8px]" style={{ color: discovered ? '#07080D' : '#94A3B8' }}>
        {String(ALL_ERAS.indexOf(entry.era) + 1).padStart(2, '0')}
      </span>
    );
  }
  return (
    <button
      type="button"
      tabIndex={-1}
      data-selected={selected}
      onPointerDown={noFocus}
      onClick={onSelect}
      className="flex w-full min-w-0 items-center gap-2 px-2 py-1.5 text-left outline-none transition-colors"
      style={{
        background: selected ? `${color}24` : 'rgba(255,255,255,.02)',
        boxShadow: selected ? `inset 0 0 0 2px ${color}, 0 0 12px ${color}33` : 'inset 0 0 0 1px #1E293B',
      }}
    >
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center"
        style={
          entry.kind === 'era' && discovered
            ? { background: color, boxShadow: 'inset 0 -2px 0 rgba(0,0,0,.25)' }
            : { background: discovered ? `${color}1F` : '#151826', boxShadow: `inset 0 0 0 1px ${color}66` }
        }
      >
        {chip}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate font-terminal text-[18px] leading-none ${discovered ? 'text-slate-100' : 'text-slate-500'}`}>{label}</span>
        <span className="mt-1 block truncate font-pixel text-[7px] uppercase text-slate-500">{sub}</span>
      </span>
      {!discovered ? (
        <Lock size={12} className="shrink-0 text-slate-600" />
      ) : read ? (
        <Check size={14} className="shrink-0 text-emerald-400" aria-label="Lido" />
      ) : (
        <span className="shrink-0 px-1 py-[2px] font-pixel text-[6px] text-[#07080D]" style={{ background: COLORS.tip }}>
          NOVO
        </span>
      )}
    </button>
  );
}

/** One visual block with an icon: real world / game mechanic / practical tip. */
function LoreBlock({ icon: Icon, color, title, children }: { icon: LucideIcon; color: string; title: string; children: ReactNode }) {
  return (
    <section className="flex gap-3 p-3" style={{ background: `${color}10`, boxShadow: `inset 3px 0 0 ${color}, inset 0 0 0 1px ${color}2A` }}>
      <div className="flex h-10 w-10 shrink-0 items-center justify-center" style={{ background: `${color}22`, color, boxShadow: `inset 0 0 0 2px ${color}77` }}>
        <Icon size={20} />
      </div>
      <div className="min-w-0 flex-1">
        <h4 className="font-pixel text-[9px] uppercase leading-snug sm:text-[10px]" style={{ color }}>
          {title}
        </h4>
        <div className="mt-1.5 space-y-2 font-terminal text-[19px] leading-[1.15] text-slate-200">{children}</div>
      </div>
    </section>
  );
}

/** Small arrow between "real life" and "game": cause → effect. */
function BecomesConnector() {
  return (
    <div className="flex items-center justify-center gap-2 py-1 font-pixel text-[7px] text-slate-500">
      <span className="h-px w-8 bg-slate-700" />▼ NO JOGO, ISSO VIRA ▼<span className="h-px w-8 bg-slate-700" />
    </div>
  );
}

function SubNote({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p className="text-slate-300">
      <span className="text-slate-400">{label}</span> {children}
    </p>
  );
}

function EraChip({ era, withMechanic = false }: { era: EraId; withMechanic?: boolean }) {
  const cfg = ERA_CONFIGS[era];
  const c = ERA_ACCENTS[era];
  return (
    <span className="inline-flex items-baseline gap-1.5 px-1.5 py-[3px] leading-none" style={{ background: `${c}22`, boxShadow: `inset 0 0 0 1px ${c}` }}>
      <span className="text-[19px] font-bold" style={{ color: c }}>
        {cfg.year}
      </span>
      <span className="text-[16px] text-slate-200">{cfg.name}</span>
      {withMechanic && cfg.mechanicLabel && <span className="text-[15px] text-slate-400">· {cfg.mechanicLabel}</span>}
    </span>
  );
}

function DetailHeader({ badge, kicker, title, subtitle, color, tag }: { badge: ReactNode; kicker: string; title: string; subtitle: string; color: string; tag?: string }) {
  return (
    <div className="mb-3 flex items-center gap-3">
      <div className="flex h-14 w-14 shrink-0 items-center justify-center" style={{ background: `${color}1F`, boxShadow: `inset 0 0 0 2px ${color}, 0 0 18px ${color}55` }}>
        {badge}
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-pixel text-[8px] uppercase text-slate-400">{kicker}</div>
        <h3 className="mt-1 font-pixel text-[12px] leading-snug text-white sm:text-[14px]">{title}</h3>
        <div className="font-terminal text-[20px] leading-tight" style={{ color }}>
          {subtitle}
        </div>
        {tag && (
          <span className="mt-1 inline-block px-1.5 py-[2px] font-pixel text-[7px] uppercase text-slate-300" style={{ boxShadow: 'inset 0 0 0 1px #334155' }}>
            {tag}
          </span>
        )}
      </div>
    </div>
  );
}

function DiscoveredDetail({ entry }: { entry: Entry }) {
  if (entry.kind === 'artifact') {
    const lore = ARTIFACT_LORE[entry.artifact];
    if (!lore) return null;
    const color = entryColor(entry);
    return (
      <div>
        <DetailHeader
          badge={<ArtifactIcon id={entry.artifact} size={28} style={{ color }} />}
          kicker={`Hardware · ${lore.year}`}
          title={lore.name}
          subtitle={`“${lore.popularNickname}”`}
          color={color}
        />
        <LoreBlock icon={Globe} color={COLORS.real} title="Como era na vida real">
          <p>{lore.realWorldReference}</p>
          {lore.culturalFootnote && <SubNote label="Curiosidade:">{lore.culturalFootnote}</SubNote>}
        </LoreBlock>
        <BecomesConnector />
        <LoreBlock icon={Gamepad2} color={COLORS.game} title="Por que vira essa mecânica no jogo">
          <p>{lore.gameplayTranslation}</p>
        </LoreBlock>
        <div className="h-2" />
        <LoreBlock icon={Lightbulb} color={COLORS.tip} title="Dica prática na fase">
          <div>
            <div className="mb-1.5 text-slate-400">Este hardware liberou na timeline:</div>
            <div className="flex flex-wrap gap-1.5">
              {(lore.unlockedEras ?? []).map((e) => (
                <EraChip key={e} era={e} withMechanic />
              ))}
            </div>
          </div>
          {lore.impactQuote && (
            <p className="border-l-2 pl-2 italic text-slate-300" style={{ borderColor: COLORS.tip }}>
              “{lore.impactQuote}”
            </p>
          )}
        </LoreBlock>
      </div>
    );
  }

  const lore = ERA_LORE[entry.era];
  const cfg = ERA_CONFIGS[entry.era];
  if (!lore) return null;
  const color = ERA_ACCENTS[entry.era];
  return (
    <div>
      <DetailHeader
        badge={<span className="font-pixel text-[12px]" style={{ color }}>{cfg.year}</span>}
        kicker={`Era ${ALL_ERAS.indexOf(entry.era) + 1}/10 · ${lore.year}`}
        title={lore.title}
        subtitle={lore.subtitle}
        color={color}
        tag={lore.paradigm}
      />
      <LoreBlock icon={Globe} color={COLORS.real} title="Como era na vida real">
        <p>{lore.realWorldReference}</p>
        {lore.everydayExperience && <SubNote label="No dia a dia:">{lore.everydayExperience}</SubNote>}
      </LoreBlock>
      <BecomesConnector />
      <LoreBlock icon={Gamepad2} color={COLORS.game} title="Por que vira essa mecânica no jogo">
        <p>{lore.mechanicExplanation}</p>
        {cfg.mechanicLabel && (
          <p>
            <span className="text-slate-400">Mecânica destaque:</span>{' '}
            <span className="px-1.5" style={{ color: '#07080D', background: COLORS.game }}>
              {cfg.mechanicLabel}
            </span>
          </p>
        )}
      </LoreBlock>
      <div className="h-2" />
      <LoreBlock icon={Lightbulb} color={COLORS.tip} title="Dica prática na fase">
        <p>{lore.quickTipToast}</p>
      </LoreBlock>
    </div>
  );
}

function LockedDetail({ entry }: { entry: Entry }) {
  const isArtifact = entry.kind === 'artifact';
  const lore = isArtifact ? ARTIFACT_LORE[entry.artifact] : ERA_LORE[entry.era];
  const year = isArtifact ? ARTIFACT_LORE[entry.artifact]?.year : ERA_CONFIGS[entry.era].year;
  return (
    <div className="flex flex-col items-center px-2 py-6 text-center">
      <div className="relative flex h-24 w-24 items-center justify-center" style={{ background: '#0B0D14', boxShadow: 'inset 0 0 0 2px #334155' }}>
        {isArtifact ? (
          <ArtifactIcon id={entry.artifact} size={52} strokeWidth={2.5} style={{ color: '#000', filter: 'drop-shadow(0 0 2px #475569)' }} />
        ) : (
          <span className="font-pixel text-[26px] text-slate-700">??</span>
        )}
        <Lock size={16} className="absolute -right-2 -top-2 text-slate-400" />
      </div>
      <div className="mt-4 font-pixel text-[18px] text-slate-500">???</div>
      <div className="mt-1 font-terminal text-[22px] text-slate-400">
        {isArtifact ? 'Hardware' : 'Era'} de {year ?? '????'}
      </div>
      <div className="mt-4 flex max-w-md gap-2 p-3 text-left" style={{ background: `${COLORS.tip}10`, boxShadow: `inset 3px 0 0 ${COLORS.tip}` }}>
        <HelpCircle size={18} className="mt-[2px] shrink-0" style={{ color: COLORS.tip }} />
        <p className="font-terminal text-[19px] leading-tight text-slate-200">
          <span style={{ color: COLORS.tip }}>Pista:</span> {lore?.discoveryHint ?? 'Continue explorando a fase.'}
        </p>
      </div>
      <p className="mt-3 font-pixel text-[7px] text-slate-600">
        {isArtifact ? 'COLETE ESTE HARDWARE PARA LER A HISTÓRIA' : 'DESBLOQUEIE ESTA ERA PARA LER A HISTÓRIA'}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 2 — Conquistas
// ---------------------------------------------------------------------------

function AchievementsTab({ scrollRef, accent }: { scrollRef: RefObject<HTMLDivElement>; accent: string }) {
  useAchievementVersion();
  const [filter, setFilter] = useState<Filter>('all');
  const achievements = AchievementSystem.getAchievements();
  const stats = AchievementSystem.getRunStats();
  const visible = filter === 'all' ? achievements : achievements.filter((a) => a.category === filter);
  const unlockedCount = achievements.filter((a) => a.unlocked).length;

  return (
    <div ref={scrollRef} className="h-full min-h-0 overflow-y-auto pr-1">
      <RunHeader stats={stats} />

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => {
          const on = filter === f.id;
          const list = f.id === 'all' ? achievements : achievements.filter((a) => a.category === f.id);
          return (
            <button
              key={f.id}
              type="button"
              tabIndex={-1}
              onPointerDown={noFocus}
              onClick={() => {
                if (!on) click();
                setFilter(f.id);
              }}
              className="flex items-center gap-1.5 px-2 py-1.5 font-pixel text-[8px] uppercase outline-none transition-colors"
              style={{
                color: on ? '#07080D' : '#CBD5E1',
                background: on ? accent : 'transparent',
                boxShadow: on ? `0 0 12px ${accent}55` : `inset 0 0 0 1px ${accent}44`,
              }}
            >
              {f.label}
              <span className="opacity-70">
                {list.filter((a) => a.unlocked).length}/{list.length}
              </span>
            </button>
          );
        })}
        <span className="ml-auto font-terminal text-[18px] text-slate-400">
          <Trophy size={13} className="mr-1 inline-block align-[-1px]" style={{ color: accent }} />
          {unlockedCount}/{achievements.length} desbloqueadas
        </span>
      </div>

      <div className="mt-3 grid gap-2.5 lg:grid-cols-2">
        {visible.map((a) => (
          <AchievementCard key={a.id} achievement={a} />
        ))}
        {visible.length === 0 && <p className="font-terminal text-[19px] text-slate-500">Nenhuma conquista nesta categoria.</p>}
      </div>
    </div>
  );
}

function RunHeader({ stats }: { stats: RunStats }) {
  const clean = stats.deaths === 0;
  const tiles: { icon: LucideIcon; label: string; value: string; sub?: string; color: string }[] = [
    { icon: Timer, label: 'Tempo', value: formatRunTime(stats.elapsedMs), color: '#22D3EE' },
    { icon: Skull, label: 'Mortes totais', value: String(stats.deaths), color: clean ? COLORS.ok : COLORS.danger },
    { icon: Skull, label: 'Mortes no setor', value: String(stats.sectorDeaths), sub: `Setor ${stats.currentSector}`, color: stats.sectorDeaths === 0 ? COLORS.ok : '#FB923C' },
  ];
  const badge = clean ? COLORS.ok : COLORS.danger;
  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        {tiles.map((t) => (
          <div key={t.label} className="px-2 py-2" style={{ background: `${t.color}10`, boxShadow: `inset 0 0 0 1px ${t.color}44` }}>
            <div className="flex items-center gap-1.5 font-pixel text-[7px] uppercase leading-tight text-slate-400">
              <t.icon size={12} className="shrink-0" style={{ color: t.color }} />
              {t.label}
            </div>
            <div className="mt-1 font-terminal text-[26px] leading-none tabular-nums text-white">{t.value}</div>
            {t.sub && <div className="font-terminal text-[15px] leading-none text-slate-500">{t.sub}</div>}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-start gap-2 px-3 py-2" style={{ background: `${badge}14`, boxShadow: `inset 0 0 0 2px ${badge}88` }}>
        {clean ? <ShieldCheck size={18} className="mt-[1px] shrink-0" style={{ color: badge }} /> : <Skull size={18} className="mt-[1px] shrink-0" style={{ color: badge }} />}
        <div className="min-w-0">
          <div className="font-pixel text-[8px] leading-relaxed sm:text-[9px]" style={{ color: badge }}>
            STATUS KERNEL PANIC ZERO: {clean ? 'ATIVO (0 mortes)' : `FALHOU NESTA RUN (${stats.deaths} ${stats.deaths === 1 ? 'morte' : 'mortes'})`}
          </div>
          <div className="mt-0.5 font-terminal text-[16px] leading-tight text-slate-400">
            “Kernel panic” é o erro fatal que derruba o sistema inteiro. Termine a jornada sem nenhuma morte para manter o status.
          </div>
        </div>
      </div>
    </div>
  );
}

function AchievementCard({ achievement: a }: { achievement: Achievement }) {
  const rarity = RARITY_META[a.rarity] ?? RARITY_META.common;
  const Icon = achievementIcon(a.icon);
  const epic = a.rarity === 'epic';
  const showProgress = a.maxProgress > 1;
  const progress = Math.min(a.progress, a.maxProgress);
  const color = a.unlocked ? rarity.color : '#475569';

  return (
    <article
      className="flex flex-col gap-2 p-3"
      style={{
        background: a.unlocked ? `linear-gradient(180deg, ${rarity.color}1C, #0B0D14 70%)` : '#0B0D14',
        boxShadow: a.unlocked ? `inset 0 0 0 2px ${rarity.color}99${epic ? `, 0 0 18px ${rarity.color}40` : ''}` : 'inset 0 0 0 1px #1E293B',
      }}
    >
      <header className="flex items-start gap-3">
        <div
          className="relative flex h-11 w-11 shrink-0 items-center justify-center"
          style={
            a.unlocked
              ? { background: rarity.color, color: '#07080D', boxShadow: `0 0 14px ${rarity.color}66, inset 0 -3px 0 rgba(0,0,0,.25)` }
              : { background: '#151826', color: '#475569', boxShadow: 'inset 0 0 0 1px #334155' }
          }
        >
          <Icon size={22} />
          {!a.unlocked && <Lock size={11} className="absolute -bottom-1 -right-1 text-slate-400" />}
          {a.unlocked && epic && <Sparkles size={12} className="absolute -right-1.5 -top-1.5" style={{ color: rarity.color }} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 font-pixel text-[7px] uppercase leading-none">
            <span className="px-1 py-[3px]" style={{ color: rarity.color, boxShadow: `inset 0 0 0 1px ${rarity.color}`, background: `${rarity.color}18` }}>
              {rarity.label}
            </span>
            <span className="text-slate-500">{CATEGORY_LABELS[a.category] ?? a.category}</span>
          </div>
          <h4 className={`mt-1 font-terminal text-[23px] leading-none ${a.unlocked ? 'text-white' : 'text-slate-300'}`}>{a.title}</h4>
          {a.unlocked ? (
            <div className="mt-0.5 flex items-center gap-1 font-terminal text-[15px] leading-none" style={{ color: COLORS.ok }}>
              <Check size={12} />
              {a.unlockedAt ? `Desbloqueada em ${new Date(a.unlockedAt).toLocaleDateString('pt-BR')}` : 'Desbloqueada'}
            </div>
          ) : (
            <div className="mt-0.5 font-terminal text-[15px] leading-none text-slate-500">Bloqueada</div>
          )}
        </div>
      </header>

      {showProgress && (
        <div className="flex items-center gap-2">
          <div className="h-[6px] flex-1 bg-[#151826]">
            <div className="h-full" style={{ width: `${(progress / a.maxProgress) * 100}%`, background: color, boxShadow: a.unlocked ? `0 0 8px ${color}` : undefined }} />
          </div>
          <span className="font-terminal text-[16px] leading-none tabular-nums text-slate-400">
            {progress}/{a.maxProgress}
          </span>
        </div>
      )}

      <div className="font-terminal text-[18px] leading-[1.15] text-slate-200">
        <span className="text-slate-400">Para desbloquear:</span> {a.description}
      </div>
      <div className="flex gap-1.5 font-terminal text-[17px] leading-[1.15] text-amber-100/90">
        <Lightbulb size={14} className="mt-[2px] shrink-0" style={{ color: COLORS.tip }} />
        <span>
          <span style={{ color: COLORS.tip }}>Dica:</span> {a.hint}
        </span>
      </div>

      <div className="p-2.5" style={{ background: `${COLORS.real}10`, boxShadow: `inset 0 0 0 1px ${COLORS.real}40` }}>
        <div className="flex items-center gap-1.5 font-pixel text-[8px] uppercase" style={{ color: COLORS.real }}>
          <BookOpen size={13} />
          A referência real
        </div>
        {a.unlocked ? (
          <p className="mt-1.5 font-terminal text-[18px] leading-[1.15] text-slate-200">{a.referenceExplained}</p>
        ) : (
          <div className="relative mt-1.5">
            <p aria-hidden="true" className="line-clamp-2 select-none font-terminal text-[18px] leading-[1.15] text-slate-400" style={{ filter: 'blur(5px)' }}>
              {a.referenceExplained}
            </p>
            <div className="absolute inset-0 flex items-center justify-center gap-1.5 font-pixel text-[8px] uppercase text-slate-300">
              <Lock size={12} />
              Desbloqueie para ler
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

export default MuseumModal;
