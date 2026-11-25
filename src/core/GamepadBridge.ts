import { EraManager } from './EraManager';
import { setInputMode } from './InputMode';
import { SoundSynthesizer } from './SoundSynthesizer';

/**
 * Ponte Gamepad → teclado.
 * Faz polling da Gamepad API e despacha KeyboardEvents sintéticos no window, então
 * Player (Phaser), menus React, pausa e museu funcionam com controle sem código extra.
 *
 * Layout "standard" (Xbox/PlayStation):
 *   D-pad / analógico esq. → setas      A / Cross     → pular / confirmar (Espaço + Enter)
 *   B / X / RT            → dash (X)    Y / Triangle  → interagir (E)
 *   LT                    → Bullet Time (Shift)
 *   LB / RB               → era anterior / próxima (desbloqueadas)
 *   Start                 → pausar / voltar (Esc)     Select → museu (M)
 */

interface KeyDef {
  key: string;
  code: string;
  keyCode: number;
}

const K = {
  left: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  up: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  right: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  down: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  space: { key: ' ', code: 'Space', keyCode: 32 },
  enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
  escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  dash: { key: 'x', code: 'KeyX', keyCode: 88 },
  interact: { key: 'e', code: 'KeyE', keyCode: 69 },
  museum: { key: 'm', code: 'KeyM', keyCode: 77 },
  shift: { key: 'Shift', code: 'ShiftLeft', keyCode: 16 },
} satisfies Record<string, KeyDef>;

export type VirtualAction = keyof typeof K;
type Action = VirtualAction;

const BUTTON_ACTIONS: Record<number, Action[]> = {
  0: ['space', 'enter'],
  1: ['dash'],
  2: ['dash'],
  3: ['interact'],
  6: ['shift'],
  7: ['dash'],
  8: ['museum'],
  9: ['escape'],
  12: ['up'],
  13: ['down'],
  14: ['left'],
  15: ['right'],
};

const STICK_DEADZONE = 0.45;
const TRIGGER_THRESHOLD = 0.5;
/** Repetição das setas ao segurar (navegação em menus). */
const REPEAT_DELAY_MS = 380;
const REPEAT_RATE_MS = 110;
const REPEATABLE = new Set<Action>(['up', 'down', 'left', 'right']);

function dispatch(type: 'keydown' | 'keyup', def: KeyDef, repeat = false): void {
  const ev = new KeyboardEvent(type, { key: def.key, code: def.code, repeat, bubbles: true, cancelable: true });
  // Phaser lê keyCode/which, que o construtor deixa em 0.
  Object.defineProperty(ev, 'keyCode', { get: () => def.keyCode });
  Object.defineProperty(ev, 'which', { get: () => def.keyCode });
  (document.activeElement ?? window).dispatchEvent(ev);
}

/** Tecla virtual (controles de toque): mesmo caminho do controle físico. */
export function virtualKey(action: VirtualAction, down: boolean): void {
  dispatch(down ? 'keydown' : 'keyup', K[action]);
}

function readActions(pad: Gamepad): Set<Action> {
  const out = new Set<Action>();
  pad.buttons.forEach((b, i) => {
    const pressed = b.pressed || b.value > TRIGGER_THRESHOLD;
    if (pressed) BUTTON_ACTIONS[i]?.forEach((a) => out.add(a));
  });
  const [ax = 0, ay = 0] = pad.axes;
  if (ax < -STICK_DEADZONE) out.add('left');
  if (ax > STICK_DEADZONE) out.add('right');
  if (ay < -STICK_DEADZONE) out.add('up');
  if (ay > STICK_DEADZONE) out.add('down');
  return out;
}

function cycleEra(dir: 1 | -1): void {
  const unlocked = EraManager.getUnlocked();
  if (unlocked.length < 2) return;
  const i = unlocked.indexOf(EraManager.getCurrentEra());
  const next = unlocked[(Math.max(i, 0) + dir + unlocked.length) % unlocked.length];
  EraManager.setEra(next, 'keyboard');
}

/** Inicia o polling (idempotente). Retorna cleanup. */
export function bindGamepad(): () => void {
  let raf = 0;
  let held = new Set<Action>();
  const heldSince = new Map<Action, number>();
  const lastRepeat = new Map<Action, number>();
  let prevLB = false;
  let prevRB = false;

  const release = () => {
    for (const a of held) dispatch('keyup', K[a]);
    held = new Set();
  };

  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    const pad = [...(navigator.getGamepads?.() ?? [])].find((p): p is Gamepad => !!p && p.connected);
    if (!pad || !document.hasFocus()) {
      if (held.size) release();
      return;
    }
    const next = readActions(pad);
    const lb = !!pad.buttons[4]?.pressed;
    const rb = !!pad.buttons[5]?.pressed;
    const fresh = [...next].some((a) => !held.has(a)) || (lb && !prevLB) || (rb && !prevRB);
    if (fresh) {
      setInputMode('gamepad');
      // Mesmo caminho do teclado/mouse; se o navegador ainda bloquear, o aviso de som orienta.
      void SoundSynthesizer.resume();
    }
    for (const a of next) {
      if (!held.has(a)) {
        dispatch('keydown', K[a]);
        heldSince.set(a, now);
        lastRepeat.set(a, now);
      } else if (REPEATABLE.has(a)) {
        const since = heldSince.get(a) ?? now;
        if (now - since > REPEAT_DELAY_MS && now - (lastRepeat.get(a) ?? now) > REPEAT_RATE_MS) {
          dispatch('keydown', K[a], true);
          lastRepeat.set(a, now);
        }
      }
    }
    for (const a of held) if (!next.has(a)) dispatch('keyup', K[a]);
    held = next;

    if (lb && !prevLB) cycleEra(-1);
    if (rb && !prevRB) cycleEra(1);
    prevLB = lb;
    prevRB = rb;
  };

  raf = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(raf);
    release();
  };
}
