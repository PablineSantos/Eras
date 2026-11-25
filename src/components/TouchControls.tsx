/**
 * Controles de toque (celular na horizontal): direcional de 8 direções à esquerda,
 * botões de ação à direita. Cada toque vira tecla virtual (virtualKey), o mesmo
 * caminho do controle físico — Player/menus não sabem que é toque.
 *
 * Também: aviso "gire o celular" em retrato e tela cheia + trava horizontal no 1º toque.
 */
import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { RotateCw } from 'lucide-react';
import { virtualKey, type VirtualAction } from '../core/GamepadBridge';
import { isTouchDevice } from '../core/InputMode';
import { useEraConfig, useGameState, useInputMode } from './eras-hud/hooks';
import { ERA_ACCENTS } from './eras-hud/shared';
import { pauseGame } from './eras-hud/PauseScreen';

/** Captura o dedo no controle (se o navegador recusar, segue sem captura). */
function capture(e: ReactPointerEvent): void {
  try {
    e.currentTarget.setPointerCapture(e.pointerId);
  } catch {
    /* ponteiro sintético/inválido */
  }
}

type Dir = 'left' | 'right' | 'up' | 'down';

const STICK_SIZE = 132;
const KNOB_SIZE = 56;
const STICK_RADIUS = (STICK_SIZE - KNOB_SIZE) / 2;
const DEADZONE = 16;

/** Ângulo → até duas direções (8 setores de 45°). */
function dirsFor(dx: number, dy: number): Set<Dir> {
  const out = new Set<Dir>();
  if (Math.hypot(dx, dy) < DEADZONE) return out;
  const sector = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)); // -4..4, 0 = direita
  const s = ((sector % 8) + 8) % 8;
  if (s === 7 || s === 0 || s === 1) out.add('right');
  if (s >= 3 && s <= 5) out.add('left');
  if (s >= 1 && s <= 3) out.add('down');
  if (s >= 5 && s <= 7) out.add('up');
  return out;
}

function Stick({ accent }: { accent: string }) {
  const base = useRef<HTMLDivElement>(null);
  const pointer = useRef<number | null>(null);
  const held = useRef<Set<Dir>>(new Set());
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  const apply = (next: Set<Dir>) => {
    for (const d of held.current) if (!next.has(d)) virtualKey(d, false);
    for (const d of next) if (!held.current.has(d)) virtualKey(d, true);
    held.current = next;
  };

  const move = (e: ReactPointerEvent) => {
    const r = base.current!.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const len = Math.hypot(dx, dy);
    if (len > STICK_RADIUS) {
      dx = (dx / len) * STICK_RADIUS;
      dy = (dy / len) * STICK_RADIUS;
    }
    setKnob({ x: dx, y: dy });
    apply(dirsFor(dx, dy));
  };

  const end = (e: ReactPointerEvent) => {
    if (e.pointerId !== pointer.current) return;
    pointer.current = null;
    setKnob({ x: 0, y: 0 });
    apply(new Set());
  };

  useEffect(() => () => apply(new Set()), []);

  return (
    <div
      ref={base}
      role="group"
      aria-label="Direcional"
      className="pointer-events-auto relative rounded-full"
      style={{
        width: STICK_SIZE,
        height: STICK_SIZE,
        background: 'radial-gradient(circle, rgba(15,17,26,.35), rgba(15,17,26,.6))',
        boxShadow: `inset 0 0 0 2px ${accent}55`,
        touchAction: 'none',
      }}
      onPointerDown={(e) => {
        if (pointer.current !== null) return;
        pointer.current = e.pointerId;
        capture(e);
        move(e);
      }}
      onPointerMove={(e) => e.pointerId === pointer.current && move(e)}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
    >
      <div
        className="absolute rounded-full"
        style={{
          width: KNOB_SIZE,
          height: KNOB_SIZE,
          left: STICK_SIZE / 2 - KNOB_SIZE / 2 + knob.x,
          top: STICK_SIZE / 2 - KNOB_SIZE / 2 + knob.y,
          background: `${accent}55`,
          boxShadow: `inset 0 0 0 2px ${accent}AA`,
        }}
      />
    </div>
  );
}

function ActionButton({ label, action, size, accent }: { label: string; action: VirtualAction; size: number; accent: string }) {
  const pointer = useRef<number | null>(null);
  const [down, setDown] = useState(false);
  const release = () => {
    if (pointer.current === null) return;
    pointer.current = null;
    setDown(false);
    virtualKey(action, false);
  };
  useEffect(() => release, []);
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={label}
      className="pointer-events-auto flex select-none items-center justify-center rounded-full font-pixel outline-none"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.28,
        color: '#F8FAFC',
        background: down ? `${accent}99` : 'rgba(15,17,26,.5)',
        boxShadow: `inset 0 0 0 2px ${accent}AA`,
        touchAction: 'none',
      }}
      onPointerDown={(e) => {
        e.preventDefault();
        if (pointer.current !== null) return;
        pointer.current = e.pointerId;
        capture(e);
        setDown(true);
        virtualKey(action, true);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onContextMenu={(e) => e.preventDefault()}
    >
      {label}
    </button>
  );
}

/** Pede tela cheia + trava horizontal no primeiro toque (gesto exigido pelo navegador). */
function useFullscreenOnFirstTouch(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const onTouch = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || document.fullscreenElement) return;
      window.removeEventListener('pointerup', onTouch, true);
      const el = document.documentElement;
      if (!el.requestFullscreen) return; // iPhone (Safari) não suporta: segue com a barra do navegador
      el.requestFullscreen({ navigationUI: 'hide' })
        .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
        .catch(() => {});
    };
    window.addEventListener('pointerup', onTouch, true);
    return () => window.removeEventListener('pointerup', onTouch, true);
  }, [enabled]);
}

function usePortrait(): boolean {
  const query = '(orientation: portrait)';
  const [portrait, setPortrait] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setPortrait(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return portrait;
}

export default function TouchControls() {
  const mode = useInputMode();
  const config = useEraConfig();
  const gameState = useGameState();
  const portrait = usePortrait();
  const touch = mode === 'touch' || (mode !== 'gamepad' && isTouchDevice());
  useFullscreenOnFirstTouch(isTouchDevice());
  const blockedByPortrait = touch && portrait && isTouchDevice();

  // Girou para retrato no meio da fase: pausa (o jogo não corre escondido atrás do aviso).
  useEffect(() => {
    if (blockedByPortrait && gameState === 'playing') pauseGame();
  }, [blockedByPortrait, gameState]);

  if (blockedByPortrait) {
    return (
      <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-[#07080D] px-8 text-center">
        <RotateCw size={48} className="animate-spin text-emerald-400" style={{ animationDuration: '2.5s' }} />
        <div className="font-pixel text-[12px] leading-relaxed text-slate-100">GIRE O CELULAR</div>
        <div className="font-terminal text-[20px] leading-tight text-slate-400">Eras é jogado na horizontal.</div>
      </div>
    );
  }

  if (!touch || gameState !== 'playing') return null;
  const accent = ERA_ACCENTS[config.id];
  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 z-[50] flex items-end justify-between"
      style={{
        paddingLeft: 'max(16px, env(safe-area-inset-left))',
        paddingRight: 'max(16px, env(safe-area-inset-right))',
        paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
      }}
    >
      <Stick accent={accent} />
      <div className="flex items-end gap-3">
        {config.allowBulletTime && <ActionButton label="BT" action="shift" size={52} accent={accent} />}
        {config.allowDash && <ActionButton label="B" action="dash" size={62} accent={accent} />}
        <ActionButton label="A" action="space" size={78} accent={accent} />
      </div>
    </div>
  );
}
