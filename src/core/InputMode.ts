/**
 * Último dispositivo usado pelo jogador: troca as dicas de controle na tela.
 * Teclado/mouse reais (isTrusted) → 'keyboard'; GamepadBridge → 'gamepad'; toque → 'touch'.
 */
export type InputMode = 'keyboard' | 'gamepad' | 'touch';

let mode: InputMode = 'keyboard';
const listeners = new Set<(m: InputMode) => void>();

export function getInputMode(): InputMode {
  return mode;
}

export function setInputMode(next: InputMode): void {
  if (next === mode) return;
  mode = next;
  listeners.forEach((fn) => fn(mode));
}

export function onInputModeChange(fn: (m: InputMode) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Rótulos dos botões (layout padrão Xbox). */
export const PAD = {
  move: 'Analógico/D-pad',
  jump: 'A',
  dash: 'B/X/RT',
  bullet: 'LT',
  eras: 'LB/RB',
  pause: 'START',
  museum: 'SELECT',
  confirm: 'A',
  nav: 'D-pad',
} as const;

/** Rótulos dos controles de toque (TouchControls). */
export const TOUCH = {
  move: 'Direcional',
  jump: 'A',
  dash: 'B',
  bullet: 'BT',
  eras: 'Barra inferior',
  pause: '⏸',
  museum: '📖',
} as const;

/** Aparelho com tela de toque como entrada principal (celular/tablet). */
export const isTouchDevice = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

/** Escuta teclado/mouse físicos para voltar ao modo teclado. Retorna cleanup. */
export function bindInputModeTracking(): () => void {
  const onKey = (e: KeyboardEvent) => e.isTrusted && setInputMode('keyboard');
  const onPointer = (e: PointerEvent) => {
    if (!e.isTrusted) return;
    if (e.pointerType === 'mouse') setInputMode('keyboard');
    else if (e.pointerType === 'touch') setInputMode('touch');
  };
  // Celular abre já em modo toque: as dicas não mostram teclado.
  if (isTouchDevice()) setInputMode('touch');
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('pointerdown', onPointer, true);
  return () => {
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('pointerdown', onPointer, true);
  };
}
