/**
 * Toast de "Era bloqueada" (ERA_LOCKED).
 * A coleta de artefato não gera toast: cada HUD de era já tem seu próprio indicador temático.
 */
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Lock } from 'lucide-react';
import { EventBus } from '../../core/EventBus';
import { ARTIFACTS, ERA_CONFIGS } from '../../core/EraManager';
import type { ArtifactId, EraId } from '../../core/types';

type Toast = { key: number; era: EraId; artifact: ArtifactId | null };

export function ArtifactToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  useEffect(() => {
    const timers = new Set<number>();
    const push = (toast: Toast, ms: number) => {
      // Um aviso de bloqueio por vez (evita empilhar ao apertar a tecla repetidamente).
      setToasts([toast]);
      const id = window.setTimeout(() => {
        timers.delete(id);
        setToasts((t) => t.filter((x) => x.key !== toast.key));
      }, ms);
      timers.add(id);
    };
    const offLocked = EventBus.on('ERA_LOCKED', ({ era, artifact }) =>
      push({ key: ++seq.current, era, artifact }, 2400),
    );
    return () => {
      offLocked();
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, []);

  return (
    <div className="pointer-events-none absolute left-1/2 top-[18%] z-40 flex -translate-x-1/2 flex-col items-center gap-2">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.key}
            layout
            initial={{ opacity: 0, y: -16, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.22 }}
            className="flex items-center gap-3 rounded-2xl border border-rose-500/40 bg-slate-900/80 px-4 py-2.5 font-poppins text-slate-100 backdrop-blur-md"
            style={{ boxShadow: '0 0 30px rgba(244,63,94,.2), 0 10px 30px rgba(0,0,0,.4)' }}
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/20 text-rose-300">
              <Lock size={20} />
            </div>
            <div className="leading-tight">
              <div className="text-[13px] font-semibold">
                {ERA_CONFIGS[t.era].year} ainda está bloqueada
              </div>
              {t.artifact && (
                <div className="mt-0.5 text-[11px] text-slate-400">
                  Encontre o artefato <span className="text-rose-200">{ARTIFACTS[t.artifact].name}</span> para liberar
                </div>
              )}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export default ArtifactToasts;
