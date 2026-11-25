import type {
  Achievement,
  ArtifactId,
  ArtifactLore,
  BurstKind,
  EraConfig,
  EraId,
  EraMechanicId,
  GameState,
  InteractiveWindowRect,
  LoreId,
  PlayerStats,
  RunStats,
  SoundEffect,
} from './types';

/**
 * Mapa de eventos React <-> Phaser.
 * Quem emite / quem escuta está documentado em cada evento.
 */
export interface EventMap {
  /** EraManager → todos. */
  ERA_CHANGED: { era: EraId; previous: EraId | null; config: EraConfig };
  /** React (DraggableOSWindow/HUD) → Phaser. Lista COMPLETA de janelas, em coordenadas de mundo. */
  WINDOWS_UPDATED: { windows: InteractiveWindowRect[] };
  /** React → Phaser/Som: usuário clicou [X] num pop-up. */
  POPUP_CLOSED: { id: string };
  /** Phaser (cena) → React HUD. */
  PLAYER_STATS_UPDATED: PlayerStats;
  /** Qualquer → Phaser (cena aplica camera.shake). intensity ~0.002..0.02, duration ms. */
  TRIGGER_SCREEN_SHAKE: { intensity: number; duration: number };

  /** Phaser (cena) → React: scroll da câmera em px de mundo, emitido quando muda. */
  CAMERA_UPDATED: { scrollX: number; scrollY: number; zoom: number };
  /** Qualquer → SoundSynthesizer. */
  PLAY_SFX: { sound: SoundEffect };
  /** Player → cena: bullet time ligado/desligado. */
  BULLET_TIME_CHANGED: { active: boolean };
  /**
   * EraManager.collectArtifact → React/AchievementSystem/Sound: artefato coletado.
   * `artifact`/`unlocks` are the original fields (kept for existing consumers);
   * `artifactId` === `artifact`, `lore` comes from HistoricalCodex, `currentEra` is the era at pickup time.
   */
  ARTIFACT_COLLECTED: { artifact: ArtifactId; unlocks: EraId[]; artifactId: ArtifactId; lore: ArtifactLore; currentEra: EraId };
  /** EraManager → React: tentou viajar para uma era ainda bloqueada. */
  ERA_LOCKED: { era: EraId; artifact: ArtifactId | null };
  /** EraManager → React: conjunto de eras desbloqueadas mudou. */
  ERAS_UNLOCKED: { unlocked: EraId[] };
  /** React (título/pausa) → Phaser ('playing' | 'paused'); cena → React ('victory'). */
  GAME_STATE_CHANGED: { state: GameState };
  /** React → cena: reiniciar a fase no próximo GAME_STATE_CHANGED 'playing'. */
  GAME_RESTART: Record<string, never>;
  /** Qualquer → cena/renderer: partículas. */
  SPAWN_BURST: { x: number; y: number; kind: BurstKind };

  // --- Rewards, history & telemetry -------------------------------------------------
  /** AchievementSystem → UI (AchievementToast) / Sound. */
  ACHIEVEMENT_UNLOCKED: { achievement: Achievement; currentEra: EraId };
  /** MuseumModal → AchievementSystem: the player opened a lore entry (artifact or era). */
  ARTIFACT_INSPECTED: { loreId: LoreId };
  /** Any (HUD button, [M] key, pause/victory menus) → MuseumModal opens on that tab; Sound plays. */
  CODEX_OPENED: { tab: 'codex' | 'achievements' };
  /** MuseumModal → any: museum closed. */
  CODEX_CLOSED: Record<string, never>;
  /** AchievementSystem → UI: run telemetry changed (single writer of RunStats). */
  STATS_UPDATED: { stats: RunStats };
  /** Scene → AchievementSystem/UI: player died. `deathTip` explains the era mechanic that killed them (PT-BR). */
  PLAYER_DIED: { era: EraId; sector: number; cause?: string; deathTip?: string };
  /** Scene → AchievementSystem: player entered a new sector (1-based) for the first time this run. */
  SECTOR_REACHED: { sectorIndex: number; sectorDeathsBeforeReset: number };
  /** Scene → AchievementSystem: an era-specific mechanic was used. See EraMechanicId for `value`. */
  ERA_MECHANIC_TRIGGERED: { mechanicId: EraMechanicId; era: EraId; value?: number };
  /** Scene/HUD → RunTelemetryHUD banner: one-line caption explaining the reference on screen (PT-BR). */
  REFERENCE_CALLOUT: { era: EraId; title: string; explanation: string };
  /** DevWarpPanel → Scene (modo de teste): teleporta o jogador e remove os artefatos das eras ≤ `era`. */
  DEV_WARP: { x: number; y: number; era: EraId };
  /** AchievementSystem → UI: run finished (emitted after GAME_STATE_CHANGED 'victory'). */
  RUN_COMPLETED: { stats: RunStats };
}

export type EventName = keyof EventMap;
export type EventHandler<K extends EventName> = (payload: EventMap[K]) => void;

class TypedEventBus {
  private handlers: { [K in EventName]?: Set<EventHandler<K>> } = {};
  private last: { [K in EventName]?: EventMap[K] } = {};

  /** Inscreve um handler. Retorna função de cancelamento (ideal para useEffect). */
  on<K extends EventName>(event: K, handler: EventHandler<K>): () => void {
    let set = this.handlers[event] as Set<EventHandler<K>> | undefined;
    if (!set) {
      set = new Set();
      (this.handlers as Record<string, Set<unknown>>)[event] = set;
    }
    set.add(handler);
    return () => this.off(event, handler);
  }

  once<K extends EventName>(event: K, handler: EventHandler<K>): () => void {
    const off = this.on(event, (payload) => {
      off();
      handler(payload);
    });
    return off;
  }

  off<K extends EventName>(event: K, handler: EventHandler<K>): void {
    (this.handlers[event] as Set<EventHandler<K>> | undefined)?.delete(handler);
  }

  emit<K extends EventName>(event: K, payload: EventMap[K]): void {
    (this.last as Record<string, unknown>)[event] = payload;
    const set = this.handlers[event] as Set<EventHandler<K>> | undefined;
    if (!set) return;
    // Cópia para permitir unsubscribe durante o dispatch.
    for (const handler of [...set]) {
      try {
        handler(payload);
      } catch (err) {
        console.error(`[EventBus] erro no handler de ${event}:`, err);
      }
    }
  }

  /** Último payload emitido (útil para quem se inscreve tarde, ex.: cena criada após o React). */
  getLast<K extends EventName>(event: K): EventMap[K] | undefined {
    return this.last[event] as EventMap[K] | undefined;
  }

  clear(): void {
    this.handlers = {};
    this.last = {};
  }
}

export const EventBus = new TypedEventBus();
export type { TypedEventBus };
