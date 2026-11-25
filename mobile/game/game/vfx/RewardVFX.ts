import Phaser from 'phaser';
import { ERA_CONFIGS } from '../../core/EraManager';
import { EraId } from '../../core/types';

/**
 * Reward / feedback VFX for the main level (artifact idle + pickup, diegetic reference labels,
 * perfect-run celebration).
 *
 * Performance notes:
 *  - Every texture is generated once per game (TextureManager is global) and reused by key.
 *  - Particle emitters are created lazily, one per (profile, color), and reused via explode().
 *  - Per-scene state lives in a WeakMap and is dropped on SHUTDOWN (the DisplayList/TweenManager/Clock
 *    already destroy the objects, tweens and timers themselves, so we only forget references).
 */

// Depths: above level/entities/player (0..30) and the in-world signs (50).
const DEPTH_VFX = 46;
const DEPTH_LABEL = 55;

const TEX_RING = 'vfx-ring';
const TEX_HALO = 'vfx-halo';
const TEX_SHARD = 'vfx-shard';
const TEX_STAR = 'vfx-star';
const TEX_RAY = 'vfx-ray';

const HIT_STOP_MS = 90;
const MAX_LABELS = 3;
const LABEL_LIFE_MS = 2300;
const GOLD = 0xffd54a;
const EMERALD = 0x10b981;

type EmitterProfile = 'burst' | 'firework';

interface SceneVFXState {
  emitters: Map<string, Phaser.GameObjects.Particles.ParticleEmitter>;
  labels: Array<{ container: Phaser.GameObjects.Container; tween: Phaser.Tweens.Tween; x: number; y: number }>;
  hitStopToken: number;
}

const states = new WeakMap<Phaser.Scene, SceneVFXState>();

function getState(scene: Phaser.Scene): SceneVFXState {
  let st = states.get(scene);
  if (!st) {
    st = { emitters: new Map(), labels: [], hitStopToken: 0 };
    states.set(scene, st);
    // Objects/tweens/timers are destroyed by the scene systems; we only drop references.
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => states.delete(scene));
    scene.events.once(Phaser.Scenes.Events.DESTROY, () => states.delete(scene));
  }
  return st;
}

function hexToNumber(hex: string): number {
  return Phaser.Display.Color.HexStringToColor(hex).color;
}

/** Dark colors vanish under ADD blending (e.g. 1984 black accent) → draw them normally. */
function isDark(color: number): boolean {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 64;
}

function blendFor(color: number): Phaser.BlendModes {
  return isDark(color) ? Phaser.BlendModes.NORMAL : Phaser.BlendModes.ADD;
}

// ---------------------------------------------------------------------------
// Cached procedural textures
// ---------------------------------------------------------------------------

function makeTexture(scene: Phaser.Scene, key: string, w: number, h: number, draw: (g: Phaser.GameObjects.Graphics) => void): void {
  if (scene.textures.exists(key)) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  draw(g);
  g.generateTexture(key, w, h);
  g.destroy();
}

function ensureTextures(scene: Phaser.Scene): void {
  makeTexture(scene, TEX_RING, 128, 128, (g) => {
    g.lineStyle(6, 0xffffff, 1).strokeCircle(64, 64, 58);
    g.lineStyle(2, 0xffffff, 0.45).strokeCircle(64, 64, 50);
  });
  makeTexture(scene, TEX_HALO, 64, 64, (g) => {
    // Soft radial glow from stacked translucent discs.
    for (let r = 32; r > 0; r -= 2) g.fillStyle(0xffffff, 0.05 + (1 - r / 32) * 0.12).fillCircle(32, 32, r);
  });
  makeTexture(scene, TEX_SHARD, 10, 10, (g) => {
    g.fillStyle(0xffffff, 1).fillPoints(
      [new Phaser.Math.Vector2(5, 0), new Phaser.Math.Vector2(10, 5), new Phaser.Math.Vector2(5, 10), new Phaser.Math.Vector2(0, 5)],
      true,
    );
  });
  makeTexture(scene, TEX_STAR, 16, 16, (g) => {
    g.fillStyle(0xffffff, 1);
    g.fillTriangle(8, 0, 10, 8, 6, 8).fillTriangle(8, 16, 10, 8, 6, 8);
    g.fillTriangle(0, 8, 8, 6, 8, 10).fillTriangle(16, 8, 8, 6, 8, 10);
    g.fillCircle(8, 8, 2.5);
  });
  makeTexture(scene, TEX_RAY, 256, 24, (g) => {
    // Wedge fading outwards (origin at its narrow left end).
    for (let i = 0; i < 8; i++) {
      const x0 = i * 32;
      const a = 0.9 * (1 - i / 8);
      const h0 = 1 + i * 1.4;
      const h1 = 1 + (i + 1) * 1.4;
      g.fillStyle(0xffffff, a).fillPoints(
        [
          new Phaser.Math.Vector2(x0, 12 - h0),
          new Phaser.Math.Vector2(x0 + 32, 12 - h1),
          new Phaser.Math.Vector2(x0 + 32, 12 + h1),
          new Phaser.Math.Vector2(x0, 12 + h0),
        ],
        true,
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Pooled emitters
// ---------------------------------------------------------------------------

function getEmitter(scene: Phaser.Scene, profile: EmitterProfile, color: number): Phaser.GameObjects.Particles.ParticleEmitter {
  ensureTextures(scene);
  const st = getState(scene);
  const cacheKey = `${profile}:${color}`;
  const cached = st.emitters.get(cacheKey);
  if (cached && cached.scene) return cached;

  const blendMode = blendFor(color);
  const emitter =
    profile === 'burst'
      ? scene.add.particles(0, 0, TEX_SHARD, {
          speed: { min: 160, max: 360 },
          angle: { min: 0, max: 360 },
          lifespan: { min: 450, max: 800 },
          scale: { start: 1.3, end: 0 },
          alpha: { start: 1, end: 0 },
          rotate: { min: 0, max: 360 },
          tint: [color, color, 0xffffff],
          blendMode,
          maxAliveParticles: 96,
          emitting: false,
        })
      : scene.add.particles(0, 0, TEX_STAR, {
          speed: { min: 90, max: 300 },
          angle: { min: 0, max: 360 },
          lifespan: { min: 700, max: 1300 },
          scale: { start: 1.1, end: 0.1 },
          alpha: { start: 1, end: 0 },
          gravityY: 180,
          tint: [color, 0xffffff],
          blendMode,
          maxAliveParticles: 220,
          emitting: false,
        });
  emitter.setDepth(DEPTH_VFX);
  st.emitters.set(cacheKey, emitter);
  return emitter;
}

function shockwave(scene: Phaser.Scene, x: number, y: number, color: number, delay: number, maxScale: number, duration: number): void {
  const ring = scene.add
    .image(x, y, TEX_RING)
    .setDepth(DEPTH_VFX)
    .setTint(color)
    .setBlendMode(blendFor(color))
    .setScale(0.08)
    .setAlpha(0);
  scene.tweens.add({
    targets: ring,
    scale: maxScale,
    alpha: { from: 0.95, to: 0 },
    delay,
    duration,
    ease: 'Cubic.out',
    onComplete: () => ring.destroy(),
  });
}

// ---------------------------------------------------------------------------
// Artifact idle
// ---------------------------------------------------------------------------

export interface ArtifactIdleHandle {
  /** Retints the halo (e.g. on era change). */
  setColor(color: number): void;
  destroy(): void;
}

type FloatTarget = Phaser.GameObjects.GameObject &
  Phaser.GameObjects.Components.Transform &
  Phaser.GameObjects.Components.Depth;

/**
 * Sine float + pulsing halo behind `target`. Drives target.y (do not add another float tween).
 * Cleans itself up when the target is destroyed.
 */
export function createArtifactIdleEffect(
  scene: Phaser.Scene,
  target: FloatTarget,
  options: { color?: number; amplitude?: number; periodMs?: number } = {},
): ArtifactIdleHandle {
  ensureTextures(scene);
  const amplitude = options.amplitude ?? 5;
  const period = options.periodMs ?? 1800;
  const baseY = target.y;
  const baseScaleX = target.scaleX;
  const baseScaleY = target.scaleY;
  const phase = (Math.abs(target.x) % 97) / 97 * Math.PI * 2;

  const halo = scene.add.image(target.x, baseY, TEX_HALO).setDepth(target.depth - 0.5).setScale(0.9);
  const applyColor = (color: number) => {
    halo.setTint(color).setBlendMode(blendFor(color));
  };
  applyColor(options.color ?? 0xffffff);

  const driver = { t: 0 };
  let alive = true;
  const tween = scene.tweens.add({
    targets: driver,
    t: Math.PI * 2,
    duration: period,
    repeat: -1,
    onUpdate: () => {
      if (!alive) return;
      const t = driver.t + phase;
      target.y = baseY + Math.sin(t) * amplitude;
      const pulse = 0.5 + 0.5 * Math.sin(t * 2);
      target.setScale(baseScaleX * (1 + 0.06 * pulse), baseScaleY * (1 + 0.06 * pulse));
      halo.setPosition(target.x, target.y);
      halo.setScale(0.85 + 0.4 * pulse);
      halo.setAlpha(0.25 + 0.4 * pulse);
    },
  });

  const cleanup = (fromScene: boolean) => {
    if (!alive) return;
    alive = false;
    target.off(Phaser.GameObjects.Events.DESTROY, onTargetDestroy);
    // During scene shutdown the DisplayList is iterating backwards: destroying a sibling here would
    // shift the list mid-iteration, so the halo/tween are left for the scene systems to destroy.
    if (fromScene) return;
    tween.remove();
    halo.destroy();
  };
  const onTargetDestroy = (_obj: unknown, fromScene?: boolean) => cleanup(!!fromScene);
  target.once(Phaser.GameObjects.Events.DESTROY, onTargetDestroy);

  return {
    setColor: (color: number) => {
      if (alive) applyColor(color);
    },
    destroy: () => cleanup(false),
  };
}

// ---------------------------------------------------------------------------
// Artifact collect
// ---------------------------------------------------------------------------

/** Pauses arcade physics for ~90ms. Resumes only if nothing else paused/ended the game meanwhile. */
function hitStop(scene: Phaser.Scene, ms: number, shouldResume?: () => boolean): void {
  const world = scene.physics?.world;
  if (!world || world.isPaused) return;
  const st = getState(scene);
  const token = ++st.hitStopToken;
  world.pause();
  // Clock delays are scaled by time.timeScale; compensate so the freeze stays ~real 90ms.
  const delay = ms * (scene.time.timeScale || 1);
  scene.time.delayedCall(delay, () => {
    if (states.get(scene) !== st || st.hitStopToken !== token) return;
    if (!world.isPaused) return;
    if (shouldResume && !shouldResume()) return;
    world.resume();
  });
}

export interface ArtifactCollectOptions {
  /** Floating text (e.g. artifact name). */
  label?: string;
  /** Era used to style the floating text (font/palette). */
  era?: EraId;
  /** Called when the hit-stop ends; return false to keep physics paused (game paused / victory). */
  shouldResume?: () => boolean;
}

/** Hit-stop + 3 shockwave rings + 24-particle geometric burst + rising text. */
export function playArtifactCollectVFX(
  scene: Phaser.Scene,
  x: number,
  y: number,
  eraColor: number,
  options: ArtifactCollectOptions = {},
): void {
  ensureTextures(scene);
  hitStop(scene, HIT_STOP_MS, options.shouldResume);

  shockwave(scene, x, y, eraColor, 0, 1.6, 520);
  shockwave(scene, x, y, 0xffffff, 70, 1.15, 460);
  shockwave(scene, x, y, eraColor, 150, 2.2, 700);

  getEmitter(scene, 'burst', eraColor).explode(24, x, y);

  if (options.label) {
    const era = options.era ?? EraId.NEON_2026;
    const cfg = ERA_CONFIGS[era];
    const t = scene.add
      .text(x, y - 26, options.label, {
        fontFamily: cfg.fontFamily,
        fontSize: era === EraId.NES_1986 || era === EraId.SNES_1991 ? '12px' : '18px',
        color: cfg.palette.text,
        align: 'center',
        stroke: cfg.palette.background,
        strokeThickness: 4,
      })
      .setOrigin(0.5, 1)
      .setDepth(DEPTH_LABEL)
      .setScale(0.6);
    scene.tweens.add({ targets: t, scale: 1, duration: 220, ease: 'Back.out' });
    scene.tweens.add({
      targets: t,
      y: y - 96,
      alpha: 0,
      delay: 250,
      duration: 2200,
      ease: 'Cubic.out',
      onComplete: () => t.destroy(),
    });
  }
}

// ---------------------------------------------------------------------------
// In-world reference labels
// ---------------------------------------------------------------------------

interface LabelStyle {
  fontSize: number;
  textColor: string;
  fill?: number;
  fillAlpha?: number;
  border?: number;
  borderWidth?: number;
  radius?: number;
  shadow?: boolean;
  bevel?: boolean;
  gloss?: boolean;
  padX: number;
  padY: number;
}

function labelStyle(era: EraId): LabelStyle {
  const p = ERA_CONFIGS[era].palette;
  const n = hexToNumber;
  switch (era) {
    case EraId.VECTOR_1958:
      // Oscilloscope: bare glowing trace text with an underline.
      return { fontSize: 20, textColor: p.primary, border: n(p.primary), borderWidth: 1, padX: 4, padY: 2 };
    case EraId.ASCII_1977:
      return { fontSize: 20, textColor: p.foreground, fill: 0x000000, fillAlpha: 0.88, border: n(p.foreground), borderWidth: 1, padX: 8, padY: 3 };
    case EraId.MAC_1984:
      return { fontSize: 20, textColor: '#000000', fill: 0xffffff, fillAlpha: 1, border: 0x000000, borderWidth: 2, shadow: true, padX: 8, padY: 3 };
    case EraId.NES_1986:
    case EraId.SNES_1991:
      return { fontSize: 10, textColor: '#FFFFFF', fill: 0x000000, fillAlpha: 0.9, border: n(p.accent), borderWidth: 3, padX: 8, padY: 7 };
    case EraId.WIN95_1995:
      return { fontSize: 14, textColor: '#000000', fill: 0xc0c0c0, fillAlpha: 1, bevel: true, padX: 8, padY: 5 };
    case EraId.Y2K_1999:
      return { fontSize: 20, textColor: p.primary, fill: 0x000a00, fillAlpha: 0.85, border: n(p.secondary), borderWidth: 1, padX: 8, padY: 2 };
    case EraId.FLASH_2005:
      return { fontSize: 14, textColor: '#FFFFFF', fill: n(p.primary), fillAlpha: 1, border: 0xffffff, borderWidth: 2, radius: 10, gloss: true, padX: 12, padY: 6 };
    case EraId.FLAT_2013:
      return { fontSize: 14, textColor: '#FFFFFF', fill: n(p.primary), fillAlpha: 1, padX: 12, padY: 6 };
    case EraId.NEON_2026:
    default:
      return { fontSize: 14, textColor: p.foreground, fill: 0x0f172a, fillAlpha: 0.55, border: n(p.accent), borderWidth: 1, radius: 12, padX: 12, padY: 6 };
  }
}

/**
 * Diegetic floating label styled after `era` (font + palette). Rises and fades.
 * At most MAX_LABELS alive at once (oldest removed); nearby labels are offset upwards.
 */
export function showInWorldReferenceLabel(scene: Phaser.Scene, x: number, y: number, text: string, era: EraId): void {
  const st = getState(scene);
  const cfg = ERA_CONFIGS[era];
  const s = labelStyle(era);

  while (st.labels.length >= MAX_LABELS) {
    const old = st.labels.shift();
    if (old) {
      old.tween.remove();
      old.container.destroy();
    }
  }
  const nearby = st.labels.filter((l) => Math.abs(l.x - x) < 180 && Math.abs(l.y - y) < 80).length;
  const startY = y - nearby * 34;

  const label = scene.add
    .text(0, 0, text, { fontFamily: cfg.fontFamily, fontSize: `${s.fontSize}px`, color: s.textColor, align: 'center' })
    .setOrigin(0.5, 0.5);
  if (era === EraId.VECTOR_1958) label.setShadow(0, 0, s.textColor, 8, false, true);
  if (s.fill === undefined) label.setStroke(cfg.palette.background, 4);

  const w = Math.ceil(label.width + s.padX * 2);
  const h = Math.ceil(label.height + s.padY * 2);
  const bx = -w / 2;
  const by = -h / 2;
  const g = scene.add.graphics();
  if (s.shadow) g.fillStyle(0x000000, 1).fillRect(bx + 3, by + 3, w, h);
  if (s.fill !== undefined) {
    g.fillStyle(s.fill, s.fillAlpha ?? 1);
    if (s.radius) g.fillRoundedRect(bx, by, w, h, s.radius);
    else g.fillRect(bx, by, w, h);
  }
  if (s.gloss) g.fillStyle(0xffffff, 0.35).fillRoundedRect(bx + 3, by + 2, w - 6, h * 0.45, { tl: 8, tr: 8, bl: 2, br: 2 });
  if (s.bevel) {
    // Windows 95 raised bevel: light top-left, dark bottom-right.
    g.lineStyle(2, 0xffffff, 1).lineBetween(bx, by + h, bx, by).lineBetween(bx, by, bx + w, by);
    g.lineStyle(2, 0x404040, 1).lineBetween(bx + w, by, bx + w, by + h).lineBetween(bx + w, by + h, bx, by + h);
    g.lineStyle(1, 0x808080, 1).strokeRect(bx + 2, by + 2, w - 4, h - 4);
  } else if (s.border !== undefined && s.borderWidth) {
    g.lineStyle(s.borderWidth, s.border, 1);
    if (era === EraId.VECTOR_1958) g.lineBetween(bx, by + h, bx + w, by + h);
    else if (s.radius) g.strokeRoundedRect(bx, by, w, h, s.radius);
    else g.strokeRect(bx, by, w, h);
  }

  const container = scene.add.container(x, startY, [g, label]).setDepth(DEPTH_LABEL).setAlpha(0).setScale(0.85);
  const entry = { container, tween: null as unknown as Phaser.Tweens.Tween, x, y: startY };
  const tween = scene.tweens.add({
    targets: container,
    y: startY - 48,
    scale: 1,
    duration: LABEL_LIFE_MS,
    ease: 'Cubic.out',
    onUpdate: (tw) => {
      const p = tw.progress;
      container.setAlpha(p < 0.08 ? p / 0.08 : p > 0.65 ? Math.max(0, 1 - (p - 0.65) / 0.35) : 1);
    },
    onComplete: () => {
      const i = st.labels.indexOf(entry);
      if (i >= 0) st.labels.splice(i, 1);
      container.destroy();
    },
  });
  entry.tween = tween;
  st.labels.push(entry);
}

// ---------------------------------------------------------------------------
// Perfect run
// ---------------------------------------------------------------------------

/** Gold/emerald fireworks + rotating rays + banner. Used on victory with 0 deaths. */
export function playPerfectRunCelebrationVFX(scene: Phaser.Scene, x: number, y: number): void {
  ensureTextures(scene);

  // Rays
  const rays = scene.add.container(x, y).setDepth(DEPTH_VFX - 1).setScale(0.15).setAlpha(0.9);
  const RAY_COUNT = 12;
  for (let i = 0; i < RAY_COUNT; i++) {
    rays.add(
      scene.add
        .image(0, 0, TEX_RAY)
        .setOrigin(0, 0.5)
        .setRotation((i / RAY_COUNT) * Math.PI * 2)
        .setTint(i % 2 === 0 ? GOLD : EMERALD)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setAlpha(0.75),
    );
  }
  scene.tweens.add({ targets: rays, scale: 1.5, duration: 700, ease: 'Back.out' });
  scene.tweens.add({ targets: rays, angle: 120, duration: 4200, ease: 'Linear' });
  scene.tweens.add({ targets: rays, alpha: 0, delay: 3000, duration: 1100, onComplete: () => rays.destroy() });

  shockwave(scene, x, y, GOLD, 0, 3, 800);
  shockwave(scene, x, y, EMERALD, 160, 4, 1000);

  // Fireworks
  const BURSTS = 8;
  for (let k = 0; k < BURSTS; k++) {
    scene.time.delayedCall(120 + k * 240, () => {
      if (!states.has(scene)) return;
      const color = k % 2 === 0 ? GOLD : EMERALD;
      const bx = x + Phaser.Math.Between(-240, 240);
      const by = y + Phaser.Math.Between(-220, -30);
      getEmitter(scene, 'firework', color).explode(26, bx, by);
      shockwave(scene, bx, by, color, 0, 0.9, 500);
    });
  }

  // Banner
  const banner = scene.add
    .text(x, y - 120, 'EXECUÇÃO PERFEITA\n0 MORTES', {
      fontFamily: '"Poppins", sans-serif',
      fontSize: '28px',
      fontStyle: 'bold',
      color: '#FFE38A',
      align: 'center',
      stroke: '#064E3B',
      strokeThickness: 6,
    })
    .setOrigin(0.5, 0.5)
    .setDepth(DEPTH_LABEL)
    .setScale(0.3)
    .setAlpha(0);
  banner.setShadow(0, 0, '#10B981', 16, true, true);
  scene.tweens.add({ targets: banner, scale: 1, alpha: 1, duration: 500, ease: 'Back.out' });
  scene.tweens.add({ targets: banner, y: y - 170, alpha: 0, delay: 3200, duration: 1000, onComplete: () => banner.destroy() });
}
