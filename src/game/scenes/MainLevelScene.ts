import Phaser from 'phaser';
import { EventBus, type EventMap, type EventName } from '../../core/EventBus';
import { ARTIFACTS, ERA_CONFIGS, EraManager } from '../../core/EraManager';
import {
  ArtifactId,
  artifactTextureKey,
  BULLET_TIME_SCALE,
  CHASM_LEFT_X,
  CHASM_RIGHT_X,
  EraConfig,
  EraId,
  EraMechanicId,
  ERA_HOTKEYS,
  GameState,
  InteractiveWindowRect,
  MAIN_SCENE_KEY,
  PlayerStats,
  textureKey,
  WINDOW_DEFS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '../../core/types';
import { EraVisualRenderer } from '../pipelines/EraVisualRenderer';
import { Player } from '../entities/Player';
import { CommentWall } from '../entities/CommentWall';
import {
  ARTIFACT_PLACEMENTS,
  BOUNCY,
  CHECKPOINTS,
  COINS,
  CORE_POS,
  ERA_BLOCKS,
  EraBlockDef,
  FIREWALL,
  GLASS_GAP,
  HAZARDS,
  isEraBlockSolid,
  LASER_CORRIDOR,
  LASERS,
  LaserDef,
  PLATFORMS,
  PointDef,
  Rect,
  sectorAt,
  SIGNS,
  SPAWN,
  TOWER,
  TUNNEL_1986,
} from '../level/LevelLayout';
import {
  ArtifactIdleHandle,
  createArtifactIdleEffect,
  playArtifactCollectVFX,
  playPerfectRunCelebrationVFX,
  showInWorldReferenceLabel,
} from '../vfx/RewardVFX';

// Convenção de depth
const DEPTH_LEVEL = 0;
const DEPTH_ENTITY = 10;
const DEPTH_PLAYER = 20;
const DEPTH_OVERLAY = 50;

const STATS_INTERVAL_MS = 100;
const DEATH_COOLDOWN_MS = 600;
const BOUNCE_VELOCITY = -900;
/** 1958: passo (s) e duração máxima (s) da trajetória desenhada no osciloscópio. */
const TRACE_STEP_S = 0.035;
const TRACE_MAX_S = 1.6;

interface Pickup {
  sprite: Phaser.GameObjects.Image;
  x: number;
  y: number;
  taken: boolean;
}
interface ArtifactPickup extends Pickup {
  id: ArtifactId;
  idle: ArtifactIdleHandle;
}
interface CheckpointObj {
  sprite: Phaser.GameObjects.Image;
  point: PointDef;
  active: boolean;
}
interface LaserObj {
  def: LaserDef;
  beam: Phaser.GameObjects.TileSprite;
  on: boolean;
}
interface HazardObj {
  sprite: Phaser.GameObjects.TileSprite;
  hit: Rect;
}
interface WindowCollider {
  zone: Phaser.GameObjects.Zone;
  rect: InteractiveWindowRect;
}
interface EraBlockObj {
  def: EraBlockDef;
  zone: Phaser.GameObjects.Zone;
  gfx: Phaser.GameObjects.Graphics;
}

type DeathCause = 'fall' | 'spike' | 'laser';

/** One airtime (takeoff → landing), for 1958 long jumps and mid-air era combos. */
interface AirTrack {
  startX: number;
  /** Took off with upward velocity (a jump/bounce, not walking off a ledge). */
  jumped: boolean;
  eras: Set<EraId>;
}

/** Crossing of a rect that is only passable in one era (1977 comment wall, 2013 skeuo button). */
interface PassTracker {
  rect: Rect;
  era: EraId;
  /** Last side the body was fully on (-1 left, 1 right), null = unknown. */
  side: -1 | 1 | null;
  /** The body overlapped the rect while in `era` since leaving `side`. */
  sawEra: boolean;
}

/** Minimum 1958 jump distance (px) reported as ballistic_long_jump. A full-speed jump on flat ground covers ~183 px, so this rewards a running jump without needing a drop. */
const LONG_JUMP_MIN_PX = 176;
const WINDOW_STAND_COOLDOWN_MS = 1500;

/** One-line PT-BR explanations shown the first time each mechanic fires in a run. */
const MECHANIC_CALLOUTS: Record<EraMechanicId, { title: string; explanation: string }> = {
  ballistic_long_jump: {
    title: '1958 · Tennis for Two',
    explanation: 'O primeiro videogame rodava num osciloscópio e calculava a bola numa parábola fixa: depois do salto, só a física manda.',
  },
  comment_wall_passed: {
    title: '1977 · Linha de comando',
    explanation: "Em código, '//' transforma a linha em comentário: o computador ignora — por isso você atravessou a parede.",
  },
  gui_window_stand: {
    title: '1984 · Interface gráfica',
    explanation: 'O Macintosh popularizou janelas que se arrastam com o mouse (ideia nascida na Xerox) — aqui a janela vira chão.',
  },
  popup_closed: {
    title: '1995 · Pop-ups do Windows 95',
    explanation: 'A web dos anos 90 vivia cheia de pop-ups e clicar no [X] virou reflexo — aqui fechar a janela libera o caminho.',
  },
  laser_bullet_time_pass: {
    title: '1999 · Bullet Time',
    explanation: 'Em Matrix (1999) o tempo desacelerava em volta do herói; aqui os lasers ficam lentos e dá para passar entre eles.',
  },
  flat_shift_pass: {
    title: '2013 · Flat Design',
    explanation: 'Em 2013 (iOS 7) as interfaces trocaram botões 3D brilhantes por cores chapadas — sem relevo, o botão não bloqueia mais.',
  },
  glass_walk_complete: {
    title: '2026 · Glassmorphism',
    explanation: 'Interfaces atuais usam painéis de vidro translúcido; em 2026 esse vidro existe de verdade e vira ponte.',
  },
  midair_era_combo: {
    title: 'Viagem no tempo em pleno ar',
    explanation: 'Cada era muda a física na hora: trocar de interface no meio do pulo mistura gravidade e poderes de décadas diferentes.',
  },
};

/** Ano + tecla de uma era, ex.: "1977 [2]". */
function eraLabel(era: EraId): string {
  const key = Object.keys(ERA_HOTKEYS).find((k) => ERA_HOTKEYS[k] === era) ?? '?';
  return `${ERA_CONFIGS[era].year} [${key}]`;
}

function hexToNumber(hex: string): number {
  return Phaser.Display.Color.HexStringToColor(hex).color;
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export class MainLevelScene extends Phaser.Scene {
  // Obs.: `renderer` é propriedade reservada de Phaser.Scene → usamos `eraRenderer`.
  private eraRenderer!: EraVisualRenderer;
  private player!: Player;
  private firewall!: CommentWall;

  private era: EraId = EraId.VECTOR_1958;
  private state: GameState = 'title';
  private needsRestart = false;
  private cleanedUp = false;
  private unsubs: Array<() => void> = [];

  private platforms!: Phaser.Physics.Arcade.StaticGroup;
  private platformSprites: Phaser.GameObjects.TileSprite[] = [];
  private bouncyGroup!: Phaser.Physics.Arcade.StaticGroup;
  private bouncySprites: Phaser.GameObjects.TileSprite[] = [];
  private hazards: HazardObj[] = [];
  private eraBlocks: EraBlockObj[] = [];
  private trajectory!: Phaser.GameObjects.Graphics;
  private lasers: LaserObj[] = [];
  private laserNodes: Phaser.GameObjects.Image[] = [];
  private coins: Pickup[] = [];
  private artifacts: ArtifactPickup[] = [];
  private checkpoints: CheckpointObj[] = [];
  private core!: Phaser.GameObjects.Image;
  private signs: Phaser.GameObjects.Text[] = [];

  private windows = new Map<string, WindowCollider>();
  private closedPopups = new Set<string>();
  private popupBlock!: Phaser.GameObjects.Container;
  private popupBlockBg!: Phaser.GameObjects.Rectangle;
  private popupBlockText!: Phaser.GameObjects.Text;

  private bulletTimeOverlay!: Phaser.GameObjects.Rectangle;
  private bulletTime = false;
  private obstacleClock = 0;

  private respawnPoint: PointDef = { x: SPAWN.x, y: SPAWN.y };
  private coinCount = 0;
  private deaths = 0;
  private lastDeathAt = -Infinity;
  private lastBounceAt = -Infinity;
  private statsTimer = 0;
  private lastCam = { scrollX: NaN, scrollY: NaN, zoom: NaN };

  // --- Run telemetry / era mechanics (reset in init(), i.e. on every restart) ---
  private maxSector = 1;
  private sectorDeaths = 0;
  private calloutsShown = new Set<EraMechanicId>();
  private wasGrounded = false;
  private air: AirTrack | null = null;
  private passTrackers: PassTracker[] = [];
  private wasOnWindow = false;
  private lastWindowStandAt = -Infinity;
  /** Scene time when the 404 popup was first inside the camera view in 1995 (null = not yet). */
  private popupSeenAt: number | null = null;
  /** Armed while on the left of the laser corridor; records whether Bullet Time was used while crossing. */
  private laserCross: { usedBulletTime: boolean } | null = null;
  /** Armed on the ledge before the 2026 glass gap; records whether the player stood on a glass panel. */
  private glassCross: { touchedGlass: boolean } | null = null;

  constructor() {
    super({ key: MAIN_SCENE_KEY });
  }

  /** Reinicia o estado (o construtor não roda de novo em scene.restart()). */
  init(): void {
    this.era = EraManager.getCurrentEra();
    this.state = 'title';
    this.needsRestart = false;
    this.cleanedUp = false;
    this.unsubs = [];
    this.platformSprites = [];
    this.bouncySprites = [];
    this.hazards = [];
    this.eraBlocks = [];
    this.lasers = [];
    this.laserNodes = [];
    this.coins = [];
    this.artifacts = [];
    this.checkpoints = [];
    this.signs = [];
    this.windows = new Map();
    this.closedPopups = new Set();
    this.bulletTime = false;
    this.obstacleClock = 0;
    this.respawnPoint = { x: SPAWN.x, y: SPAWN.y };
    this.coinCount = 0;
    this.deaths = 0;
    this.lastDeathAt = -Infinity;
    this.lastBounceAt = -Infinity;
    this.statsTimer = 0;
    this.lastCam = { scrollX: NaN, scrollY: NaN, zoom: NaN };
    this.maxSector = 1;
    this.sectorDeaths = 0;
    this.calloutsShown = new Set();
    this.lastWindowStandAt = -Infinity;
    this.popupSeenAt = null;
    const skeuo = ERA_BLOCKS.find((b) => b.kind === 'skeuo');
    this.passTrackers = [
      { rect: FIREWALL, era: EraId.ASCII_1977, side: null, sawEra: false },
      ...(skeuo ? [{ rect: skeuo as Rect, era: EraId.FLAT_2013, side: null, sawEra: false }] : []),
    ];
    this.resetMechanicTracking();
  }

  create(): void {
    // Visual primeiro: texturas de todas as eras precisam existir antes dos sprites.
    this.eraRenderer = new EraVisualRenderer(this);
    this.eraRenderer.generateTextures();
    this.eraRenderer.applyEra(this.era);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.cleanup, this);
    this.events.once(Phaser.Scenes.Events.DESTROY, this.cleanup, this);

    // Mundo: fundo aberto (cair = morte).
    this.physics.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.physics.world.setBoundsCollision(true, true, true, false);
    this.physics.world.gravity.y = ERA_CONFIGS[this.era].gravity;

    this.buildLevel();

    // Jogador
    this.player = new Player(this, SPAWN.x, SPAWN.y);
    if (!this.player.displayList) this.add.existing(this.player);
    if (!this.player.body) this.physics.add.existing(this.player);
    this.player.setDepth(DEPTH_PLAYER);
    this.player.setCollideWorldBounds(true);

    this.physics.add.collider(this.player, this.platforms);
    this.physics.add.collider(this.player, this.firewall.getCollider());
    this.physics.add.collider(this.player, this.bouncyGroup, this.onBouncyCollide, undefined, this);
    for (const b of this.eraBlocks) this.physics.add.collider(this.player, b.zone);

    this.buildWindows();
    this.buildOverlays();

    // Câmera
    const cam = this.cameras.main;
    cam.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    cam.startFollow(this.player, true, 0.12, 0.12);
    cam.setDeadzone(120, 80);
    cam.centerOn(SPAWN.x, SPAWN.y);
    // Emite após o preRender da câmera (scroll já atualizado/clampado).
    this.game.events.on(Phaser.Core.Events.POST_RENDER, this.emitCameraIfChanged, this);
    this.emitCamera();

    this.subscribe();
    this.applyEraToLevel(this.era);

    // Estado inicial: 'title' (física pausada), a menos que o React já esteja em 'playing'.
    const lastState = EventBus.getLast('GAME_STATE_CHANGED')?.state;
    if (lastState === 'playing') this.startPlaying();
    else this.physics.pause();

    this.emitStats();
  }

  // -------------------------------------------------------------------------
  // Construção do nível
  // -------------------------------------------------------------------------

  private buildLevel(): void {
    this.platforms = this.physics.add.staticGroup();
    for (const r of PLATFORMS) {
      const ts = this.add.tileSprite(r.x, r.y, r.w, r.h, textureKey('platform', this.era));
      ts.setOrigin(0, 0).setDepth(DEPTH_LEVEL);
      this.platforms.add(ts);
      (ts.body as Phaser.Physics.Arcade.StaticBody).updateFromGameObject();
      this.platformSprites.push(ts);
    }

    this.bouncyGroup = this.physics.add.staticGroup();
    for (const r of BOUNCY) {
      const ts = this.add.tileSprite(r.x, r.y, r.w, r.h, textureKey('bouncy', this.era));
      ts.setOrigin(0, 0).setDepth(DEPTH_ENTITY);
      this.bouncyGroup.add(ts);
      (ts.body as Phaser.Physics.Arcade.StaticBody).updateFromGameObject();
      this.bouncySprites.push(ts);
    }

    // Firewall (CommentWall cuida da própria colisão por era)
    this.firewall = new CommentWall(this, FIREWALL.x, FIREWALL.y, FIREWALL.w, FIREWALL.h, '// FIREWALL_COMMENT');

    // Espinhos: visual TileSprite (rotacionado para paredes) + hitbox manual levemente reduzida.
    for (const h of HAZARDS) {
      const key = textureKey('hazard', this.era);
      let sprite: Phaser.GameObjects.TileSprite;
      if (h.dir === 'up' || h.dir === 'down') {
        sprite = this.add.tileSprite(h.x, h.y, h.w, h.h, key).setOrigin(0, 0).setFlipY(h.dir === 'down');
      } else {
        // Comprimento vertical vira largura do tile; rotaciona ±90°.
        sprite = this.add.tileSprite(h.x + h.w / 2, h.y + h.h / 2, h.h, h.w, key).setOrigin(0.5, 0.5);
        sprite.setAngle(h.dir === 'right' ? 90 : -90);
      }
      sprite.setDepth(DEPTH_ENTITY);
      const inset = 4;
      // A folga fica do lado das pontas: embaixo nos espinhos de teto, em cima nos demais.
      const top = h.dir === 'down' ? h.y : h.y + inset;
      this.hazards.push({
        sprite,
        hit: { x: h.x + inset, y: top, w: Math.max(1, h.w - inset * 2), h: Math.max(1, h.h - inset) },
      });
    }

    // Blocos que dependem da era (botão skeuomórfico de 2013, vidro de 2026).
    for (const def of ERA_BLOCKS) {
      const zone = this.add.zone(def.x + def.w / 2, def.y + def.h / 2, def.w, def.h);
      this.physics.add.existing(zone, true);
      const gfx = this.add.graphics().setDepth(DEPTH_ENTITY);
      this.eraBlocks.push({ def, zone, gfx });
    }

    // 1958: trajetória prevista do pulo, como o ponto de luz do Tennis for Two.
    this.trajectory = this.add.graphics().setDepth(DEPTH_ENTITY - 1);

    // Lasers verticais: TileSprite horizontal rotacionado 90° + emissores no teto/chão.
    for (const def of LASERS) {
      const len = def.y2 - def.y1;
      const beam = this.add
        .tileSprite(def.x, def.y1 + len / 2, len, 10, textureKey('laser', this.era))
        .setOrigin(0.5, 0.5)
        .setAngle(90)
        .setDepth(DEPTH_ENTITY);
      this.lasers.push({ def, beam, on: true });
      for (const ny of [def.y1 + 4, def.y2 - 4]) {
        const node = this.add.image(def.x, ny, textureKey('hazard', this.era)).setDisplaySize(20, 8).setDepth(DEPTH_ENTITY + 1);
        this.laserNodes.push(node);
      }
    }

    // Moedas
    for (const p of COINS) {
      const sprite = this.add.image(p.x, p.y, textureKey('coin', this.era)).setDepth(DEPTH_ENTITY);
      this.tweens.add({ targets: sprite, y: p.y - 4, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.inOut', delay: (p.x % 7) * 90 });
      this.coins.push({ sprite, x: p.x, y: p.y, taken: false });
    }

    // Artefatos (visual único, flutuando)
    for (const a of ARTIFACT_PLACEMENTS) {
      const sprite = this.add.image(a.x, a.y, artifactTextureKey(a.id)).setDepth(DEPTH_ENTITY + 1);
      // Float + pulsing halo (replaces the previous float/scale tweens; tinted per era in applyEraToLevel).
      const idle = createArtifactIdleEffect(this, sprite, { amplitude: 5, periodMs: 1800 });
      this.artifacts.push({ sprite, x: a.x, y: a.y, taken: false, id: a.id, idle });
    }

    // Checkpoints (de pé sobre a superfície)
    for (const c of CHECKPOINTS) {
      const sprite = this.add.image(c.x, c.y, textureKey('checkpoint', this.era)).setOrigin(0.5, 1).setDepth(DEPTH_ENTITY);
      sprite.setAlpha(0.45);
      this.checkpoints.push({ sprite, point: c, active: false });
    }

    // Núcleo 2026 (pulsando)
    this.core = this.add.image(CORE_POS.x, CORE_POS.y, textureKey('core', this.era)).setDepth(DEPTH_ENTITY);
    this.tweens.add({ targets: this.core, scale: 1.1, duration: 800, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    this.tweens.add({ targets: this.core, angle: 360, duration: 12000, repeat: -1 });

    // Placas
    for (const s of SIGNS) {
      const t = this.add.text(s.x, s.y, s.text, { fontSize: '16px', align: 'center', lineSpacing: 2 });
      t.setOrigin(0.5, 1).setDepth(DEPTH_OVERLAY);
      this.signs.push(t);
    }
  }

  /** Colisores das janelas do SO (DOM). Inicializa por WINDOW_DEFS até chegar WINDOWS_UPDATED. */
  private buildWindows(): void {
    // Bloco desenhado no canvas para o pop-up 404 fora de 1995.
    const popupDef = WINDOW_DEFS.find((d) => d.kind === 'popup');
    this.popupBlockBg = this.add.rectangle(0, 0, 10, 10, 0xff0000).setOrigin(0, 0);
    this.popupBlockText = this.add
      .text(0, 0, 'ERRO 404\n— visite 1995 [6]', { fontSize: '20px', align: 'center', wordWrap: { width: 220 } })
      .setOrigin(0.5, 0.5);
    this.popupBlock = this.add.container(0, 0, [this.popupBlockBg, this.popupBlockText]).setDepth(DEPTH_ENTITY + 2);
    this.popupBlock.setVisible(false);
    if (popupDef) this.layoutPopupBlock(popupDef);

    this.applyWindows(EventBus.getLast('WINDOWS_UPDATED')?.windows ?? this.defaultWindows());
  }

  /** Estado das janelas antes do React reportar: bridge ativa só nas suas eras; popup ativo. */
  private defaultWindows(): InteractiveWindowRect[] {
    return WINDOW_DEFS.map((d) => ({
      id: d.id,
      x: d.x,
      y: d.y,
      width: d.width,
      height: d.height,
      kind: d.kind,
      active: d.kind === 'bridge' ? d.eras.includes(this.era) : true,
    }));
  }

  private buildOverlays(): void {
    this.bulletTimeOverlay = this.add
      .rectangle(0, 0, this.scale.width, this.scale.height, 0x00ff66, 0.08)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH_OVERLAY)
      .setVisible(false);
  }

  // -------------------------------------------------------------------------
  // EventBus
  // -------------------------------------------------------------------------

  private listen<K extends EventName>(event: K, handler: (p: EventMap[K]) => void): void {
    this.unsubs.push(EventBus.on(event, handler));
  }

  private subscribe(): void {
    this.listen('ERA_CHANGED', ({ era }) => {
      this.era = era;
      this.eraRenderer.applyEra(era);
      this.applyEraToLevel(era);
      if (!EventBus.getLast('WINDOWS_UPDATED')) this.applyWindows(this.defaultWindows());
      // Mid-air era combo: eras only change through EraManager, so count them while airborne.
      if (this.air && this.state === 'playing') this.air.eras.add(era);
    });
    this.listen('WINDOWS_UPDATED', ({ windows }) => this.applyWindows(windows));
    this.listen('POPUP_CLOSED', ({ id }) => this.closePopup(id));
    this.listen('TRIGGER_SCREEN_SHAKE', ({ intensity, duration }) => this.cameras.main.shake(duration, intensity));
    this.listen('BULLET_TIME_CHANGED', ({ active }) => {
      this.bulletTime = active;
      this.bulletTimeOverlay.setVisible(active);
    });
    this.listen('GAME_RESTART', () => {
      this.needsRestart = true;
    });
    this.listen('DEV_WARP', (warp) => this.devWarp(warp));
    this.listen('GAME_STATE_CHANGED', ({ state }) => {
      if (state === 'playing') {
        if (this.needsRestart) this.scene.restart();
        else if (this.state === 'title' || this.state === 'paused') this.startPlaying();
      } else if (state === 'paused' && this.state === 'playing') {
        this.state = 'paused';
        this.physics.pause();
        this.tweens.pauseAll();
      } else if (state === 'title' && this.state === 'playing') {
        this.state = 'title';
        this.physics.pause();
      }
    });
  }

  private cleanup(): void {
    if (this.cleanedUp) return;
    this.cleanedUp = true;
    this.events.off(Phaser.Scenes.Events.SHUTDOWN, this.cleanup, this);
    this.events.off(Phaser.Scenes.Events.DESTROY, this.cleanup, this);
    for (const off of this.unsubs) off();
    this.unsubs = [];
    this.game.events.off(Phaser.Core.Events.POST_RENDER, this.emitCameraIfChanged, this);
    this.firewall?.destroy();
    this.eraRenderer?.destroy();
  }

  // -------------------------------------------------------------------------
  // Era
  // -------------------------------------------------------------------------

  private applyEraToLevel(era: EraId): void {
    const config: EraConfig = ERA_CONFIGS[era];
    this.physics.world.gravity.y = config.gravity;
    this.cameras.main.setBackgroundColor(config.palette.background);

    const plat = textureKey('platform', era);
    for (const s of this.platformSprites) s.setTexture(plat);
    const bouncy = textureKey('bouncy', era);
    for (const s of this.bouncySprites) s.setTexture(bouncy);
    const hazard = textureKey('hazard', era);
    for (const h of this.hazards) h.sprite.setTexture(hazard);
    for (const n of this.laserNodes) n.setTexture(hazard).setDisplaySize(20, 8);
    const laser = textureKey('laser', era);
    for (const l of this.lasers) l.beam.setTexture(laser);
    const coin = textureKey('coin', era);
    for (const c of this.coins) if (!c.taken) c.sprite.setTexture(coin);
    const cp = textureKey('checkpoint', era);
    for (const c of this.checkpoints) c.sprite.setTexture(cp);
    this.core.setTexture(textureKey('core', era));

    const pal = config.palette;
    const halo = hexToNumber(pal.accent);
    for (const a of this.artifacts) if (!a.taken) a.idle.setColor(halo);
    for (const b of this.eraBlocks) this.applyEraBlock(b, era, pal);
    this.trajectory.clear();

    for (const t of this.signs) {
      t.setFontFamily(config.fontFamily);
      t.setColor(pal.text);
      t.setStroke(pal.background, 4);
    }

    // Bloco 404 estilizado na paleta da era
    this.popupBlockBg.setFillStyle(hexToNumber(pal.hazard), 0.92);
    this.popupBlockBg.setStrokeStyle(4, hexToNumber(pal.foreground), 1);
    // Texto branco com contorno escuro: legível sobre qualquer cor de perigo.
    this.popupBlockText.setFontFamily(config.fontFamily).setColor('#FFFFFF').setStroke('#000000', 4);
    this.refreshPopupBlock();
  }

  /** Liga/desliga o colisor e redesenha: sólido = objeto da época; fantasma = contorno fraco (dica). */
  private applyEraBlock(b: EraBlockObj, era: EraId, pal: EraConfig['palette']): void {
    const solid = isEraBlockSolid(b.def.kind, era);
    (b.zone.body as Phaser.Physics.Arcade.StaticBody).enable = solid;
    const { x, y, w, h } = b.def;
    const g = b.gfx.clear();
    if (!solid) {
      g.lineStyle(1, hexToNumber(pal.foreground), 0.22).strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      return;
    }
    if (b.def.kind === 'skeuo') {
      // Botão de gel da Web 2.0: corpo arredondado, sombra embaixo e reflexo em cima.
      g.fillStyle(hexToNumber(pal.primary), 1).fillRoundedRect(x, y, w, h, 8);
      g.fillStyle(0x000000, 0.22).fillRoundedRect(x, y + h * 0.55, w, h * 0.45, { tl: 0, tr: 0, bl: 8, br: 8 });
      g.fillStyle(0xffffff, 0.5).fillRoundedRect(x + 3, y + 3, w - 6, h * 0.4, 6);
      g.lineStyle(2, hexToNumber(pal.foreground), 0.9).strokeRoundedRect(x, y, w, h, 8);
    } else {
      // Vidro: translúcido, borda brilhante e um fio de reflexo.
      g.fillStyle(hexToNumber(pal.accent), 0.22).fillRoundedRect(x, y, w, h, 4);
      g.lineStyle(2, hexToNumber(pal.accent), 0.95).strokeRoundedRect(x, y, w, h, 4);
      g.lineStyle(1, 0xffffff, 0.6).lineBetween(x + 6, y + 3, x + w - 6, y + 3);
    }
  }

  /**
   * 1958: o computador do Tennis for Two calculava a trajetória da bola. Aqui ele desenha
   * o arco do próximo pulo (sem controle no ar, é exatamente o caminho que será feito).
   * No ar o traço fica congelado, mostrando o arco em andamento.
   */
  private updateTrajectory(body: Phaser.Physics.Arcade.Body): void {
    if (this.era !== EraId.VECTOR_1958) return;
    const grounded = body.blocked.down || body.touching.down;
    if (!grounded) return;
    const config = ERA_CONFIGS[this.era];
    const g = this.trajectory.clear();
    const color = hexToNumber(config.palette.primary);
    const x0 = body.center.x;
    const y0 = body.bottom;
    const vx = body.velocity.x;
    const solids = [...PLATFORMS, FIREWALL];
    for (let t = TRACE_STEP_S; t <= TRACE_MAX_S; t += TRACE_STEP_S) {
      const x = x0 + vx * t;
      const y = y0 - config.jumpVelocity * t + 0.5 * config.gravity * t * t;
      if (y > WORLD_HEIGHT || solids.some((r) => x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h)) break;
      g.fillStyle(color, 0.85 - (t / TRACE_MAX_S) * 0.55).fillCircle(x, y, 2);
    }
  }

  // -------------------------------------------------------------------------
  // Janelas (React → colisores)
  // -------------------------------------------------------------------------

  private applyWindows(rects: InteractiveWindowRect[]): void {
    for (const rect of rects) {
      let wc = this.windows.get(rect.id);
      if (!wc) {
        const zone = this.add.zone(rect.x + rect.width / 2, rect.y + rect.height / 2, rect.width, rect.height);
        this.physics.add.existing(zone, true);
        if (this.player) this.physics.add.collider(this.player, zone);
        wc = { zone, rect };
        this.windows.set(rect.id, wc);
      }
      wc.rect = rect;
      const body = wc.zone.body as Phaser.Physics.Arcade.StaticBody;
      wc.zone.setSize(rect.width, rect.height);
      wc.zone.setPosition(rect.x + rect.width / 2, rect.y + rect.height / 2);
      body.setSize(rect.width, rect.height);
      body.updateFromGameObject();
      body.enable = rect.active && !this.closedPopups.has(rect.id);
      if (rect.kind === 'popup') this.layoutPopupBlock(rect);
    }
    this.refreshPopupBlock();
  }

  private layoutPopupBlock(rect: Pick<InteractiveWindowRect, 'x' | 'y' | 'width' | 'height'>): void {
    this.popupBlock.setPosition(rect.x, rect.y);
    this.popupBlockBg.setSize(rect.width, rect.height);
    this.popupBlockBg.setDisplaySize(rect.width, rect.height);
    this.popupBlockText.setPosition(rect.width / 2, rect.height / 2);
    this.popupBlockText.setWordWrapWidth(rect.width - 16);
  }

  private refreshPopupBlock(): void {
    if (!this.popupBlock) return;
    const popup = [...this.windows.values()].find((w) => w.rect.kind === 'popup');
    const visible =
      !!popup && popup.rect.active && !this.closedPopups.has(popup.rect.id) && this.era !== EraId.WIN95_1995;
    this.popupBlock.setVisible(visible);
  }

  private closePopup(id: string): void {
    if (this.closedPopups.has(id)) return;
    this.closedPopups.add(id);
    const wc = this.windows.get(id);
    if (wc?.rect.kind === 'popup') this.onPopupClosedMechanic();
    if (wc) {
      (wc.zone.body as Phaser.Physics.Arcade.StaticBody).enable = false;
      EventBus.emit('SPAWN_BURST', {
        x: wc.rect.x + wc.rect.width / 2,
        y: wc.rect.y + wc.rect.height / 2,
        kind: 'eraChange',
      });
    }
    this.refreshPopupBlock();
  }

  // -------------------------------------------------------------------------
  // Estados
  // -------------------------------------------------------------------------

  private startPlaying(): void {
    this.state = 'playing';
    this.physics.resume();
    this.tweens.resumeAll();
  }

  private triggerVictory(): void {
    if (this.state !== 'playing') return;
    this.state = 'victory';
    this.needsRestart = true;
    this.player.setVelocity(0, 0);
    this.physics.pause();
    EventBus.emit('SPAWN_BURST', { x: CORE_POS.x, y: CORE_POS.y, kind: 'artifact' });
    EventBus.emit('PLAY_SFX', { sound: 'victory' });
    if (this.deaths === 0) playPerfectRunCelebrationVFX(this, CORE_POS.x, CORE_POS.y);
    EventBus.emit('GAME_STATE_CHANGED', { state: 'victory' });
    this.emitStats();
  }

  // -------------------------------------------------------------------------
  // Loop
  // -------------------------------------------------------------------------

  update(time: number, delta: number): void {
    // Pausado: congela tudo (fundo, lasers, jogador).
    if (this.state === 'paused') return;
    this.eraRenderer.update(time, delta);

    // Relógio dos obstáculos (desacelera no Bullet Time; o jogador não).
    this.obstacleClock += delta * (this.bulletTime ? BULLET_TIME_SCALE : 1);
    this.updateLasers();

    if (this.state !== 'playing') return;

    this.player.update(time, delta);

    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const pRect: Rect = { x: body.x, y: body.y, w: body.width, h: body.height };
    const cx = body.center.x;
    const cy = body.center.y;

    this.updateTrajectory(body);
    this.checkDeath(pRect, time);
    if (this.state !== 'playing') return;
    // Skip telemetry on the death frame: the body was just teleported to the respawn point.
    if (this.lastDeathAt !== time) {
      this.updateSectorProgress(cx);
      this.updateMechanics(body, time);
    }
    this.checkPickups(cx, cy);
    this.checkCheckpoints(cx, cy);
    if (Phaser.Math.Distance.Between(cx, cy, CORE_POS.x, CORE_POS.y) < 64) this.triggerVictory();

    this.statsTimer += delta;
    if (this.statsTimer >= STATS_INTERVAL_MS) {
      this.statsTimer = 0;
      this.emitStats();
    }
  }

  private updateLasers(): void {
    const t = this.obstacleClock / 1000;
    for (const l of this.lasers) {
      const { period, offTime, phase } = l.def;
      const local = (((t + phase) % period) + period) % period;
      const on = local >= offTime;
      if (on !== l.on) {
        l.on = on;
        l.beam.setAlpha(on ? 1 : 0.12);
      }
    }
  }

  private checkDeath(p: Rect, time: number): void {
    if (time - this.lastDeathAt < DEATH_COOLDOWN_MS) return;
    let cause: DeathCause | null = p.y > WORLD_HEIGHT + 40 ? 'fall' : null;
    if (!cause && this.hazards.some((h) => rectsOverlap(p, h.hit))) cause = 'spike';
    if (
      !cause &&
      this.lasers.some((l) => l.on && rectsOverlap(p, { x: l.def.x - 5, y: l.def.y1, w: 10, h: l.def.y2 - l.def.y1 }))
    ) {
      cause = 'laser';
    }
    if (cause) this.killPlayer(time, cause);
  }

  private killPlayer(time: number, cause?: DeathCause): void {
    this.lastDeathAt = time;
    this.deaths++;
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    // Telemetry: where/why the player died (+ a tip when an era mechanic would have helped).
    const deathTip = cause ? this.deathTipFor(cause, body.center.x, body.center.y) : undefined;
    EventBus.emit('PLAYER_DIED', {
      era: this.era,
      sector: sectorAt(body.center.x).id,
      ...(cause ? { cause } : {}),
      ...(deathTip ? { deathTip } : {}),
    });
    this.sectorDeaths++;
    this.resetMechanicTracking();
    EventBus.emit('PLAY_SFX', { sound: 'death' });
    EventBus.emit('SPAWN_BURST', { x: body.center.x, y: Math.min(body.center.y, WORLD_HEIGHT - 10), kind: 'death' });
    this.player.respawn(this.respawnPoint.x, this.respawnPoint.y);
    this.emitStats();
  }

  private checkPickups(cx: number, cy: number): void {
    for (const c of this.coins) {
      if (c.taken || Math.abs(cx - c.x) > 22 || Math.abs(cy - c.sprite.y) > 28) continue;
      c.taken = true;
      this.coinCount++;
      EventBus.emit('PLAY_SFX', { sound: 'coin' });
      EventBus.emit('SPAWN_BURST', { x: c.x, y: c.sprite.y, kind: 'coin' });
      c.sprite.destroy();
    }
    for (const a of this.artifacts) {
      if (a.taken || Math.abs(cx - a.x) > 26 || Math.abs(cy - a.sprite.y) > 32) continue;
      a.taken = true;
      // The pickup sound ("boot") is played by SoundSynthesizer on ARTIFACT_COLLECTED (emitted by collectArtifact).
      EraManager.collectArtifact(a.id);
      EventBus.emit('SPAWN_BURST', { x: a.x, y: a.sprite.y, kind: 'artifact' });
      // Hit-stop + shockwaves + burst. No rising text: the React "item get" card (which pauses the
      // game) shows the name and unlocked eras, so the player reads it once, at their own pace.
      playArtifactCollectVFX(this, a.x, a.sprite.y, hexToNumber(ERA_CONFIGS[this.era].palette.accent), {
        era: this.era,
        shouldResume: () => this.state === 'playing' && !this.cleanedUp,
      });
      a.idle.destroy();
      a.sprite.destroy();
      this.emitStats();
    }
  }

  /** Modo de teste: some com os artefatos das eras ≤ `era` (sem card) e teleporta, com respawn ali. */
  private devWarp({ x, y, era }: EventMap['DEV_WARP']): void {
    for (const a of this.artifacts) {
      if (a.taken || !ARTIFACTS[a.id].unlocks.some((e) => e <= era)) continue;
      a.taken = true;
      a.idle.destroy();
      a.sprite.destroy();
    }
    this.respawnPoint = { x, y };
    this.player.respawn(x, y);
    this.resetMechanicTracking();
    this.emitStats();
  }

  private checkCheckpoints(cx: number, cy: number): void {
    for (const c of this.checkpoints) {
      if (c.active || Math.abs(cx - c.point.x) > 24 || cy < c.point.y - 80 || cy > c.point.y + 4) continue;
      for (const o of this.checkpoints) {
        if (o.active) {
          o.active = false;
          o.sprite.setAlpha(0.45);
        }
      }
      c.active = true;
      c.sprite.setAlpha(1);
      this.tweens.add({ targets: c.sprite, scaleY: 1.25, scaleX: 0.85, duration: 120, yoyo: true, ease: 'Quad.out' });
      this.respawnPoint = { x: c.point.x, y: c.point.y - 30 };
      EventBus.emit('SPAWN_BURST', { x: c.point.x, y: c.point.y - 24, kind: 'land' });
      EventBus.emit('PLAY_SFX', { sound: 'click' });
      this.floatText(c.point.x, c.point.y - 70, 'CHECKPOINT');
    }
  }

  private onBouncyCollide(): void {
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    if (!body.touching.down && !body.blocked.down) return;
    const now = this.time.now;
    if (now - this.lastBounceAt < 150) return;
    this.lastBounceAt = now;
    this.player.bounce(BOUNCE_VELOCITY);
  }

  private floatText(x: number, y: number, msg: string): void {
    const config = ERA_CONFIGS[this.era];
    const t = this.add
      .text(x, y, msg, {
        fontFamily: config.fontFamily,
        fontSize: '18px',
        color: config.palette.text,
        align: 'center',
        stroke: config.palette.background,
        strokeThickness: 4,
      })
      .setOrigin(0.5, 1)
      .setDepth(DEPTH_OVERLAY);
    this.tweens.add({ targets: t, y: y - 60, alpha: 0, duration: 2200, ease: 'Cubic.out', onComplete: () => t.destroy() });
  }

  // -------------------------------------------------------------------------
  // Run telemetry & era mechanics (PLAYER_DIED / SECTOR_REACHED / ERA_MECHANIC_TRIGGERED)
  // -------------------------------------------------------------------------

  /** Drops every in-progress detection (death/respawn teleports the player). */
  private resetMechanicTracking(): void {
    this.wasGrounded = false;
    this.air = null;
    this.wasOnWindow = false;
    this.laserCross = null;
    this.glassCross = null;
    for (const t of this.passTrackers) {
      t.side = null;
      t.sawEra = false;
    }
  }

  /** SECTOR_REACHED the first time per run the player enters a sector beyond the previous max. */
  private updateSectorProgress(cx: number): void {
    const sector = sectorAt(cx).id;
    if (sector <= this.maxSector) return;
    EventBus.emit('SECTOR_REACHED', { sectorIndex: sector, sectorDeathsBeforeReset: this.sectorDeaths });
    this.maxSector = sector;
    this.sectorDeaths = 0;
  }

  private updateMechanics(body: Phaser.Physics.Arcade.Body, time: number): void {
    const grounded = body.blocked.down || body.touching.down;
    const cx = body.center.x;

    // --- Airtime: 1958 ballistic long jump + mid-air era combo ---
    if (!grounded && this.wasGrounded) {
      this.air = { startX: cx, jumped: body.velocity.y < 0, eras: new Set([this.era]) };
    } else if (grounded && !this.wasGrounded) {
      if (this.air) this.onLanded(this.air, cx);
      this.air = null;
    }
    this.wasGrounded = grounded;

    // --- 1977 comment wall / 2013 skeuo button: crossed while passable ---
    for (const t of this.passTrackers) {
      if (!this.updatePassTracker(t, body)) continue;
      if (t.era === EraId.ASCII_1977) {
        this.triggerMechanic('comment_wall_passed', t.era, '// IGNORADO PELO COMPILADOR');
      } else {
        this.triggerMechanic('flat_shift_pass', t.era, 'FLAT DESIGN: TEXTURA 3D REMOVIDA');
      }
    }

    // --- 1984: standing on the active bridge window (once per landing, with cooldown) ---
    let onWindow = false;
    if (grounded && this.era === EraId.MAC_1984) {
      for (const wc of this.windows.values()) {
        const r = wc.rect;
        if (r.kind !== 'bridge' || !r.active || !(wc.zone.body as Phaser.Physics.Arcade.StaticBody).enable) continue;
        if (Math.abs(body.bottom - r.y) <= 4 && body.right > r.x + 2 && body.x < r.x + r.width - 2) onWindow = true;
      }
    }
    if (onWindow && !this.wasOnWindow && time - this.lastWindowStandAt >= WINDOW_STAND_COOLDOWN_MS) {
      this.lastWindowStandAt = time;
      this.triggerMechanic('gui_window_stand', EraId.MAC_1984, '[XEROX_GUI: COLISÃO DE JANELA ATIVA]');
    }
    this.wasOnWindow = onWindow;

    // --- 1995: first moment the 404 popup is on camera (reaction-time start) ---
    if (this.popupSeenAt === null && this.era === EraId.WIN95_1995) {
      const view = this.cameras.main.worldView;
      for (const wc of this.windows.values()) {
        const r = wc.rect;
        if (r.kind !== 'popup' || !r.active || this.closedPopups.has(r.id)) continue;
        if (r.x < view.right && r.x + r.width > view.x && r.y < view.bottom && r.y + r.height > view.y) {
          this.popupSeenAt = this.time.now;
        }
      }
    }

    // --- 1999: laser corridor crossed (left → right) with Bullet Time used during the crossing ---
    const inCorridor = body.bottom > LASER_CORRIDOR.ceilingY && body.y < LASER_CORRIDOR.floorY;
    if (inCorridor && LASERS.length > 0) {
      const firstX = LASERS[0].x;
      const lastX = LASERS[LASERS.length - 1].x;
      if (body.right < firstX - 6) {
        this.laserCross = { usedBulletTime: false };
      } else if (body.x > lastX + 6) {
        if (this.laserCross?.usedBulletTime) {
          this.triggerMechanic('laser_bullet_time_pass', EraId.Y2K_1999, 'BULLET TIME // GPU 1999');
        }
        this.laserCross = null;
      } else if (this.laserCross && this.player.isBulletTimeActive()) {
        this.laserCross.usedBulletTime = true;
      }
    }

    // --- 2026: glass gap crossed on the panels, from the ledge to the core chamber, without falling ---
    const onGlassLevel = Math.abs(body.bottom - GLASS_GAP.floorY) <= 4;
    if (grounded && onGlassLevel && cx < GLASS_GAP.x1 && cx > TOWER.x2 - 40) {
      this.glassCross = { touchedGlass: false };
    } else if (this.glassCross) {
      if (body.y > GLASS_GAP.floorY + 24) {
        this.glassCross = null; // fell into the gap
      } else if (grounded && onGlassLevel && cx > GLASS_GAP.x2) {
        if (this.glassCross.touchedGlass) {
          this.triggerMechanic('glass_walk_complete', EraId.NEON_2026, 'VIDRO ESPACIAL: TRAVESSIA OK');
        }
        this.glassCross = null;
      } else if (grounded && onGlassLevel && this.era === EraId.NEON_2026) {
        const onPanel = ERA_BLOCKS.some(
          (b) => b.kind === 'glass' && body.right > b.x && body.x < b.x + b.w && Math.abs(body.bottom - b.y) <= 4,
        );
        if (onPanel) this.glassCross.touchedGlass = true;
      }
    }
  }

  /** Landing after a tracked airtime. */
  private onLanded(air: AirTrack, cx: number): void {
    if (air.eras.size >= 2) {
      const n = air.eras.size;
      this.triggerMechanic('midair_era_combo', this.era, `MIGRAÇÃO EM VOO: ${n} ERAS`, n);
    }
    // Pure 1958 parabola: jumped in 1958, never changed era mid-air, landed in 1958.
    if (air.jumped && air.eras.size === 1 && this.era === EraId.VECTOR_1958) {
      const distance = Math.round(Math.abs(cx - air.startX));
      if (distance >= LONG_JUMP_MIN_PX) {
        this.triggerMechanic('ballistic_long_jump', EraId.VECTOR_1958, `PARÁBOLA ANALÓGICA: ${distance}px`, distance);
      }
    }
  }

  /**
   * Returns true when the body fully crosses `t.rect` from one side to the other having overlapped it
   * while in `t.era` (the only era where it is passable). Side is only tracked inside the rect's
   * vertical band, so going around it never counts.
   */
  private updatePassTracker(t: PassTracker, body: Phaser.Physics.Arcade.Body): boolean {
    const r = t.rect;
    if (body.bottom <= r.y || body.y >= r.y + r.h) {
      t.side = null;
      t.sawEra = false;
      return false;
    }
    const side: -1 | 0 | 1 = body.right <= r.x ? -1 : body.x >= r.x + r.w ? 1 : 0;
    if (side === 0) {
      if (this.era === t.era) t.sawEra = true;
      return false;
    }
    const passed = t.side !== null && t.side !== side && t.sawEra;
    t.side = side;
    t.sawEra = false;
    return passed;
  }

  /** POPUP_CLOSED: reaction time from "popup on camera in 1995" to close. */
  private onPopupClosedMechanic(): void {
    const reaction = this.popupSeenAt !== null ? Math.max(0, Math.round(this.time.now - this.popupSeenAt)) : undefined;
    const label = reaction !== undefined ? `POP-UP BLOQUEADO! (${(reaction / 1000).toFixed(1)}s)` : 'POP-UP BLOQUEADO!';
    this.triggerMechanic('popup_closed', EraId.WIN95_1995, label, reaction);
  }

  /** Emits the mechanic, shows the diegetic label and, once per run, the reference callout. */
  private triggerMechanic(mechanicId: EraMechanicId, era: EraId, label: string, value?: number): void {
    EventBus.emit('ERA_MECHANIC_TRIGGERED', value === undefined ? { mechanicId, era } : { mechanicId, era, value });
    const body = this.player?.body as Phaser.Physics.Arcade.Body | undefined;
    if (body) showInWorldReferenceLabel(this, body.center.x, body.y - 22, label, era);
    if (!this.calloutsShown.has(mechanicId)) {
      this.calloutsShown.add(mechanicId);
      const { title, explanation } = MECHANIC_CALLOUTS[mechanicId];
      EventBus.emit('REFERENCE_CALLOUT', { era, title, explanation });
    }
  }

  /** PT-BR tip naming the era mechanic that would have avoided this death (undefined = none applies). */
  private deathTipFor(cause: DeathCause, cx: number, cy: number): string | undefined {
    if (cause === 'laser') {
      return this.player.isBulletTimeActive()
        ? 'Dica: com o Bullet Time ligado os lasers ficam lentos — espere o feixe apagar e avance um de cada vez.'
        : `Dica: em ${eraLabel(EraId.Y2K_1999)} (estética Matrix) toque Shift para ligar o Bullet Time e desacelerar os lasers.`;
    }
    if (cause === 'fall' && cx >= CHASM_LEFT_X - 20 && cx <= CHASM_RIGHT_X + 20) {
      return `Dica: em ${eraLabel(EraId.MAC_1984)} (o Macintosh popularizou as janelas) arraste a janela com o mouse até o meio do abismo e use-a como ponte.`;
    }
    if (cx >= TUNNEL_1986.x1 - 10 && cx <= TUNNEL_1986.x2 + 10) {
      return `Dica: em ${eraLabel(EraId.NES_1986)} (8-bit) o pulo é variável — dê um toque curto no pulo para um pulinho que não bate nos espinhos do teto.`;
    }
    if (cx >= GLASS_GAP.x1 - 20 && cx <= GLASS_GAP.x2 && cy > GLASS_GAP.floorY) {
      return `Dica: em ${eraLabel(EraId.NEON_2026)} (glassmorphism) os painéis de vidro ficam sólidos — ande por eles e use o DASH (X) nos vãos.`;
    }
    if (cx >= TOWER.x1 - 20 && cx <= TOWER.x2 + 20) {
      return `Dica: em ${eraLabel(EraId.FLASH_2005)} (Flash) use a mola e o Pulo Duplo para subir; para o túnel, ${eraLabel(EraId.FLAT_2013)} achata o botão e o DASH cruza os poços.`;
    }
    if (cause === 'spike' && cx < FIREWALL.x && this.era === EraId.VECTOR_1958) {
      return 'Dica: em 1958 (Tennis for Two) não há controle no ar — o arco pontilhado mostra exatamente onde o pulo vai cair.';
    }
    return undefined;
  }

  // -------------------------------------------------------------------------
  // React
  // -------------------------------------------------------------------------

  private emitCamera(): void {
    const cam = this.cameras.main;
    this.lastCam = { scrollX: cam.scrollX, scrollY: cam.scrollY, zoom: cam.zoom };
    EventBus.emit('CAMERA_UPDATED', { ...this.lastCam });
  }

  private emitCameraIfChanged(): void {
    if (this.cleanedUp) return;
    const cam = this.cameras.main;
    if (cam.scrollX !== this.lastCam.scrollX || cam.scrollY !== this.lastCam.scrollY || cam.zoom !== this.lastCam.zoom) {
      this.emitCamera();
    }
  }

  private emitStats(): void {
    if (!this.player?.body) return;
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const sector = sectorAt(body.center.x);
    const stats: PlayerStats = {
      x: Math.round(body.center.x),
      y: Math.round(body.center.y),
      sector: sector.id,
      sectorName: sector.name,
      coins: this.coinCount,
      deaths: this.deaths,
      artifacts: EraManager.getCollectedArtifacts(),
      dashReady: this.player.canDash(),
      bulletTimeActive: this.player.isBulletTimeActive(),
      grounded: body.blocked.down || body.touching.down,
    };
    EventBus.emit('PLAYER_STATS_UPDATED', stats);
  }
}
