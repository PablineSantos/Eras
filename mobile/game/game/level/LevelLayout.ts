/**
 * Layout declarativo da fase (coordenadas de mundo, px, canto superior esquerdo).
 *
 * Física de referência (ERA_CONFIGS):
 *  - retro (1958–1984): v=560, g=1100 → altura ≈142px, alcance ≈183px
 *  - 1986: v=580 → pulo cheio ≈153px; toque curto (pulo variável) ≈40–100px
 *  - moderno (1991+):   v=600, g=1150 → altura ≈156px, alcance ≈250px
 *  - 2005 pulo duplo: ≈316px de altura total
 *  - mola: bounce(-900) → ≈352px de altura
 *  - dash: 720px/s × 160ms ≈ 115px
 *
 * Cada obstáculo exige UMA era, na ordem histórica:
 *  1958 saltos de trajetória fixa → 1977 firewall → 1984 janela-ponte → 1986 túnel do
 *  pulinho → 1991 chaminé → 1995 pop-up → 1999 lasers → 2005 torre → 2013 botão
 *  skeuomórfico → 2026 painéis de vidro.
 */
import { ArtifactId, CHASM_LEFT_X, CHASM_RIGHT_X, EraId, GROUND_Y, WORLD_WIDTH } from '../../core/types';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Direção para onde apontam as pontas dos espinhos. */
export type SpikeDir = 'up' | 'down' | 'left' | 'right';
export interface HazardDef extends Rect {
  dir: SpikeDir;
}

export interface PointDef {
  x: number;
  y: number;
}

export interface ArtifactPlacement extends PointDef {
  id: ArtifactId;
}

export interface LaserDef {
  /** Centro X do feixe vertical. */
  x: number;
  y1: number;
  y2: number;
  /** Período total do ciclo (s) e tempo desligado (s). */
  period: number;
  offTime: number;
  /** Defasagem (s). */
  phase: number;
}

export interface SignDef extends PointDef {
  text: string;
}

/**
 * Bloco cuja solidez depende da era:
 *  - 'skeuo': botão brilhante da Web 2.0, sólido em todas as eras menos 2013 (o flat design o "achata").
 *  - 'glass': painel de vidro, só existe em 2026 (glassmorphism).
 */
export type EraBlockKind = 'skeuo' | 'glass';
export interface EraBlockDef extends Rect {
  kind: EraBlockKind;
}

export function isEraBlockSolid(kind: EraBlockKind, era: EraId): boolean {
  return kind === 'skeuo' ? era !== EraId.FLAT_2013 : era === EraId.NEON_2026;
}

export interface SectorDef {
  id: number;
  name: string;
  /** Limite X (exclusivo) do setor. */
  maxX: number;
}

// ---------------------------------------------------------------------------
// Setores
// ---------------------------------------------------------------------------

export const SECTORS: readonly SectorDef[] = [
  { id: 1, name: 'Início 1958 → 1977', maxX: 1700 },
  { id: 2, name: 'Abismo 1984 + Túnel 1986', maxX: 3400 },
  { id: 3, name: 'Chaminé 1991 → Pop-up 1995 → Lasers 1999', maxX: 4900 },
  { id: 4, name: 'Torre 2005 → Túnel 2013', maxX: 6040 },
  { id: 5, name: 'Vidro 2026 → Núcleo', maxX: Number.POSITIVE_INFINITY },
];

export function sectorAt(x: number): SectorDef {
  return SECTORS.find((s) => x < s.maxX) ?? SECTORS[SECTORS.length - 1];
}

export const SPAWN: PointDef = { x: 120, y: GROUND_Y - 60 };

// ---------------------------------------------------------------------------
// Geometria-chave
// ---------------------------------------------------------------------------

/** Setor 3: chaminé (vão interno 3524..3624 = 100px) e corredor dos lasers (y 800..1000). */
export const CHIMNEY = { innerLeft: 3524, innerRight: 3624, top: 1000 } as const;
export const LASER_CORRIDOR = { x1: 3624, x2: 4900, ceilingY: 800, floorY: 1000 } as const;
/** Setor 2: túnel do pulinho de 1986 (teto com espinhos 150px acima do chão). */
export const TUNNEL_1986 = { x1: 2960, x2: 3300, ceilingY: GROUND_Y - 150 } as const;
/** Setor 4: torre. */
export const TOWER = { x1: 4900, x2: 6040, floorY: 1000 } as const;
/** Setor 5: abismo de vidro (2026) sob o teto baixo, entre a borda e a câmara do núcleo (chão em y=430). */
export const GLASS_GAP = { x1: 6120, x2: 6660, floorY: 430 } as const;
export const CORE_POS: PointDef = { x: 6790, y: 430 - 58 };

/** Firewall: parede de comentário do chão ao teto (atravessável só em 1977). */
export const FIREWALL: Rect = { x: 1400, y: 0, w: 64, h: GROUND_Y };

// ---------------------------------------------------------------------------
// Plataformas sólidas
// ---------------------------------------------------------------------------

export const PLATFORMS: readonly Rect[] = [
  // --- Chão principal (abismo entre CHASM_LEFT_X e CHASM_RIGHT_X) ---
  { x: 0, y: GROUND_Y, w: CHASM_LEFT_X, h: 200 },
  { x: CHASM_RIGHT_X, y: GROUND_Y, w: WORLD_WIDTH - CHASM_RIGHT_X, h: 200 },

  // --- Setor 1: saltos básicos (todos ≤ 120px de subida, ≤ 80px de vão) ---
  { x: 320, y: 2100, w: 128, h: 32 },
  { x: 560, y: 2080, w: 64, h: 120 }, // bloco de 120px: exige pular
  { x: 940, y: 2090, w: 160, h: 32 }, // 110px acima do chão; decolagem segura logo após os espinhos
  { x: 1120, y: 1990, w: 128, h: 32 }, // Válvula em cima (100px acima da anterior)

  // --- Setor 2: teto do túnel de 1986 ---
  // Vai até o topo do mundo: impossível passar por cima do túnel.
  { x: TUNNEL_1986.x1, y: 0, w: TUNNEL_1986.x2 - TUNNEL_1986.x1, h: TUNNEL_1986.ceilingY },

  // --- Setor 3: chaminé + corredor ---
  { x: 3400, y: 800, w: 124, h: 1340 }, // parede esquerda da chaminé (vão de 60px embaixo p/ entrar sem escapar no wall-jump)
  { x: 3400, y: 0, w: 1500, h: 800 }, // massa superior = teto do corredor dos lasers
  { x: 3624, y: 1000, w: TOWER.x2 - 3624, h: GROUND_Y - 1000 }, // massa inferior = parede dir. da chaminé + chão do corredor/torre

  // --- Setor 4: torre ---
  { x: 5040, y: 976, w: 96, h: 24 }, // pedestal da mola
  { x: 5180, y: 660, w: 160, h: 32 }, // P1: só alcançável pela mola (pulo duplo do chão chega a ~684)
  { x: 5420, y: 430, w: 200, h: 32 }, // P2: +230px acima de P1 → exige Pulo Duplo
  // Teto do túnel do dash (72px de vão sobre y=430): segue até o fim do abismo de vidro, então ali não dá para pular.
  { x: 5560, y: 0, w: GLASS_GAP.x2 - 5560, h: 358 },
  { x: 5780, y: 430, w: 100, h: 32 }, // T2 entre os dois poços de 160px

  // --- Setor 5: borda, abismo de vidro e câmara do núcleo ---
  { x: TOWER.x2, y: 430, w: GLASS_GAP.x1 - TOWER.x2, h: GROUND_Y - 430 },
  { x: GLASS_GAP.x2, y: 430, w: WORLD_WIDTH - GLASS_GAP.x2, h: GROUND_Y - 430 },
];

/**
 * 2013: o botão skeuomórfico tapa a boca do túnel do dash (em 2026 a profundidade volta e ele é sólido).
 * 2026: três vãos de 100px no abismo de 540px. Sem os painéis, um dash (≈115px) não atravessa.
 * Painéis de 120px: andando por eles dá tempo de o dash recarregar (cooldown 350ms) antes da borda.
 */
export const ERA_BLOCKS: readonly EraBlockDef[] = [
  { x: 5584, y: 358, w: 32, h: 72, kind: 'skeuo' },
  { x: 6220, y: GLASS_GAP.floorY, w: 120, h: 16, kind: 'glass' },
  { x: 6440, y: GLASS_GAP.floorY, w: 120, h: 16, kind: 'glass' },
];

/** Plataformas elásticas (topo é onde o jogador quica). */
export const BOUNCY: readonly Rect[] = [{ x: 5040, y: 960, w: 96, h: 16 }];

// ---------------------------------------------------------------------------
// Perigos
// ---------------------------------------------------------------------------

export const HAZARDS: readonly HazardDef[] = [
  { x: 720, y: GROUND_Y - 16, w: 96, h: 16, dir: 'up' },
  { x: 1776, y: GROUND_Y - 16, w: 64, h: 16, dir: 'up' },
  // Túnel de 1986: o pulo cheio (≈153px) bate no teto; só o pulinho (soltar cedo) passa as duas valas.
  { x: TUNNEL_1986.x1, y: TUNNEL_1986.ceilingY, w: TUNNEL_1986.x2 - TUNNEL_1986.x1, h: 16, dir: 'down' },
  { x: 3040, y: GROUND_Y - 16, w: 64, h: 16, dir: 'up' },
  { x: 3180, y: GROUND_Y - 16, w: 64, h: 16, dir: 'up' },
  // Torre: espinhos no chão sob P1/P2 (punem quedas)
  { x: 5360, y: TOWER.floorY - 16, w: 160, h: 16, dir: 'up' },
  // Faces verticais da torre: impedem escalar com wall-jump em parede única
  { x: 4900, y: 100, w: 16, h: 680, dir: 'right' },
  { x: TOWER.x2 - 16, y: 480, w: 16, h: TOWER.floorY - 480, dir: 'left' },
  // Face esquerda da câmara do núcleo: impede contornar o abismo de vidro com wall-jump por baixo.
  { x: GLASS_GAP.x2 - 16, y: GLASS_GAP.floorY + 16, w: 16, h: GROUND_Y - GLASS_GAP.floorY - 16, dir: 'left' },
];

/** Lasers verticais (piso→teto do corredor). Desligado 0.14s: passar exige ≥0.15s a 240px/s. Com Bullet Time (0.4x) → 0.35s. */
export const LASERS: readonly LaserDef[] = [4080, 4220, 4360, 4500, 4640, 4780].map((x, i) => ({
  x,
  y1: LASER_CORRIDOR.ceilingY,
  y2: LASER_CORRIDOR.floorY,
  period: i % 2 === 0 ? 0.64 : 0.7,
  offTime: 0.14,
  phase: i * 0.21,
}));

// ---------------------------------------------------------------------------
// Coletáveis / pontos
// ---------------------------------------------------------------------------

/** y = superfície do chão onde o checkpoint fica de pé. */
export const CHECKPOINTS: readonly PointDef[] = [
  { x: 1530, y: GROUND_Y }, // após o firewall
  { x: 2150, y: GROUND_Y }, // antes do abismo
  { x: 2880, y: GROUND_Y }, // após o abismo / antes do túnel de 1986
  { x: 3574, y: GROUND_Y }, // base da chaminé
  { x: 3660, y: LASER_CORRIDOR.floorY }, // topo da chaminé, diante do pop-up
  { x: 4850, y: LASER_CORRIDOR.floorY }, // fim dos lasers / base da torre
  { x: 5470, y: 430 }, // P2 (antes do túnel do dash)
  { x: 6080, y: GLASS_GAP.floorY }, // borda do abismo de vidro
];

/**
 * Chronological order of invention: Válvula 1946, Disquete 1976, Cartucho 1983, Mouse 1984, CD-ROM 1985, GPU 1999.
 * Each sits right before the obstacle of the era it unlocks; the ones unlocking several eras
 * precede consecutive obstacles, each exclusive to one of them.
 */
export const ARTIFACT_PLACEMENTS: readonly ArtifactPlacement[] = [
  { id: ArtifactId.VALVE, x: 1184, y: 1955 }, // → 1977 (firewall)
  { id: ArtifactId.FLOPPY, x: 1610, y: GROUND_Y - 34 }, // → 1984 (janela-ponte) e 1986 (túnel)
  { id: ArtifactId.CARTRIDGE, x: 3350, y: GROUND_Y - 34 }, // → 1991 (chaminé)
  { id: ArtifactId.BALL_MOUSE, x: 3676, y: LASER_CORRIDOR.floorY - 34 }, // topo da chaminé, encostado no pop-up → 1995 (pop-up) e 1999 (lasers)
  { id: ArtifactId.CD_ROM, x: 4990, y: TOWER.floorY - 40 }, // → 2005 (pulo duplo)
  { id: ArtifactId.GPU_NEON, x: 5540, y: 395 }, // → 2013 (botão skeuomórfico) e 2026 (vidro)
];

export const COINS: readonly PointDef[] = [
  // Setor 1
  { x: 250, y: 2160 }, { x: 384, y: 2060 }, { x: 592, y: 2040 }, { x: 768, y: 2110 },
  { x: 1020, y: 2050 }, { x: 1300, y: 2160 }, { x: 1560, y: 2160 },
  // Setor 2
  { x: 1700, y: 2160 }, { x: 1900, y: 2160 }, { x: 2400, y: 2110 }, { x: 2520, y: 2090 },
  { x: 2640, y: 2110 }, { x: 2930, y: 2160 }, { x: 3142, y: 2160 }, { x: 3272, y: 2160 },
  // Setor 3: chaminé e corredor
  { x: 3574, y: 2000 }, { x: 3574, y: 1800 }, { x: 3574, y: 1600 }, { x: 3574, y: 1400 },
  { x: 3574, y: 1200 }, { x: 4150, y: 960 }, { x: 4290, y: 960 }, { x: 4430, y: 960 },
  { x: 4570, y: 960 }, { x: 4710, y: 960 },
  // Setor 4: torre
  { x: 5088, y: 820 }, { x: 5260, y: 620 }, { x: 5380, y: 520 }, { x: 5700, y: 400 },
  { x: 5830, y: 395 }, { x: 5960, y: 400 },
  // Setor 5
  { x: 6280, y: 400 }, { x: 6500, y: 400 }, { x: 6700, y: 400 },
];

/**
 * Modo de teste: um ponto de partida por obstáculo. `era` é a era do obstáculo; ao pular para cá,
 * todas as eras até ela são liberadas e os artefatos que as liberam somem do mapa.
 */
export interface DevWarpDef extends PointDef {
  era: EraId;
  label: string;
}

export const DEV_WARPS: readonly DevWarpDef[] = [
  { era: EraId.VECTOR_1958, label: 'Início', x: SPAWN.x, y: SPAWN.y },
  { era: EraId.ASCII_1977, label: 'Firewall de comentários', x: 1320, y: GROUND_Y - 30 },
  { era: EraId.MAC_1984, label: 'Abismo (janela-ponte)', x: 2150, y: GROUND_Y - 30 },
  { era: EraId.NES_1986, label: 'Túnel 8-bit', x: 2880, y: GROUND_Y - 30 },
  { era: EraId.SNES_1991, label: 'Chaminé', x: 3574, y: GROUND_Y - 30 },
  { era: EraId.WIN95_1995, label: 'Pop-up 404', x: 3650, y: LASER_CORRIDOR.floorY - 30 },
  { era: EraId.Y2K_1999, label: 'Lasers', x: 3975, y: LASER_CORRIDOR.floorY - 30 },
  { era: EraId.FLASH_2005, label: 'Torre (pulo duplo)', x: 4960, y: TOWER.floorY - 30 },
  { era: EraId.FLAT_2013, label: 'Túnel do dash', x: 5470, y: 430 - 30 },
  { era: EraId.NEON_2026, label: 'Abismo de vidro', x: 6080, y: GLASS_GAP.floorY - 30 },
];

/** Placas de dica (origem embaixo/centro). */
export const SIGNS: readonly SignDef[] = [
  { x: 200, y: 1990, text: '// SETOR 1 — INÍCIO 1958\n// Pegue a Válvula para liberar 1977' },
  { x: 1240, y: 2140, text: '// FIREWALL_COMMENT\n// Aperte [2] (1977) para atravessar comentários' },
  { x: 2080, y: 2140, text: '// ABISMO À FRENTE\n// [3] 1984: arraste a janela\n// para o meio do vão e use-a de ponte' },
  // Placas do túnel e da chaminé ficam separadas na horizontal E na vertical (a fonte 8/16-bit é larga).
  { x: 2810, y: 2120, text: '// TÚNEL 8-BIT\n// [4] 1986: toque\n// curto = pulinho' },
  { x: 3380, y: 2030, text: '// CHAMINÉ [5] 1991\n// → na parede\n// + Espaço' },
  // O corredor do pop-up (y 800..1000) não tem espaço livre: o próprio pop-up já explica o 1995
  // ("Erro 404" + OK / "visite 1995 [6]"), então a placa dos lasers fica DEPOIS dele, curta, à esquerda do 1º laser.
  { x: 4010, y: 990, text: '[7] 1999\nSHIFT =\nlento' },
  { x: 5010, y: 900, text: '// TORRE 2005\n// Pule na mola elástica' },
  { x: 5260, y: 600, text: '// [8] 2005: Pulo Duplo' },
  { x: 5470, y: 340, text: '// BOTÃO WEB 2.0 tapa o túnel\n// [9] 2013: o flat o apaga. DASH' },
  { x: 6080, y: 340, text: '// VIDRO 2026\n// [0]: painéis + DASH' },
  { x: CORE_POS.x, y: 250, text: '// NÚCLEO 2026' },
];
