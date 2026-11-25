/** Tela de vitória (fim de jogo arcade): nota, contadores, artefatos e "Jogar novamente". */
import { useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { EventBus } from '../../core/EventBus';
import { ARTIFACTS, EraManager } from '../../core/EraManager';
import { ALL_ERAS } from '../../core/types';
import type { PlayerStats } from '../../core/types';
import { ARTIFACT_ORDER, ArtifactIcon, ERA_ACCENTS, hasArtifact, pad } from './shared';
import { emitWindows, resetWindows } from './windowStore';
import { Blink, CrtOverlay, EraStripe, GameMenu, LayeredTitle, PixelPanel, useCountUp } from './screenKit';

const ACCENT = '#10B981';
const RANK_DELAY_MS = 1300;

export function restartGame(): void {
  EventBus.emit('PLAY_SFX', { sound: 'click' });
  resetWindows();
  EraManager.reset();
  emitWindows();
  EventBus.emit('GAME_RESTART', {});
  EventBus.emit('GAME_STATE_CHANGED', { state: 'playing' });
}

/** Nota final: artefatos pesam mais, mortes descontam. */
function rankOf(artifacts: number, deaths: number): { letter: string; color: string; label: string } {
  const all = artifacts === ARTIFACT_ORDER.length;
  if (all && deaths <= 3) return { letter: 'S', color: '#FACC15', label: 'LENDA DA INTERFACE' };
  if (all && deaths <= 10) return { letter: 'A', color: '#10B981', label: 'ARQUEÓLOGO DIGITAL' };
  if (artifacts >= 4) return { letter: 'B', color: '#6C8CFF', label: 'VIAJANTE DO TEMPO' };
  return { letter: 'C', color: '#94A3B8', label: 'TURISTA TEMPORAL' };
}

/** Quadradinhos caindo nas cores das eras. */
function PixelConfetti() {
  const bits = useMemo(
    () =>
      Array.from({ length: 36 }, (_, i) => ({
        left: (i * 53) % 100,
        size: 6 + ((i * 7) % 3) * 3,
        delay: (i % 12) * 0.35,
        duration: 4 + (i % 5),
        color: ERA_ACCENTS[ALL_ERAS[i % ALL_ERAS.length]],
      })),
    [],
  );
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden motion-reduce:hidden">
      {bits.map((b, i) => (
        <span
          key={i}
          className="absolute top-0"
          style={{
            left: `${b.left}%`,
            width: b.size,
            height: b.size,
            background: b.color,
            opacity: 0.7,
            transform: 'translateY(-10vh)',
            animation: `eras-fall ${b.duration}s linear ${b.delay}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

function StatBox({ label, value, digits, color, delay }: { label: string; value: number; digits: number; color: string; delay: number }) {
  const v = useCountUp(value, 900, delay);
  return (
    <div className="px-2 py-3 text-center" style={{ background: '#0B0D14', boxShadow: `inset 0 0 0 2px ${color}44` }}>
      <div className="font-pixel text-[8px] text-slate-400">{label}</div>
      <div className="mt-2 font-pixel text-[16px] sm:text-[20px]" style={{ color, textShadow: `0 0 12px ${color}88` }}>
        {pad(v, digits)}
      </div>
    </div>
  );
}

export default function VictoryScreen({ stats }: { stats: PlayerStats }) {
  const got = ARTIFACT_ORDER.filter((id) => hasArtifact(stats, id)).length;
  const rank = rankOf(got, stats.deaths);
  const items = useMemo(
    () => [
      { label: 'JOGAR NOVAMENTE', onSelect: restartGame },
      { label: 'MUSEU & CONQUISTAS', onSelect: () => EventBus.emit('CODEX_OPENED', { tab: 'achievements' }), color: '#FACC15' },
    ],
    [],
  );

  // "Carimbo" da nota.
  useEffect(() => {
    const id = window.setTimeout(() => EventBus.emit('PLAY_SFX', { sound: 'impact' }), RANK_DELAY_MS + 50);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <motion.div
      className="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#05060A]/95 p-4 text-slate-100"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.25 } }}
    >
      <PixelConfetti />
      <div className="pointer-events-none absolute left-1/2 top-1/3 h-80 w-80 -translate-x-1/2 rounded-full blur-3xl" style={{ background: `${rank.color}22` }} />

      <div className="relative z-10 flex w-full max-w-xl flex-col items-center text-center">
        <motion.div className="font-pixel text-[10px] tracking-[0.3em] text-emerald-300" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          FIM DE JOGO
        </motion.div>
        <motion.div
          className="mt-4"
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 200, damping: 12 }}
        >
          <LayeredTitle text="LINHA DO TEMPO" size="clamp(18px, 4.2vw, 34px)" />
          <LayeredTitle text="RESTAURADA!" size="clamp(18px, 4.2vw, 34px)" className="mt-3" />
        </motion.div>
        <EraStripe className="mt-6 w-full max-w-md" />

        <PixelPanel accent={rank.color} className="mt-6 w-full">
          <div className="flex items-center gap-5">
            {/* Nota */}
            <motion.div
              className="flex h-24 w-24 shrink-0 flex-col items-center justify-center"
              style={{ background: '#07080D', boxShadow: `inset 0 0 0 3px ${rank.color}, 0 0 28px ${rank.color}55` }}
              initial={{ scale: 2.4, rotate: -14, opacity: 0 }}
              animate={{ scale: 1, rotate: -6, opacity: 1 }}
              transition={{ delay: RANK_DELAY_MS / 1000, type: 'spring', stiffness: 260, damping: 13 }}
            >
              <div className="font-pixel text-[8px] text-slate-400">NOTA</div>
              <div className="mt-1 font-pixel text-[44px] leading-none" style={{ color: rank.color, textShadow: '3px 3px 0 #000' }}>
                {rank.letter}
              </div>
            </motion.div>
            <div className="min-w-0 flex-1">
              <div className="mb-3 text-left font-pixel text-[10px]" style={{ color: rank.color }}>
                {rank.label}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <StatBox label="MOEDAS" value={stats.coins} digits={3} color="#FACC15" delay={200} />
                <StatBox label="MORTES" value={stats.deaths} digits={3} color="#F43F5E" delay={500} />
                <StatBox label="ARTEF." value={got} digits={1} color="#10B981" delay={800} />
              </div>
            </div>
          </div>

          {/* Slots de artefato */}
          <div className="mt-5 grid grid-cols-6 gap-2">
            {ARTIFACT_ORDER.map((id, i) => {
              const on = hasArtifact(stats, id);
              return (
                <motion.div
                  key={id}
                  title={ARTIFACTS[id].name}
                  className="flex aspect-square items-center justify-center"
                  style={{
                    background: on ? `${ACCENT}22` : '#0B0D14',
                    boxShadow: on ? `inset 0 0 0 2px ${ACCENT}, 0 0 14px ${ACCENT}55` : 'inset 0 0 0 2px #1E293B',
                  }}
                  initial={{ y: 10, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.9 + i * 0.08 }}
                >
                  <ArtifactIcon id={id} size={22} className={on ? 'text-emerald-300' : 'text-slate-700'} />
                </motion.div>
              );
            })}
          </div>

          <div className="mt-5">
            <GameMenu items={items} accent={ACCENT} />
          </div>
        </PixelPanel>

        <div className="mt-4 font-pixel text-[10px] text-slate-300">
          <Blink>OBRIGADO POR JOGAR</Blink>
        </div>
      </div>
      <CrtOverlay strength={0.8} />
    </motion.div>
  );
}
