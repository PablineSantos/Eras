/**
 * Peças visuais das telas de título / pausa / vitória: moldura de CRT,
 * faixa das eras, logo em camadas e menu navegável por teclado (↑↓ + Enter).
 */
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { motion } from 'framer-motion';
import { EventBus } from '../../core/EventBus';
import { ALL_ERAS } from '../../core/types';
import { ERA_CONFIGS } from '../../core/EraManager';
import { ERA_ACCENTS } from './shared';

/** Scanlines + vinheta + leve cintilação, por cima de tudo (sem capturar o ponteiro). */
export function CrtOverlay({ strength = 1 }: { strength?: number }) {
  return (
    <>
      <div
        className="pointer-events-none absolute inset-0 z-[60] eras-crt-flicker"
        style={{
          opacity: 0.55 * strength,
          background: 'repeating-linear-gradient(180deg, rgba(0,0,0,0) 0px, rgba(0,0,0,0) 2px, rgba(0,0,0,.35) 3px, rgba(0,0,0,0) 4px)',
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 z-[60]"
        style={{ background: 'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,.75) 100%)', opacity: strength }}
      />
    </>
  );
}

/** Piso em perspectiva rolando (horizonte no meio da tela). */
export function PerspectiveGrid({ color = '#10B981' }: { color?: string }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 overflow-hidden" style={{ perspective: '320px' }}>
      <div
        className="eras-grid-scroll absolute -inset-x-1/2 bottom-0 h-[200%]"
        style={{
          transform: 'rotateX(62deg)',
          transformOrigin: '50% 100%',
          backgroundImage: `linear-gradient(${color}55 2px, transparent 2px), linear-gradient(90deg, ${color}55 2px, transparent 2px)`,
          backgroundSize: '56px 56px',
          maskImage: 'linear-gradient(180deg, transparent 0%, #000 45%)',
          WebkitMaskImage: 'linear-gradient(180deg, transparent 0%, #000 45%)',
        }}
      />
    </div>
  );
}

/** Faixa de blocos com a cor de cada era (acende em sequência). */
export function EraStripe({ height = 6, className = '' }: { height?: number; className?: string }) {
  return (
    <div className={`flex gap-[3px] ${className}`}>
      {ALL_ERAS.map((id, i) => (
        <motion.span
          key={id}
          title={String(ERA_CONFIGS[id].year)}
          className="flex-1"
          style={{ height, background: ERA_ACCENTS[id], boxShadow: `0 0 8px ${ERA_ACCENTS[id]}88` }}
          initial={{ opacity: 0, scaleY: 0 }}
          animate={{ opacity: 1, scaleY: 1 }}
          transition={{ delay: 0.06 * i, duration: 0.2 }}
        />
      ))}
    </div>
  );
}

/** Texto em fonte pixel com "sombras" empilhadas nas cores das eras. */
export function LayeredTitle({ text, size, className = '' }: { text: string; size: string; className?: string }) {
  const layers = ALL_ERAS.slice(0, 6)
    .map((id, i) => `${(i + 1) * 2}px ${(i + 1) * 2}px 0 ${ERA_ACCENTS[ALL_ERAS[ALL_ERAS.length - 1 - i]]}`)
    .join(', ');
  return (
    <h1
      className={`font-pixel leading-none tracking-wider text-white ${className}`}
      style={{ fontSize: size, textShadow: layers }}
    >
      {text}
    </h1>
  );
}

/** Painel com cantos "recortados" em pixel e borda dupla na cor de acento. */
export function PixelPanel({
  accent,
  children,
  className = '',
  style,
}: {
  accent: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const notch = 'polygon(8px 0, calc(100% - 8px) 0, 100% 8px, 100% calc(100% - 8px), calc(100% - 8px) 100%, 8px 100%, 0 calc(100% - 8px), 0 8px)';
  return (
    <div className={`relative ${className}`} style={{ clipPath: notch, background: accent, padding: 3, ...style }}>
      <div className="h-full" style={{ clipPath: notch, background: '#07080D', padding: 3 }}>
        <div className="h-full p-5" style={{ clipPath: notch, background: `linear-gradient(180deg, ${accent}1F, #0B0D14 40%)`, outline: `1px solid ${accent}44` }}>
          {children}
        </div>
      </div>
    </div>
  );
}

/** Texto piscando (estilo "PRESS START"). */
export function Blink({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`eras-blink ${className}`}>{children}</span>;
}

export interface MenuItem {
  label: string;
  onSelect: () => void;
  /** Cor do item quando selecionado (padrão: accent do menu). */
  color?: string;
}

/**
 * Lista vertical estilo console: ↑/↓ (ou W/S) movem o cursor, Enter confirma,
 * mouse também funciona. Space fica de fora para não vazar um pulo ao voltar ao jogo.
 */
export function GameMenu({ items, accent, initial = 0 }: { items: MenuItem[]; accent: string; initial?: number }) {
  const [index, setIndex] = useState(initial);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const indexRef = useRef(index);
  indexRef.current = index;

  // Menu trocou (ex.: pausa → confirmação): cursor volta ao item inicial (o seguro).
  useEffect(() => setIndex(initial), [items, initial]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const list = itemsRef.current;
      if (e.code === 'ArrowUp' || e.code === 'KeyW') {
        e.preventDefault();
        setIndex((i) => (i - 1 + list.length) % list.length);
        EventBus.emit('PLAY_SFX', { sound: 'click' });
      } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        e.preventDefault();
        setIndex((i) => (i + 1) % list.length);
        EventBus.emit('PLAY_SFX', { sound: 'click' });
      } else if (e.key === 'Enter' && !e.repeat) {
        e.preventDefault();
        list[indexRef.current]?.onSelect();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <ul className="flex flex-col items-stretch gap-2 font-pixel text-[13px] sm:text-[15px]">
      {items.map((item, i) => {
        const on = i === index;
        const c = item.color ?? accent;
        return (
          <li key={item.label}>
            <button
              type="button"
              tabIndex={-1}
              onPointerDown={(e) => e.preventDefault()}
              onMouseEnter={() => setIndex(i)}
              onClick={item.onSelect}
              className="relative flex w-full items-center gap-3 px-4 py-3 text-left outline-none transition-colors"
              style={{
                color: on ? '#07080D' : '#CBD5E1',
                background: on ? c : 'transparent',
                boxShadow: on ? `0 0 24px ${c}66, inset 0 -4px 0 rgba(0,0,0,.25)` : `inset 0 0 0 2px ${c}33`,
              }}
            >
              <span className={on ? 'eras-cursor' : 'opacity-0'}>▶</span>
              <span className="flex-1">{item.label}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Tecla desenhada como um botão de teclado em pixel. */
export function KeyCap({ children, accent = '#6366F1' }: { children: ReactNode; accent?: string }) {
  return (
    <kbd
      className="inline-block whitespace-nowrap px-1.5 py-[2px] font-terminal text-[18px] leading-none text-white"
      style={{ background: '#151826', boxShadow: `inset 0 0 0 2px ${accent}88, inset 0 -3px 0 ${accent}55` }}
    >
      {children}
    </kbd>
  );
}

/** Contador animado (0 → valor) para estatísticas. */
export function useCountUp(target: number, ms = 900, delay = 0): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    let start = 0;
    const timer = window.setTimeout(() => {
      const step = (t: number) => {
        if (!start) start = t;
        const k = Math.min(1, (t - start) / ms);
        setV(Math.round(target * (1 - Math.pow(1 - k, 3))));
        if (k < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }, delay);
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [target, ms, delay]);
  return v;
}
