/**
 * AchievementSystem — achievements, persistent museum discovery and run telemetry.
 *
 * - SINGLE WRITER of RunStats (STATS_UPDATED / RUN_COMPLETED are emitted only here).
 * - Persists achievements, discovered artifacts/eras, inspected lore and best run time in
 *   localStorage (`eras.progress.v1`); every storage access is guarded, so it works without storage.
 * - Getters return snapshot copies, cached per change, so they are safe as
 *   `useSyncExternalStore(AchievementSystem.subscribe, AchievementSystem.getAchievements)`.
 *
 * Import graph: AchievementSystem → EraManager → HistoricalCodex → types (acyclic).
 */
import { EventBus, type EventMap } from './EventBus';
import { ERA_CONFIGS, EraManager } from './EraManager';
import { ALL_LORE_IDS, ARTIFACT_LORE, isLoreId } from './HistoricalCodex';
import {
  ALL_ERAS,
  ArtifactId,
  EraId,
  type Achievement,
  type EraMechanicId,
  type GameState,
  type IAchievementSystem,
  type LoreId,
  type RunStats,
} from './types';

// ---------------------------------------------------------------------------
// Tunable thresholds
// ---------------------------------------------------------------------------

/** localStorage key of the persistent progress. */
export const PROGRESS_STORAGE_KEY = 'eras.progress.v1';
/** era_1995_popup_reflex: close the 404 pop-up faster than this (ms, reaction time reported by the scene). */
export const POPUP_REFLEX_MS = 800;
/** time_traveler_combo: distinct eras visited during a single airtime. */
export const MIDAIR_COMBO_ERAS = 4;
/**
 * overclock_speedrun: finish the run under this time (ms of 'playing' time; pauses don't count).
 * Tunable — 8 minutes is a comfortable-but-demanding target for the current level; the hint text
 * is derived from this constant.
 */
export const SPEEDRUN_TARGET_MS = 8 * 60 * 1000;
/** ctrl_alt_del: deaths in a single run. */
export const CTRL_ALT_DEL_DEATHS = 10;
/** STATS_UPDATED heartbeat while playing. */
export const STATS_TICK_MS = 1000;

const SPEEDRUN_MINUTES = Math.round(SPEEDRUN_TARGET_MS / 60000);

// ---------------------------------------------------------------------------
// Definitions (PT-BR)
// ---------------------------------------------------------------------------

export type AchievementId =
  | 'first_boot'
  | 'full_museum'
  | 'historian_rtfm'
  | 'museum_first_visit'
  | 'clean_sector'
  | 'kernel_panic_zero'
  | 'ctrl_alt_del'
  | 'overclock_speedrun'
  | 'era_1958_ballistic'
  | 'era_1977_comment'
  | 'era_1984_xerox'
  | 'era_1995_popup_reflex'
  | 'era_1999_bullet_time'
  | 'era_2005_2013_flat_shift'
  | 'era_2026_glass_walk'
  | 'time_traveler_combo'
  | 'legacy_maintainer';

export type AchievementDefinition = Omit<Achievement, 'unlocked' | 'unlockedAt' | 'progress'> & { id: AchievementId };

const ARTIFACT_COUNT = Object.values(ArtifactId).length;

export const ACHIEVEMENT_DEFINITIONS: readonly AchievementDefinition[] = [
  // --- collection -----------------------------------------------------------
  {
    id: 'first_boot',
    title: 'Hello, World!',
    description: 'Colete o seu primeiro artefato de hardware.',
    hint: 'O primeiro artefato, a Válvula, fica no alto do Setor 1. Em 1958 o pulo é uma parábola fixa: escolha o ponto de partida antes de pular, porque no ar não dá para corrigir.',
    referenceExplained:
      'Todo programador começa fazendo o computador escrever "hello, world" ("olá, mundo") na tela. A tradição veio de Brian Kernighan, da Bell Labs, que usou o exemplo em tutoriais nos anos 1970; ' +
      'o livro "The C Programming Language" (1978), escrito com Dennis Ritchie, espalhou o costume pelo mundo. É o "primeiro sinal de vida" de qualquer sistema.',
    category: 'collection',
    rarity: 'common',
    icon: 'Power',
    maxProgress: 1,
  },
  {
    id: 'full_museum',
    title: 'Curador do Silício',
    description: `Colete os ${ARTIFACT_COUNT} artefatos de hardware.`,
    hint: 'Cada artefato fica logo antes do obstáculo da era que ele libera. Travou? Leia a placa mais próxima e troque para a era indicada (teclas 1 a 0).',
    referenceExplained:
      'Museus de computação guardam máquinas, manuais e disquetes porque tecnologia envelhece rápido: muito software antigo só existe hoje porque alguém guardou a mídia e um aparelho capaz de lê-la. ' +
      'Da válvula à GPU, cada peça desta coleção mudou a forma como as pessoas usam computadores.',
    category: 'collection',
    rarity: 'epic',
    icon: 'Trophy',
    maxProgress: ARTIFACT_COUNT,
  },
  {
    id: 'historian_rtfm',
    title: 'RTFM: Leu o Manual Inteiro',
    description: `Leia todas as ${ALL_LORE_IDS.length} fichas do museu (artefatos e eras).`,
    hint: 'Abra o museu (tecla M ou o botão do HUD) e clique em cada ficha de artefato e de era. Fichas ainda bloqueadas abrem depois que você as descobre jogando.',
    referenceExplained:
      'Nos anos 1980 e 1990, quem fazia uma pergunta básica em fóruns de informática costumava ouvir "RTFM" — "Read The F*** Manual", algo como "leia o bendito manual". ' +
      'Era grosseiro, mas tinha um fundo de verdade: os computadores vinham com manuais grossos que explicavam quase tudo. Aqui, o manual é o museu — e você leu tudo.',
    category: 'collection',
    rarity: 'rare',
    icon: 'BookOpen',
    maxProgress: ALL_LORE_IDS.length,
  },
  {
    id: 'museum_first_visit',
    title: 'Visita Guiada',
    description: 'Leia a sua primeira ficha no museu.',
    hint: 'Abra o museu (tecla M ou o botão do HUD) e clique em qualquer artefato ou era já descoberto.',
    referenceExplained:
      'Cada mecânica deste jogo é uma piada com uma interface de verdade. As fichas do museu explicam o que era cada coisa, quem inventou e por que ela vira um obstáculo ou um poder na fase.',
    category: 'collection',
    rarity: 'common',
    icon: 'History',
    maxProgress: 1,
  },
  // --- hardcore -------------------------------------------------------------
  {
    id: 'clean_sector',
    title: 'Uptime 99.9%',
    description: 'Atravesse um setor inteiro sem morrer.',
    hint: 'Antes de cada obstáculo, pare e confira qual era a placa pede. O Setor 1 é o mais curto: pegue a Válvula com calma e atravesse o "//" em 1977.',
    referenceExplained:
      '"Uptime" é o tempo que um servidor fica no ar sem cair. Empresas prometem "três noves" (99,9%) de disponibilidade — o que ainda permite cerca de 8 horas e 45 minutos fora do ar por ano. ' +
      'Um setor sem nenhuma queda é o seu servidor funcionando liso.',
    category: 'hardcore',
    rarity: 'rare',
    icon: 'ShieldCheck',
    maxProgress: 1,
  },
  {
    id: 'kernel_panic_zero',
    title: 'Kernel Panic Zero',
    description: 'Termine o jogo sem morrer nenhuma vez.',
    hint: 'Conheça a fase antes: cada obstáculo pede uma era específica. Use o Bullet Time de 1999 nos lasers, o pulinho de 1986 no túnel e o Dash de 2026 entre os painéis de vidro.',
    referenceExplained:
      'O "kernel" é o núcleo do sistema operacional. Quando ele encontra um erro do qual não sabe se recuperar, entra em "kernel panic" e para tudo; no Windows, o equivalente é a famosa Tela Azul da Morte. ' +
      'Em 1998, durante uma demonstração do Windows 98 ao vivo com Bill Gates no palco, ligaram um scanner e a tela azul apareceu na frente da plateia.',
    category: 'hardcore',
    rarity: 'epic',
    icon: 'Skull',
    maxProgress: 1,
  },
  {
    id: 'ctrl_alt_del',
    title: 'Ctrl+Alt+Del',
    description: `Morra ${CTRL_ALT_DEL_DEATHS} vezes numa mesma partida.`,
    hint: 'Não tem segredo: insista. Cada morte mostra uma dica da era que te derrubou — leia e tente de novo.',
    referenceExplained:
      'Ctrl+Alt+Del foi criado por David Bradley, engenheiro da IBM, para reiniciar o IBM PC (1981) sem desligar da tomada. As três teclas ficam longe umas das outras para ninguém apertar sem querer. ' +
      'Anos depois ele brincou: "posso ter inventado, mas foi o Bill [Gates] que o tornou famoso".',
    category: 'hardcore',
    rarity: 'common',
    icon: 'Power',
    maxProgress: CTRL_ALT_DEL_DEATHS,
  },
  // --- mastery --------------------------------------------------------------
  {
    id: 'overclock_speedrun',
    title: 'Overclock Extremo',
    description: `Termine o jogo em menos de ${SPEEDRUN_MINUTES} minutos.`,
    hint:
      `A meta é terminar em menos de ${SPEEDRUN_MINUTES} minutos (pausas não contam). Troque de era antes de chegar no obstáculo, não em cima dele; ` +
      'em 2026 você corre mais rápido e tem Dash — use essa era em todo trecho que não exige outra.',
    referenceExplained:
      '"Overclock" é fazer o processador trabalhar acima da velocidade de fábrica. Nos anos 1990 virou esporte: o Intel Celeron 300A, de 1998, ficou lendário por rodar a 450 MHz em vez de 300. ' +
      'O preço é calor — os mais radicais resfriam o chip com nitrogênio líquido.',
    category: 'mastery',
    rarity: 'epic',
    icon: 'Zap',
    maxProgress: 1,
  },
  {
    id: 'time_traveler_combo',
    title: 'Migração de Sistema em Produção',
    description: `Passe por ${MIDAIR_COMBO_ERAS} eras diferentes durante um único pulo.`,
    hint: `Pule de um lugar alto (a mola da torre ajuda) e aperte rápido ${MIDAIR_COMBO_ERAS} teclas de era diferentes (1 a 0) antes de tocar o chão. Cuidado: em algumas eras a física muda no meio do ar.`,
    referenceExplained:
      'Em TI, "migrar em produção" é trocar o sistema enquanto os clientes estão usando — como trocar o pneu com o carro andando. ' +
      'Às vezes é inevitável (bancos e lojas on-line não podem parar), e por isso as equipes ensaiam muito e preparam um plano de volta. Você trocou de sistema quatro vezes sem tocar o chão.',
    category: 'mastery',
    rarity: 'rare',
    icon: 'Shuffle',
    maxProgress: MIDAIR_COMBO_ERAS,
  },
  {
    id: 'legacy_maintainer',
    title: 'Incompatibilidade Retroativa',
    description: 'Colete um artefato estando numa era mais antiga que a invenção dele.',
    hint: 'Pouco antes de pegar um artefato, volte para uma era anterior ao ano dele — por exemplo, pegue o Disquete (1976) estando em 1958.',
    referenceExplained:
      '"Compatibilidade retroativa" é o sistema novo continuar rodando coisas antigas. Muito banco ainda roda programas em COBOL, uma linguagem de 1959; ' +
      'em 2020, governos dos EUA chegaram a pedir programadores de COBOL às pressas para manter sistemas de auxílio-desemprego. Você fez o inverso: levou tecnologia do futuro para um sistema do passado.',
    category: 'mastery',
    rarity: 'rare',
    icon: 'History',
    maxProgress: 1,
  },
  // --- history --------------------------------------------------------------
  {
    id: 'era_1958_ballistic',
    title: 'Física de Osciloscópio (1958)',
    description: 'Faça um salto longo na parábola fixa de 1958.',
    hint: 'Fique em 1958 (tecla 1), pegue embalo correndo e pule perto da borda: em 1958 não dá para mudar o pulo no ar, então ele vai longe se você sair rápido.',
    referenceExplained:
      'No Tennis for Two (1958) não havia programa: circuitos analógicos (amplificadores operacionais) resolviam as equações da bola em tempo real, com gravidade de verdade. ' +
      'Depois de rebatida, a bola seguia a curva calculada — exatamente como o seu pulo nesta era.',
    category: 'history',
    rarity: 'common',
    icon: 'Activity',
    maxProgress: 1,
  },
  {
    id: 'era_1977_comment',
    title: 'Isto é Só um Comentário // (1977)',
    description: 'Atravesse uma parede de comentário "//" em 1977.',
    hint: 'Depois de pegar a Válvula, aperte 2 (1977) e ande direto para a muralha marcada com "//": o computador ignora comentários, e você também.',
    referenceExplained:
      'Programadores deixam bilhetes no código para outras pessoas: os comentários. Em várias linguagens, tudo depois de "//" na linha é ignorado pelo computador. ' +
      'O truque veio da linguagem BCPL (1967) e ficou famoso no C++. Para a máquina, aquela parede nunca existiu.',
    category: 'history',
    rarity: 'common',
    icon: 'Code',
    maxProgress: 1,
  },
  {
    id: 'era_1984_xerox',
    title: 'Subindo nas Janelas de Palo Alto (1984)',
    description: 'Fique em pé sobre uma janela da interface gráfica de 1984.',
    hint: 'Em 1984 (tecla 3), arraste a janela pela barra de título até o meio do abismo do Setor 2 e pule em cima dela.',
    referenceExplained:
      'Em 1979, Steve Jobs visitou a Xerox PARC, em Palo Alto, e viu o Alto: um computador com janelas, ícones e mouse. Em troca de poder comprar ações da Apple antes da estreia na bolsa, a Xerox abriu as portas. ' +
      'As ideias reapareceram no Lisa (1983) e no Macintosh (1984).',
    category: 'history',
    rarity: 'common',
    icon: 'AppWindow',
    maxProgress: 1,
  },
  {
    id: 'era_1995_popup_reflex',
    title: 'Reflexo Anti-Pop-up (1995)',
    description: `Feche o pop-up de 1995 em menos de ${(POPUP_REFLEX_MS / 1000).toLocaleString('pt-BR')} segundo.`,
    hint: 'Chegue ao topo da chaminé já em 1995 (tecla 6) e com o mouse posicionado: o pop-up 404 aparece no corredor e o relógio começa a contar quando ele entra na tela.',
    referenceExplained:
      'O Windows 95 vivia abrindo caixinhas de erro, e logo a web ganhou os anúncios pop-up, janelas que abriam sozinhas por cima do site. ' +
      'Ethan Zuckerman, que escreveu o código de um dos primeiros pop-ups (no site Tripod, no fim dos anos 1990), pediu desculpas publicamente em 2014. Fechar janelas virou reflexo de uma geração.',
    category: 'history',
    rarity: 'rare',
    icon: 'SquareX',
    maxProgress: 1,
  },
  {
    id: 'era_1999_bullet_time',
    title: 'Escolhido da Matrix (1999)',
    description: 'Atravesse os lasers usando o Bullet Time.',
    hint: 'No corredor dos lasers, troque para 1999 (tecla 7) e toque Shift: os lasers ficam a 40% da velocidade e a brecha entre os disparos fica larga o bastante para passar.',
    referenceExplained:
      'Em Matrix (1999), Neo desvia de balas em câmera lenta enquanto a câmera gira ao redor dele. O efeito, apelidado de "bullet time", foi feito com dezenas de câmeras fotográficas enfileiradas, ' +
      'disparadas uma após a outra, e o computador preenchia os quadros intermediários.',
    category: 'history',
    rarity: 'rare',
    icon: 'Timer',
    maxProgress: 1,
  },
  {
    id: 'era_2005_2013_flat_shift',
    title: 'Onde Foi Parar o Relevo? (2005 → 2013)',
    description: 'Achate o botão brilhante da Web 2.0 trocando para 2013 e passe através dele.',
    hint: 'No topo da torre, um botão gordo e brilhante tapa o túnel. Ele é sólido em quase todas as eras; aperte 9 (2013) e ele vira um desenho chapado — atravesse com o Dash.',
    referenceExplained:
      'Em 2013, o iOS 7 trocou o couro, a madeira e os botões brilhantes do iPhone por cores lisas e ícones simples. A Microsoft já seguia esse caminho com o estilo Metro. ' +
      'Da noite para o dia, as interfaces perderam o "volume" — e muita gente demorou para descobrir o que ainda era botão.',
    category: 'history',
    rarity: 'rare',
    icon: 'Layers',
    maxProgress: 1,
  },
  {
    id: 'era_2026_glass_walk',
    title: 'Caminhando no Vidro Espacial (2026)',
    description: 'Atravesse o abismo dos painéis de vidro de 2026 sem cair.',
    hint: 'Fique em 2026 (tecla 0): os painéis de vidro só existem nesta era. O teto é baixo demais para pular, então ande sobre cada painel e use o Dash para cruzar cada vão.',
    referenceExplained:
      'O "glassmorphism" imita vidro fosco: painéis translúcidos que desfocam o que está atrás. Ganhou força com os óculos de realidade mista, em que janelas flutuam no ar, ' +
      'e com o "Liquid Glass" que a Apple apresentou em 2025. Desfocar o fundo em tempo real é trabalho pesado para a placa de vídeo.',
    category: 'history',
    rarity: 'common',
    icon: 'Gem',
    maxProgress: 1,
  },
];

const DEFINITION_BY_ID = new Map<string, AchievementDefinition>(ACHIEVEMENT_DEFINITIONS.map((d) => [d.id, d]));

/** History mechanics that unlock on their first event (the scene already filters noise). */
const FIRST_EVENT_UNLOCKS: Partial<Record<EraMechanicId, AchievementId>> = {
  ballistic_long_jump: 'era_1958_ballistic',
  comment_wall_passed: 'era_1977_comment',
  gui_window_stand: 'era_1984_xerox',
  laser_bullet_time_pass: 'era_1999_bullet_time',
  flat_shift_pass: 'era_2005_2013_flat_shift',
  glass_walk_complete: 'era_2026_glass_walk',
};

/** Valued mechanics: how the "best" value is kept in eraSpecificFlags. */
const BEST_IS_MIN: ReadonlySet<EraMechanicId> = new Set<EraMechanicId>(['popup_closed']);

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

interface AchievementState {
  unlocked: boolean;
  unlockedAt?: number;
  progress: number;
}

interface PersistedProgress {
  version: 1;
  achievements: Record<string, AchievementState>;
  discoveredArtifacts: ArtifactId[];
  discoveredEras: EraId[];
  inspectedLoreIds: LoreId[];
  bestRunMs: number | null;
}

const ARTIFACT_IDS = Object.values(ArtifactId) as ArtifactId[];

function getStorage(): Storage | null {
  try {
    return typeof globalThis !== 'undefined' && globalThis.localStorage ? globalThis.localStorage : null;
  } catch {
    return null;
  }
}

function now(): number {
  try {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  } catch {
    return Date.now();
  }
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function freshAchievementStates(): Map<AchievementId, AchievementState> {
  return new Map(ACHIEVEMENT_DEFINITIONS.map((d) => [d.id, { unlocked: false, progress: 0 }]));
}

function freshRunStats(): RunStats {
  return {
    deaths: 0,
    sectorDeaths: 0,
    currentSector: 1,
    elapsedMs: 0,
    artifactsCollected: [],
    inspectedLoreIds: [],
    erasVisitedInMidAir: [],
    eraSpecificFlags: {},
  };
}

function copyStats(s: RunStats): RunStats {
  return {
    ...s,
    artifactsCollected: [...s.artifactsCollected],
    inspectedLoreIds: [...s.inspectedLoreIds],
    erasVisitedInMidAir: [...s.erasVisitedInMidAir],
    eraSpecificFlags: { ...s.eraSpecificFlags },
  };
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class AchievementSystemImpl implements IAchievementSystem {
  // Persistent
  private states = freshAchievementStates();
  private discoveredArtifacts = new Set<ArtifactId>();
  private discoveredEras = new Set<EraId>([EraId.VECTOR_1958]);
  private inspectedLore = new Set<LoreId>();
  private bestRunMs: number | null = null;

  // Per run
  private stats: RunStats = freshRunStats();
  private runCompleted = false;
  /** elapsedMs at which the current sector was entered. */
  private sectorEnteredAtMs = 0;
  /** Eras seen during the current airtime (null = grounded). */
  private airEras: Set<EraId> | null = null;

  // Timer
  private gameState: GameState = 'title';
  private playingSince: number | null = null;
  private tickHandle: ReturnType<typeof setInterval> | null = null;
  private hiddenPaused = false;

  // Plumbing
  private initialized = false;
  private unsubs: Array<() => void> = [];
  private listeners = new Set<() => void>();
  private pendingUnlocks: AchievementId[] = [];
  private statsDirty = false;
  private persistDirty = false;
  private changed = false;
  private snapshot: {
    achievements?: Achievement[];
    stats?: RunStats;
    artifacts?: ArtifactId[];
    eras?: EraId[];
    lore?: LoreId[];
  } = {};

  constructor() {
    this.load();
  }

  // --- Public API ------------------------------------------------------------

  init(): () => void {
    if (this.initialized) return () => {};
    this.initialized = true;
    this.stopTimer();
    this.stats = freshRunStats();
    this.runCompleted = false;
    this.sectorEnteredAtMs = 0;
    this.airEras = null;

    const on = <K extends keyof EventMap>(event: K, handler: (p: EventMap[K]) => void) => {
      this.unsubs.push(
        EventBus.on(event, (payload) => {
          handler(payload);
          this.commit();
        }),
      );
    };
    on('GAME_STATE_CHANGED', ({ state }) => this.onGameState(state));
    on('GAME_RESTART', () => this.onRestart());
    on('PLAYER_DIED', () => this.onPlayerDied());
    on('SECTOR_REACHED', (p) => this.onSectorReached(p));
    on('ARTIFACT_COLLECTED', (p) => this.onArtifactCollected(p));
    on('ERAS_UNLOCKED', ({ unlocked }) => this.discoverEras(unlocked));
    on('ARTIFACT_INSPECTED', ({ loreId }) => this.onLoreInspected(loreId));
    on('ERA_MECHANIC_TRIGGERED', (p) => this.onMechanic(p));
    on('ERA_CHANGED', ({ era }) => this.onEraChanged(era));
    on('PLAYER_STATS_UPDATED', ({ grounded }) => this.onGrounded(grounded));

    if (typeof document !== 'undefined') {
      const onVisibility = () => {
        this.hiddenPaused = document.visibilityState === 'hidden';
        this.syncTimer();
        this.commit();
      };
      document.addEventListener('visibilitychange', onVisibility);
      this.unsubs.push(() => document.removeEventListener('visibilitychange', onVisibility));
      this.hiddenPaused = document.visibilityState === 'hidden';
    }

    // Catch up with whatever happened before init.
    this.discoverEras(EraManager.getUnlocked());
    for (const id of EraManager.getCollectedArtifacts()) this.discoverArtifact(id);
    this.gameState = EventBus.getLast('GAME_STATE_CHANGED')?.state ?? 'title';
    this.syncTimer();
    this.statsDirty = true;
    this.markChanged();
    this.commit();

    return () => {
      for (const off of this.unsubs) off();
      this.unsubs = [];
      this.stopTimer();
      this.initialized = false;
    };
  }

  getAchievements(): Achievement[] {
    if (!this.snapshot.achievements) {
      this.snapshot.achievements = ACHIEVEMENT_DEFINITIONS.map((def) => {
        const st = this.states.get(def.id)!;
        const a: Achievement = { ...def, unlocked: st.unlocked, progress: st.progress };
        if (st.unlockedAt !== undefined) a.unlockedAt = st.unlockedAt;
        return a;
      });
    }
    return this.snapshot.achievements;
  }

  getRunStats(): RunStats {
    if (!this.snapshot.stats) this.snapshot.stats = copyStats(this.stats);
    return this.snapshot.stats;
  }

  getDiscoveredArtifacts(): ArtifactId[] {
    if (!this.snapshot.artifacts) this.snapshot.artifacts = ARTIFACT_IDS.filter((id) => this.discoveredArtifacts.has(id));
    return this.snapshot.artifacts;
  }

  getDiscoveredEras(): EraId[] {
    if (!this.snapshot.eras) this.snapshot.eras = ALL_ERAS.filter((id) => this.discoveredEras.has(id));
    return this.snapshot.eras;
  }

  getInspectedLoreIds(): LoreId[] {
    if (!this.snapshot.lore) this.snapshot.lore = ALL_LORE_IDS.filter((id) => this.inspectedLore.has(id));
    return this.snapshot.lore;
  }

  /** Best finished-run time ever (ms), or null. */
  getBestRunMs(): number | null {
    return this.bestRunMs;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  resetProgress(): void {
    try {
      getStorage()?.removeItem(PROGRESS_STORAGE_KEY);
    } catch {
      /* storage unavailable */
    }
    this.states = freshAchievementStates();
    this.discoveredArtifacts.clear();
    this.discoveredEras = new Set([EraId.VECTOR_1958]);
    this.inspectedLore.clear();
    this.bestRunMs = null;
    this.pendingUnlocks = [];
    this.markChanged();
    this.commit();
  }

  // --- Event handlers --------------------------------------------------------

  private onGameState(state: GameState): void {
    this.gameState = state;
    if (state === 'victory') {
      this.syncTimer();
      this.completeRun();
      return;
    }
    this.syncTimer();
  }

  private onRestart(): void {
    this.stopTimer();
    this.stats = freshRunStats();
    this.runCompleted = false;
    this.sectorEnteredAtMs = 0;
    this.airEras = null;
    this.statsDirty = true;
    this.markChanged();
    this.syncTimer();
  }

  private onPlayerDied(): void {
    if (this.runCompleted) return;
    this.stats.deaths += 1;
    this.stats.sectorDeaths += 1;
    this.airEras = null;
    this.statsDirty = true;
    this.markChanged();
    this.setProgress('ctrl_alt_del', this.stats.deaths);
  }

  private onSectorReached({ sectorIndex, sectorDeathsBeforeReset }: EventMap['SECTOR_REACHED']): void {
    if (this.runCompleted || !isFiniteNumber(sectorIndex) || sectorIndex <= this.stats.currentSector) return;
    this.foldElapsed();
    const playedPrevious = sectorIndex === this.stats.currentSector + 1 && this.stats.elapsedMs > this.sectorEnteredAtMs;
    if (playedPrevious && sectorDeathsBeforeReset === 0 && this.stats.sectorDeaths === 0) this.unlock('clean_sector');
    this.stats.currentSector = sectorIndex;
    this.stats.sectorDeaths = 0;
    this.sectorEnteredAtMs = this.stats.elapsedMs;
    this.statsDirty = true;
    this.markChanged();
  }

  private onArtifactCollected(p: EventMap['ARTIFACT_COLLECTED']): void {
    const id = p.artifactId ?? p.artifact;
    if (!ARTIFACT_IDS.includes(id)) return;
    if (!this.stats.artifactsCollected.includes(id)) {
      this.stats.artifactsCollected.push(id);
      this.statsDirty = true;
      this.markChanged();
    }
    this.discoverArtifact(id);
    this.discoverEras(p.unlocks ?? []);
    this.unlock('first_boot');

    const lore = p.lore ?? ARTIFACT_LORE[id];
    const era = p.currentEra ?? EraManager.getCurrentEra();
    const eraYear = ERA_CONFIGS[era]?.year;
    if (lore && isFiniteNumber(eraYear) && lore.year > eraYear) this.unlock('legacy_maintainer');
  }

  private onLoreInspected(loreId: LoreId): void {
    if (!isLoreId(loreId)) return;
    if (!this.stats.inspectedLoreIds.includes(loreId)) {
      this.stats.inspectedLoreIds.push(loreId);
      this.statsDirty = true;
      this.markChanged();
    }
    if (!this.inspectedLore.has(loreId)) {
      this.inspectedLore.add(loreId);
      this.persistDirty = true;
      this.markChanged();
    }
    this.unlock('museum_first_visit');
    this.setProgress('historian_rtfm', this.inspectedLore.size);
  }

  private onMechanic({ mechanicId, value }: EventMap['ERA_MECHANIC_TRIGGERED']): void {
    const flags = this.stats.eraSpecificFlags;
    if (isFiniteNumber(value)) {
      const prev = flags[mechanicId];
      const better = !isFiniteNumber(prev) || (BEST_IS_MIN.has(mechanicId) ? value < prev : value > prev);
      if (better) flags[mechanicId] = value;
      const countKey = `${mechanicId}_count`;
      flags[countKey] = (isFiniteNumber(flags[countKey]) ? (flags[countKey] as number) : 0) + 1;
    } else {
      const prev = flags[mechanicId];
      flags[mechanicId] = (isFiniteNumber(prev) ? prev : 0) + 1;
    }
    this.statsDirty = true;
    this.markChanged();

    const direct = FIRST_EVENT_UNLOCKS[mechanicId];
    if (direct) {
      this.unlock(direct);
      return;
    }
    if (mechanicId === 'popup_closed') {
      if (isFiniteNumber(value) && value >= 0 && value < POPUP_REFLEX_MS) this.unlock('era_1995_popup_reflex');
    } else if (mechanicId === 'midair_era_combo') {
      this.recordAirCombo();
      if (isFiniteNumber(value)) this.setProgress('time_traveler_combo', Math.floor(value));
    }
  }

  private onEraChanged(era: EraId): void {
    if (!this.airEras) return;
    this.airEras.add(era);
  }

  private onGrounded(grounded: boolean): void {
    if (grounded) {
      if (this.airEras) {
        this.recordAirCombo();
        this.airEras = null;
      }
    } else if (!this.airEras) {
      this.airEras = new Set([EraManager.getCurrentEra()]);
    }
  }

  // --- Run lifecycle ---------------------------------------------------------

  private completeRun(): void {
    if (this.runCompleted) return;
    this.runCompleted = true;
    this.stopTimer();
    this.airEras = null;

    // The final sector has no "next sector" event: evaluate it here.
    if (this.stats.sectorDeaths === 0 && this.stats.elapsedMs > this.sectorEnteredAtMs && this.stats.currentSector > 1) {
      this.unlock('clean_sector');
    }
    if (this.stats.deaths === 0) this.unlock('kernel_panic_zero');
    const time = this.stats.elapsedMs;
    if (time > 0 && time < SPEEDRUN_TARGET_MS) this.unlock('overclock_speedrun');
    if (time > 0 && (this.bestRunMs === null || time < this.bestRunMs)) {
      this.bestRunMs = time;
      this.persistDirty = true;
    }
    this.stats.eraSpecificFlags.runCompleted = true;
    this.statsDirty = true;
    this.markChanged();

    // Flush achievements + STATS_UPDATED first, then announce the finished run.
    this.commit();
    EventBus.emit('RUN_COMPLETED', { stats: copyStats(this.stats) });
  }

  private recordAirCombo(): void {
    const air = this.airEras;
    if (!air || air.size < 2 || air.size <= this.stats.erasVisitedInMidAir.length) return;
    this.stats.erasVisitedInMidAir = ALL_ERAS.filter((e) => air.has(e));
    this.statsDirty = true;
    this.markChanged();
  }

  // --- Timer -------------------------------------------------------------------

  private shouldRun(): boolean {
    return this.initialized && this.gameState === 'playing' && !this.runCompleted && !this.hiddenPaused;
  }

  private syncTimer(): void {
    if (this.shouldRun()) this.startTimer();
    else this.stopTimer();
  }

  private startTimer(): void {
    if (this.playingSince !== null) return;
    this.playingSince = now();
    this.tickHandle = setInterval(() => {
      this.foldElapsed();
      this.statsDirty = true;
      this.markChanged();
      this.commit();
    }, STATS_TICK_MS);
  }

  private stopTimer(): void {
    this.foldElapsed();
    this.playingSince = null;
    if (this.tickHandle !== null) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
  }

  /** Moves time accumulated since `playingSince` into stats.elapsedMs. */
  private foldElapsed(): void {
    if (this.playingSince === null) return;
    const t = now();
    const delta = Math.max(0, t - this.playingSince);
    this.playingSince = t;
    if (delta > 0) {
      this.stats.elapsedMs += delta;
      this.statsDirty = true;
      this.markChanged();
    }
  }

  // --- Achievements & discovery ----------------------------------------------

  private unlock(id: AchievementId): void {
    const st = this.states.get(id);
    const def = DEFINITION_BY_ID.get(id);
    if (!st || !def || st.unlocked) return;
    st.unlocked = true;
    st.unlockedAt = Date.now();
    st.progress = def.maxProgress;
    this.pendingUnlocks.push(id);
    this.persistDirty = true;
    this.markChanged();
  }

  /** Raises progress (never lowers it); unlocks when it reaches maxProgress. */
  private setProgress(id: AchievementId, value: number): void {
    const st = this.states.get(id);
    const def = DEFINITION_BY_ID.get(id);
    if (!st || !def || st.unlocked || !isFiniteNumber(value)) return;
    const next = Math.min(def.maxProgress, Math.max(st.progress, Math.floor(value)));
    if (next !== st.progress) {
      st.progress = next;
      this.persistDirty = true;
      this.markChanged();
    }
    if (next >= def.maxProgress) this.unlock(id);
  }

  private discoverArtifact(id: ArtifactId): void {
    if (!this.discoveredArtifacts.has(id)) {
      this.discoveredArtifacts.add(id);
      this.persistDirty = true;
      this.markChanged();
    }
    this.setProgress('full_museum', this.discoveredArtifacts.size);
  }

  private discoverEras(eras: readonly EraId[]): void {
    for (const era of eras) {
      if (ALL_ERAS.includes(era) && !this.discoveredEras.has(era)) {
        this.discoveredEras.add(era);
        this.persistDirty = true;
        this.markChanged();
      }
    }
  }

  // --- Commit / notify -------------------------------------------------------

  private markChanged(): void {
    this.changed = true;
    this.snapshot = {};
  }

  /** Persists, emits pending ACHIEVEMENT_UNLOCKED / STATS_UPDATED, and notifies React subscribers. */
  private commit(): void {
    if (this.persistDirty) {
      this.persistDirty = false;
      this.save();
    }
    if (this.pendingUnlocks.length > 0) {
      const ids = this.pendingUnlocks;
      this.pendingUnlocks = [];
      const all = this.getAchievements();
      const currentEra = EraManager.getCurrentEra();
      for (const id of ids) {
        const achievement = all.find((a) => a.id === id);
        if (achievement) EventBus.emit('ACHIEVEMENT_UNLOCKED', { achievement: { ...achievement }, currentEra });
      }
    }
    if (this.statsDirty) {
      this.statsDirty = false;
      EventBus.emit('STATS_UPDATED', { stats: copyStats(this.stats) });
    }
    if (this.changed) {
      this.changed = false;
      for (const listener of [...this.listeners]) {
        try {
          listener();
        } catch (err) {
          console.error('[AchievementSystem] listener error:', err);
        }
      }
    }
  }

  // --- Storage -----------------------------------------------------------------

  private save(): void {
    const data: PersistedProgress = {
      version: 1,
      achievements: Object.fromEntries(
        [...this.states].map(([id, st]) => [
          id,
          st.unlockedAt !== undefined ? { unlocked: st.unlocked, unlockedAt: st.unlockedAt, progress: st.progress } : { unlocked: st.unlocked, progress: st.progress },
        ]),
      ),
      discoveredArtifacts: ARTIFACT_IDS.filter((id) => this.discoveredArtifacts.has(id)),
      discoveredEras: ALL_ERAS.filter((id) => this.discoveredEras.has(id)),
      inspectedLoreIds: ALL_LORE_IDS.filter((id) => this.inspectedLore.has(id)),
      bestRunMs: this.bestRunMs,
    };
    try {
      getStorage()?.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* quota exceeded / storage disabled: progress stays in memory */
    }
  }

  /** Loads and validates persisted progress; unknown ids and malformed fields are ignored. */
  private load(): void {
    let raw: string | null = null;
    try {
      raw = getStorage()?.getItem(PROGRESS_STORAGE_KEY) ?? null;
    } catch {
      return;
    }
    if (!raw) return;
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    if (!data || typeof data !== 'object') return;
    const d = data as Partial<Record<keyof PersistedProgress, unknown>>;

    if (Array.isArray(d.discoveredArtifacts)) {
      for (const id of d.discoveredArtifacts) if (ARTIFACT_IDS.includes(id as ArtifactId)) this.discoveredArtifacts.add(id as ArtifactId);
    }
    if (Array.isArray(d.discoveredEras)) {
      for (const id of d.discoveredEras) if (ALL_ERAS.includes(id as EraId)) this.discoveredEras.add(id as EraId);
    }
    if (Array.isArray(d.inspectedLoreIds)) {
      for (const id of d.inspectedLoreIds) if (isLoreId(id)) this.inspectedLore.add(id);
    }
    if (isFiniteNumber(d.bestRunMs) && d.bestRunMs > 0) this.bestRunMs = d.bestRunMs;

    if (d.achievements && typeof d.achievements === 'object') {
      for (const [id, value] of Object.entries(d.achievements as Record<string, unknown>)) {
        const def = DEFINITION_BY_ID.get(id);
        const st = this.states.get(id as AchievementId);
        if (!def || !st || !value || typeof value !== 'object') continue;
        const v = value as Partial<AchievementState>;
        st.unlocked = v.unlocked === true;
        if (st.unlocked) {
          st.progress = def.maxProgress;
          if (isFiniteNumber(v.unlockedAt)) st.unlockedAt = v.unlockedAt;
        } else if (isFiniteNumber(v.progress)) {
          st.progress = Math.max(0, Math.min(def.maxProgress - 1, Math.floor(v.progress)));
        }
      }
    }

    // Collection progress always reflects the discovery sets (never auto-unlocks here:
    // unlocks are announced on the next relevant event).
    this.raiseProgressSilently('full_museum', this.discoveredArtifacts.size);
    this.raiseProgressSilently('historian_rtfm', this.inspectedLore.size);
  }

  private raiseProgressSilently(id: AchievementId, value: number): void {
    const st = this.states.get(id);
    const def = DEFINITION_BY_ID.get(id);
    if (!st || !def || st.unlocked) return;
    st.progress = Math.min(def.maxProgress, Math.max(st.progress, value));
  }
}

export type { AchievementSystemImpl };

/** Singleton. Call `AchievementSystem.init()` once (App); it returns the cleanup. */
export const AchievementSystem = new AchievementSystemImpl();
