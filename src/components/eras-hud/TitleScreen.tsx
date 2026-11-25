/** Tela de título (arcade/CRT): menu ↑↓ + Enter → GAME_STATE_CHANGED 'playing'. */
import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { EventBus } from '../../core/EventBus';
import { ALL_ERAS } from '../../core/types';
import { ERA_CONFIGS } from '../../core/EraManager';
import { ERA_ACCENTS } from './shared';
import { useInputMode } from './hooks';
import { Blink, CrtOverlay, EraStripe, GameMenu, KeyCap, LayeredTitle, PerspectiveGrid, PixelPanel } from './screenKit';

const CONTROLS: [string, string][] = [
  ['← →', 'mover'],
  ['Espaço', 'pular'],
  ['1 … 0', 'viajar entre eras'],
  ['X / K / Shift', 'dash (2013+)'],
  ['Shift', 'bullet time (1999)'],
  ['Mouse', 'arrastar janelas (1984) / fechar pop-ups (1995)'],
  ['Esc / P', 'pausar'],
];

const TOUCH_CONTROLS: [string, string][] = [
  ['Direcional', 'mover (8 direções)'],
  ['A', 'pular'],
  ['B', 'dash (2013+)'],
  ['BT', 'bullet time (1999)'],
  ['Barra de eras', 'viajar entre eras'],
  ['Toque', 'arrastar janelas (1984) / fechar pop-ups (1995)'],
  ['⏸', 'pausar'],
  ['📖', 'museu'],
];

const PAD_CONTROLS: [string, string][] = [
  ['Analógico / D-pad', 'mover'],
  ['A', 'pular / confirmar'],
  ['LB / RB', 'viajar entre eras'],
  ['B / X / RT', 'dash (2013+)'],
  ['LT', 'bullet time (1999)'],
  ['Mouse', 'arrastar janelas (1984) / fechar pop-ups (1995)'],
  ['START', 'pausar'],
  ['SELECT', 'museu'],
];

const ACCENT = '#10B981';

export function startGame(): void {
  EventBus.emit('PLAY_SFX', { sound: 'click' });
  EventBus.emit('GAME_STATE_CHANGED', { state: 'playing' });
}

const DROP_COUNT = 34;

/** Pseudoaleatório determinístico (mulberry32): mesma chuva a cada abertura. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Anos das eras caindo do topo em colunas, como uma chuva de dados.
 * Delay negativo: já começam espalhados pela tela. Perto do centro ficam
 * menores e mais apagados para não brigar com o logo e o menu.
 * Com "reduzir movimento" a chuva continua (é o destaque da tela), só 3× mais lenta.
 */
function FallingYears() {
  const drops = useMemo(() => {
    const slow = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 3 : 1;
    const rand = seeded(1958);
    return Array.from({ length: DROP_COUNT }, (_, i) => {
      const id = ALL_ERAS[(i * 7) % ALL_ERAS.length];
      const left = rand() * 90 + 1.5;
      const center = left > 28 && left < 72;
      const size = center ? 14 + (i % 3) * 3 : 18 + (i % 4) * 5;
      const duration = (7 + ((i * 13) % 9)) * slow;
      // Fase espalhada em 0..1 do ciclo, independente da duração.
      const phase = rand();
      return {
        key: i,
        year: ERA_CONFIGS[id].year,
        color: ERA_ACCENTS[id],
        left,
        size,
        duration,
        delay: -phase * duration,
        opacity: center ? 0.16 : 0.32 + (i % 3) * 0.1,
      };
    });
  }, []);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {drops.map((d) => (
        <span
          key={d.key}
          className="eras-drop absolute top-0 font-pixel leading-none"
          style={{
            left: `${d.left}%`,
            fontSize: d.size,
            color: d.color,
            opacity: d.opacity,
            textShadow: `0 0 12px ${d.color}88`,
            animationDuration: `${d.duration}s`,
            animationDelay: `${d.delay}s`,
          }}
        >
          {d.year}
        </span>
      ))}
    </div>
  );
}

export default function TitleScreen() {
  const mode = useInputMode();
  const isPad = mode === 'gamepad';
  const isTouch = mode === 'touch';
  const [showControls, setShowControls] = useState(false);

  const items = useMemo(
    () =>
      showControls
        ? [
            {
              label: 'VOLTAR',
              onSelect: () => {
                EventBus.emit('PLAY_SFX', { sound: 'click' });
                setShowControls(false);
              },
            },
          ]
        : [
            { label: 'INICIAR JORNADA', onSelect: startGame },
            {
              label: 'CONTROLES',
              onSelect: () => {
                EventBus.emit('PLAY_SFX', { sound: 'click' });
                setShowControls(true);
              },
            },
          ],
    [showControls],
  );

  return (
    <motion.div
      className="pointer-events-auto absolute inset-0 z-50 flex flex-col items-center overflow-y-auto overflow-x-hidden bg-[#05060A] p-4 text-slate-100"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.3 } }}
    >
      {/* Céu: brilho no horizonte + chuva de anos das eras */}
      <div
        className="pointer-events-none absolute inset-x-0 top-1/2 h-40 -translate-y-1/2"
        style={{
          background: `radial-gradient(ellipse at center, ${ACCENT}33, transparent 70%)`,
        }}
      />
      <FallingYears />
      <PerspectiveGrid color={ACCENT} />

      <div className="relative z-10 m-auto flex w-full max-w-2xl flex-col items-center py-4 text-center">
        <motion.div
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 160, damping: 14 }}
        >
          <LayeredTitle text="ERAS" size="clamp(48px, 11vw, 104px)" />
        </motion.div>
        <motion.div
          className="mt-6 font-pixel text-[11px] tracking-[0.3em] text-emerald-300 sm:text-[14px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.35 }}
        >
          CRÔNICAS DA INTERFACE
        </motion.div>
        <div className="mt-4 flex w-full max-w-md items-center gap-3 font-pixel text-[9px] text-slate-400">
          <span>1958</span>
          <EraStripe className="flex-1" />
          <span>2026</span>
        </div>

        <motion.div
          className={`mt-8 w-full ${showControls ? 'max-w-xl' : 'max-w-sm'}`}
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.5 }}
        >
          <AnimatePresence mode="wait">
            {showControls && (
              <motion.div
                key="controls"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mb-3"
              >
                <PixelPanel accent="#6366F1">
                  <div className="mb-3 font-pixel text-[11px] text-indigo-200">CONTROLES</div>
                  <ul className="grid grid-cols-1 gap-x-5 gap-y-1.5 text-left font-terminal text-[19px] leading-tight sm:grid-cols-2">
                    {(isTouch ? TOUCH_CONTROLS : isPad ? PAD_CONTROLS : CONTROLS).map(([k, a]) => (
                      <li key={k} className="flex items-center gap-3 text-slate-300">
                        <KeyCap>{k}</KeyCap>
                        {a}
                      </li>
                    ))}
                  </ul>
                </PixelPanel>
              </motion.div>
            )}
          </AnimatePresence>
          <GameMenu items={items} accent={ACCENT} />
        </motion.div>

        <div className="mt-6 font-pixel text-[10px] text-slate-300">
          <Blink>{isTouch ? 'TOQUE PARA ESCOLHER' : isPad ? 'PRESSIONE A' : 'PRESSIONE ENTER'}</Blink>
        </div>
        <div className="mt-3 font-terminal text-[18px] text-slate-500">10 eras · 6 artefatos · 70 anos de interfaces</div>
      </div>

      <CrtOverlay />
    </motion.div>
  );
}
