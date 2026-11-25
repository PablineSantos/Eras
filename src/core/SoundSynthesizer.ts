/**
 * SoundSynthesizer — síntese 100% Web Audio API (sem arquivos de áudio).
 *
 * Grafo: [vozes] → busFilter (lowpass global, usado no Bullet Time)
 *                → master (volume/mute) → compressor → destination.
 * O timbre de cada efeito depende do grupo da era atual.
 */
import { EventBus } from './EventBus';
import { EraManager } from './EraManager';
import { ArtifactId, EraId, type AchievementRarity, type SoundEffect } from './types';

type Group = 'retro' | 'chip' | 'os' | 'synth';

function groupOf(era: EraId): Group {
  if (era <= EraId.MAC_1984) return 'retro';
  if (era <= EraId.SNES_1991) return 'chip';
  if (era <= EraId.FLASH_2005) return 'os';
  return 'synth';
}

/** MIDI → Hz. */
const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

interface FilterOpts {
  type: BiquadFilterType;
  freq: number;
  /** Cutoff final (rampa exponencial ao longo da duração). */
  freqEnd?: number;
  /** Pico intermediário do cutoff (envelope ataque/decay). */
  freqPeak?: number;
  q?: number;
}

interface ToneOpts {
  type?: OscillatorType;
  wave?: PeriodicWave;
  freq: number;
  freqEnd?: number;
  /** 'exp' (padrão) ou 'lin' para o glide. */
  glide?: 'exp' | 'lin';
  start: number;
  dur: number;
  gain?: number;
  attack?: number;
  /** Envelope seco (liga/desliga), estilo PC Speaker. */
  hard?: boolean;
  detune?: number;
  vibrato?: { rate: number; depth: number };
  filter?: FilterOpts;
}

interface NoiseOpts {
  start: number;
  dur: number;
  gain?: number;
  /** Fade-in time in seconds (default 4 ms). */
  attack?: number;
  filter: FilterOpts;
}

/** Sustained voice with a full ADSR envelope (brass, pads, chimes). */
interface PadOpts {
  type?: OscillatorType;
  wave?: PeriodicWave;
  freq: number;
  start: number;
  /** Total length, release included. */
  dur: number;
  gain: number;
  attack?: number;
  decay?: number;
  /** Sustain level as a fraction of `gain`. */
  sustain?: number;
  release?: number;
  detune?: number;
  filter?: FilterOpts;
}

/** Rarity → priority (rare and epic share the fanfare). */
const RARITY_RANK: Record<AchievementRarity, number> = { common: 0, rare: 1, epic: 2 };
/** An achievement arriving this soon after an artifact boot sound waits for it (seconds). */
const BOOT_OVERLAP_WINDOW = 1.2;
/** Only one achievement sound per window (ms). */
const ACHIEVEMENT_WINDOW_MS = 1500;
/** Gathers achievements unlocked in the same burst before choosing which one to play (ms). */
const ACHIEVEMENT_GATHER_MS = 80;
/** Mechanical intro length before the boot chime starts (seconds). */
const BOOT_MECH_LEN = 0.45;
/** Time after the chime starts when it has settled enough to layer another sound (seconds). */
const BOOT_CHIME_SETTLE = 0.85;

class SoundSynthesizerImpl {
  private ctx: AudioContext | null = null;
  private busFilter: BiquadFilterNode | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private pulseWaves = new Map<number, PeriodicWave>();
  private muted = false;
  private volume = 0.6;
  private unsubs: Array<() => void> = [];
  private initialized = false;
  private ambientTimer: ReturnType<typeof setInterval> | null = null;
  private ambientStep = 0;
  /** AudioContext time when the last artifact boot sound started (null = never). */
  private bootStartAt: number | null = null;
  /** AudioContext time when that boot sound is settled enough to layer an achievement sound. */
  private bootSettleAt = 0;
  /** Achievement burst being gathered (highest rarity wins). */
  private pendingAchievement: { rank: number; era: EraId } | null = null;
  private pendingAchievementTimer: ReturnType<typeof setTimeout> | null = null;
  /** Wall-clock ms when the last achievement sound played (or is scheduled to). */
  private lastAchievementAt = -Infinity;
  private lastAchievementRank = -1;

  // ------------------------------------------------------------------ API

  /** Inscreve no EventBus (idempotente). */
  init(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.unsubs.push(
      EventBus.on('PLAY_SFX', ({ sound }) => this.play(sound)),
      EventBus.on('ERA_CHANGED', ({ previous }) => {
        if (previous !== null) this.play('eraChange');
      }),
      EventBus.on('BULLET_TIME_CHANGED', ({ active }) => {
        this.setBusCutoff(active ? 1600 : 20000, active ? 0.25 : 0.12);
        this.play(active ? 'bulletTimeOn' : 'bulletTimeOff');
      }),
      EventBus.on('POPUP_CLOSED', () => this.play('click')),
      // The only pickup sound (the scene no longer emits PLAY_SFX 'artifact' on pickup).
      EventBus.on('ARTIFACT_COLLECTED', ({ artifactId, artifact, currentEra }) =>
        this.playArtifactBootSound(artifactId ?? artifact, currentEra ?? EraManager.getCurrentEra()),
      ),
      EventBus.on('ACHIEVEMENT_UNLOCKED', ({ achievement, currentEra }) =>
        this.queueAchievementSound(achievement.rarity, currentEra ?? EraManager.getCurrentEra()),
      ),
      EventBus.on('CODEX_OPENED', () => this.playCodexOpenSound()),
    );
  }

  /** Cancela inscrições e para a música ambiente (não fecha o AudioContext). */
  dispose(): void {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.initialized = false;
    this.stopAmbient();
    if (this.pendingAchievementTimer !== null) clearTimeout(this.pendingAchievementTimer);
    this.pendingAchievementTimer = null;
    this.pendingAchievement = null;
  }

  /** Cria/retoma o AudioContext. Chamar no primeiro gesto do usuário. */
  async resume(): Promise<void> {
    try {
      if (!this.ctx) {
        const Ctor =
          typeof window !== 'undefined'
            ? window.AudioContext ??
              (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
            : undefined;
        if (!Ctor) return;
        const ctx = new Ctor();
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.knee.value = 12;
        comp.ratio.value = 4;
        comp.attack.value = 0.003;
        comp.release.value = 0.2;
        const master = ctx.createGain();
        master.gain.value = this.muted ? 0 : this.volume;
        const bus = ctx.createBiquadFilter();
        bus.type = 'lowpass';
        bus.frequency.value = 20000;
        bus.Q.value = 0.7;
        bus.connect(master);
        master.connect(comp);
        comp.connect(ctx.destination);
        this.ctx = ctx;
        this.master = master;
        this.busFilter = bus;
        this.noiseBuffer = this.makeNoise(ctx);
      }
      if (this.ctx.state === 'suspended') await this.ctx.resume();
    } catch {
      /* áudio indisponível: segue silencioso */
    }
  }

  play(sound: SoundEffect): void {
    const ctx = this.ready();
    if (!ctx) return;
    try {
      const era = EraManager.getCurrentEra();
      const t = ctx.currentTime + 0.005;
      switch (groupOf(era)) {
        case 'retro':
          this.playRetro(sound, t, era === EraId.VECTOR_1958 ? 'sine' : 'square');
          break;
        case 'chip':
          this.playChip(sound, t);
          break;
        case 'os':
          this.playOS(sound, t);
          break;
        case 'synth':
          this.playSynth(sound, t);
          break;
      }
    } catch {
      /* nunca propaga erros de áudio */
    }
  }

  /**
   * Artifact pickup: a short mechanical intro specific to the artifact (relay clicks,
   * drive seek, mouse-ball rattle, cartridge clack, CD spin-up, GPU fan) followed by a
   * warm startup-style chime (F4 → C5 → F5 → A5) with a long tail.
   */
  playArtifactBootSound(artifactId: ArtifactId, era: EraId): void {
    this.withAudio((t) => {
      this.bootMechanics(artifactId, t);
      const chimeAt = t + BOOT_MECH_LEN;
      this.bootChime(chimeAt, era);
      this.bootStartAt = t;
      this.bootSettleAt = chimeAt + BOOT_CHIME_SETTLE;
    });
  }

  /** Common achievement: short jingle whose timbre follows the era. */
  playAchievementCommonSound(era: EraId): void {
    this.withAudio((t) => this.achievementCommonAt(era, t));
  }

  /** Rare/epic achievement: brass-like C5-E5-G5-C6 fanfare over a C4 bass, plus sparkle (~1.8 s). */
  playAchievementEpicFanfare(): void {
    this.withAudio((t) => this.epicFanfareAt(t));
  }

  /** Museum/codex opened: soft paper rustle + gentle low tone. */
  playCodexOpenSound(): void {
    this.withAudio((t) => this.codexOpenAt(t));
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyMaster();
  }

  /** true quando o AudioContext já foi liberado pelo navegador. */
  isAudioRunning(): boolean {
    return this.ctx?.state === 'running';
  }

  isMuted(): boolean {
    return this.muted;
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
    this.applyMaster();
  }

  getVolume(): number {
    return this.volume;
  }

  /** Música ambiente curta em loop, por era (desligada por padrão). */
  startAmbient(): void {
    if (this.ambientTimer !== null) return;
    this.ambientStep = 0;
    this.ambientTimer = setInterval(() => this.ambientTick(), 180);
  }

  stopAmbient(): void {
    if (this.ambientTimer !== null) clearInterval(this.ambientTimer);
    this.ambientTimer = null;
  }

  isAmbientPlaying(): boolean {
    return this.ambientTimer !== null;
  }

  // ------------------------------------------------------------ internos

  /** Contexto pronto para tocar, ou null (no-op silencioso). */
  private ready(): AudioContext | null {
    const ctx = this.ctx;
    if (!ctx || !this.busFilter || ctx.state !== 'running' || this.muted) return null;
    return ctx;
  }

  private applyMaster(): void {
    if (!this.ctx || !this.master) return;
    const target = this.muted ? 0 : this.volume;
    this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.02);
  }

  private setBusCutoff(freq: number, tc: number): void {
    if (!this.ctx || !this.busFilter) return;
    try {
      const f = this.busFilter.frequency;
      f.cancelScheduledValues(this.ctx.currentTime);
      f.setTargetAtTime(freq, this.ctx.currentTime, tc);
    } catch {
      /* ignore */
    }
  }

  private makeNoise(ctx: AudioContext): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * 1);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** Onda de pulso com duty cycle (12.5%, 25%, 50%) — timbre NES. */
  private pulse(duty: number): PeriodicWave | undefined {
    const ctx = this.ctx;
    if (!ctx) return undefined;
    const cached = this.pulseWaves.get(duty);
    if (cached) return cached;
    const n = 32;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let k = 1; k < n; k++) {
      real[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
    }
    const wave = ctx.createPeriodicWave(real, imag);
    this.pulseWaves.set(duty, wave);
    return wave;
  }

  private makeFilter(ctx: AudioContext, f: FilterOpts, start: number, dur: number): BiquadFilterNode {
    const filter = ctx.createBiquadFilter();
    filter.type = f.type;
    filter.Q.value = f.q ?? 1;
    const p = filter.frequency;
    p.setValueAtTime(f.freq, start);
    if (f.freqPeak !== undefined) {
      p.exponentialRampToValueAtTime(Math.max(20, f.freqPeak), start + Math.min(0.03, dur * 0.2));
    }
    if (f.freqEnd !== undefined) {
      p.exponentialRampToValueAtTime(Math.max(20, f.freqEnd), start + dur);
    }
    return filter;
  }

  /** Oscilador com envelope; sempre agendado para parar. */
  private tone(o: ToneOpts): void {
    const ctx = this.ctx;
    const out = this.busFilter;
    if (!ctx || !out) return;
    const { start, dur } = o;
    const peak = o.gain ?? 0.2;
    const osc = ctx.createOscillator();
    if (o.wave) osc.setPeriodicWave(o.wave);
    else osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.freq, start);
    if (o.freqEnd !== undefined) {
      if (o.glide === 'lin') osc.frequency.linearRampToValueAtTime(o.freqEnd, start + dur);
      else osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.freqEnd), start + dur);
    }
    if (o.detune) osc.detune.value = o.detune;

    const nodes: AudioNode[] = [osc];
    let lfo: OscillatorNode | null = null;
    if (o.vibrato) {
      lfo = ctx.createOscillator();
      lfo.frequency.value = o.vibrato.rate;
      const depth = ctx.createGain();
      depth.gain.value = o.vibrato.depth;
      lfo.connect(depth);
      depth.connect(osc.frequency);
      nodes.push(lfo, depth);
    }

    const g = ctx.createGain();
    if (o.hard) {
      g.gain.setValueAtTime(peak, start);
      g.gain.setValueAtTime(0, start + dur);
    } else {
      const atk = o.attack ?? 0.005;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.linearRampToValueAtTime(peak, start + atk);
      g.gain.exponentialRampToValueAtTime(0.0001, start + Math.max(atk + 0.01, dur));
    }

    let head: AudioNode = osc;
    if (o.filter) {
      const filter = this.makeFilter(ctx, o.filter, start, dur);
      head.connect(filter);
      head = filter;
      nodes.push(filter);
    }
    head.connect(g);
    g.connect(out);
    nodes.push(g);

    const stopAt = start + dur + 0.05;
    osc.start(start);
    osc.stop(stopAt);
    if (lfo) {
      lfo.start(start);
      lfo.stop(stopAt);
    }
    osc.onended = () => nodes.forEach((n) => n.disconnect());
  }

  private noise(o: NoiseOpts): void {
    const ctx = this.ctx;
    const out = this.busFilter;
    if (!ctx || !out || !this.noiseBuffer) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = this.makeFilter(ctx, o.filter, o.start, o.dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, o.start);
    g.gain.linearRampToValueAtTime(o.gain ?? 0.2, o.start + Math.min(o.attack ?? 0.004, o.dur * 0.8));
    g.gain.exponentialRampToValueAtTime(0.0001, o.start + o.dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(out);
    src.start(o.start, Math.random() * 0.5);
    src.stop(o.start + o.dur + 0.05);
    src.onended = () => {
      src.disconnect();
      filter.disconnect();
      g.disconnect();
    };
  }

  /** Sequência de notas (arpejo). */
  private arp(
    notes: number[],
    start: number,
    step: number,
    base: Omit<ToneOpts, 'freq' | 'start' | 'dur'> & { dur?: number },
  ): void {
    notes.forEach((m, i) => {
      this.tone({ ...base, freq: mtof(m), start: start + i * step, dur: base.dur ?? step * 0.95 });
    });
  }

  /** Voz synthwave: 3 sawtooth detunadas + lowpass com envelope de cutoff. */
  private saw(
    freq: number,
    start: number,
    dur: number,
    gain: number,
    filter: FilterOpts,
    freqEnd?: number,
  ): void {
    for (const det of [-12, 0, 12]) {
      this.tone({ type: 'sawtooth', freq, freqEnd, start, dur, gain: gain / 3, detune: det, attack: 0.008, filter });
    }
  }

  // ----------------------------------------------- Eras 1-3: bipes / PC Speaker

  private playRetro(s: SoundEffect, t: number, w: OscillatorType): void {
    const beep = (f: number, at: number, d: number, g = 0.12): void =>
      this.tone({ type: w, freq: f, start: at, dur: d, gain: g, hard: true });
    switch (s) {
      case 'jump':
        beep(520, t, 0.05);
        beep(780, t + 0.05, 0.05);
        break;
      case 'doubleJump':
        beep(780, t, 0.04);
        beep(1040, t + 0.04, 0.06);
        break;
      case 'wallJump':
        beep(600, t, 0.035);
        beep(900, t + 0.035, 0.05);
        break;
      case 'land':
        beep(140, t, 0.035, 0.08);
        break;
      case 'coin':
        beep(988, t, 0.05);
        beep(1319, t + 0.05, 0.12);
        break;
      case 'artifact':
        [72, 76, 79, 84, 88].forEach((m, i) => beep(mtof(m), t + i * 0.07, 0.065));
        break;
      case 'dash':
        this.tone({ type: w, freq: 1200, freqEnd: 200, glide: 'lin', start: t, dur: 0.12, gain: 0.1, hard: true });
        break;
      case 'impact':
        beep(90, t, 0.08, 0.16);
        beep(60, t + 0.08, 0.1, 0.16);
        break;
      case 'eraChange':
        this.tone({ type: w, freq: 200, freqEnd: 1600, glide: 'lin', start: t, dur: 0.22, gain: 0.1, hard: true });
        beep(1600, t + 0.24, 0.06);
        break;
      case 'error':
        beep(220, t, 0.18, 0.14);
        beep(220, t + 0.24, 0.18, 0.14);
        break;
      case 'click':
        beep(2000, t, 0.012, 0.08);
        break;
      case 'bulletTimeOn':
        this.tone({ type: w, freq: 800, freqEnd: 200, glide: 'lin', start: t, dur: 0.3, gain: 0.1, hard: true });
        break;
      case 'bulletTimeOff':
        this.tone({ type: w, freq: 200, freqEnd: 800, glide: 'lin', start: t, dur: 0.2, gain: 0.1, hard: true });
        break;
      case 'death':
        [440, 330, 220, 110].forEach((f, i) => beep(f, t + i * 0.1, 0.09, 0.13));
        break;
      case 'bounce':
        this.tone({ type: w, freq: 300, freqEnd: 900, glide: 'lin', start: t, dur: 0.1, gain: 0.1, hard: true });
        break;
      case 'victory':
        [60, 64, 67, 72, 67, 72, 76, 84].forEach((m, i) => beep(mtof(m), t + i * 0.11, 0.1));
        break;
    }
  }

  // ----------------------------------------------- Eras 4-5: chiptune 8/16-bit

  private playChip(s: SoundEffect, t: number): void {
    const p25 = this.pulse(0.25);
    const p12 = this.pulse(0.125);
    const p50 = this.pulse(0.5);
    const lead = { wave: p25, type: 'square' as OscillatorType, gain: 0.1, attack: 0.002 };
    const bass = (m: number, at: number, d: number, g = 0.16): void =>
      this.tone({ type: 'triangle', freq: mtof(m), start: at, dur: d, gain: g, attack: 0.002 });
    switch (s) {
      case 'jump':
        this.arp([67, 71, 74, 79], t, 0.028, lead);
        this.tone({ ...lead, freq: 300, freqEnd: 700, start: t, dur: 0.12, gain: 0.05 });
        break;
      case 'doubleJump':
        this.arp([74, 79, 83, 86], t, 0.025, { ...lead, wave: p12 });
        break;
      case 'wallJump':
        this.arp([62, 69, 74], t, 0.03, lead);
        bass(50, t, 0.06);
        break;
      case 'land':
        this.tone({ type: 'triangle', freq: 110, freqEnd: 60, start: t, dur: 0.06, gain: 0.16 });
        this.noise({ start: t, dur: 0.04, gain: 0.06, filter: { type: 'lowpass', freq: 1500 } });
        break;
      case 'coin':
        this.tone({ ...lead, wave: p50, freq: mtof(83), start: t, dur: 0.06 });
        this.tone({ ...lead, wave: p50, freq: mtof(88), start: t + 0.06, dur: 0.28 });
        break;
      case 'artifact':
        this.arp([60, 64, 67, 72, 76, 79, 84, 88], t, 0.05, lead);
        bass(48, t, 0.4);
        bass(60, t + 0.4, 0.3);
        break;
      case 'dash':
        this.noise({ start: t, dur: 0.15, gain: 0.12, filter: { type: 'highpass', freq: 2500, freqEnd: 600 } });
        this.tone({ ...lead, freq: 900, freqEnd: 150, start: t, dur: 0.12, gain: 0.06 });
        break;
      case 'impact':
        this.noise({ start: t, dur: 0.2, gain: 0.18, filter: { type: 'lowpass', freq: 1800, freqEnd: 200 } });
        this.tone({ type: 'triangle', freq: 80, freqEnd: 40, start: t, dur: 0.2, gain: 0.2 });
        break;
      case 'eraChange':
        this.arp([60, 67, 72, 76, 79, 84, 88, 91], t, 0.035, { ...lead, wave: p12 });
        bass(36, t, 0.3);
        break;
      case 'error':
        this.tone({ ...lead, freq: mtof(58), start: t, dur: 0.12, gain: 0.12 });
        this.tone({ ...lead, freq: mtof(52), start: t + 0.13, dur: 0.2, gain: 0.12 });
        break;
      case 'click':
        this.tone({ ...lead, wave: p12, freq: 1500, start: t, dur: 0.02, gain: 0.07 });
        break;
      case 'bulletTimeOn':
        this.arp([84, 79, 76, 72, 67, 64, 60, 55], t, 0.05, lead);
        break;
      case 'bulletTimeOff':
        this.arp([55, 60, 64, 67, 72, 76, 79, 84], t, 0.03, lead);
        break;
      case 'death':
        this.arp([76, 75, 74, 73, 72, 71, 70, 69, 64, 57], t, 0.07, { ...lead, wave: p50 });
        bass(40, t + 0.5, 0.3);
        break;
      case 'bounce':
        this.tone({ ...lead, freq: 200, freqEnd: 800, start: t, dur: 0.15 });
        break;
      case 'victory': {
        const melody = [72, 72, 72, 72, 68, 70, 72, 70, 72];
        const durs = [0.1, 0.1, 0.1, 0.3, 0.3, 0.3, 0.15, 0.1, 0.6];
        let at = t;
        melody.forEach((m, i) => {
          this.tone({ ...lead, freq: mtof(m), start: at, dur: durs[i] * 0.95 });
          bass(m - 24, at, durs[i] * 0.9, 0.12);
          at += durs[i];
        });
        break;
      }
    }
  }

  // ----------------------------------------------- Eras 6-8: SO / Bullet Time / boing

  private playOS(s: SoundEffect, t: number): void {
    const boing = (f0: number, f1: number, d: number, g = 0.18): void =>
      this.tone({ type: 'triangle', freq: f0, freqEnd: f1, start: t, dur: d, gain: g, vibrato: { rate: 18, depth: f1 * 0.06 } });
    const ding = (freqs: number[], at: number, d: number, g: number): void =>
      freqs.forEach((f) => this.tone({ type: 'sine', freq: f, start: at, dur: d, gain: g, attack: 0.003 }));
    switch (s) {
      case 'jump':
        boing(160, 640, 0.2);
        break;
      case 'doubleJump':
        boing(260, 980, 0.18, 0.15);
        break;
      case 'wallJump':
        this.tone({ type: 'triangle', freq: 300, freqEnd: 700, start: t, dur: 0.12, gain: 0.16 });
        break;
      case 'land':
        this.tone({ type: 'sine', freq: 120, freqEnd: 60, start: t, dur: 0.1, gain: 0.25 });
        this.noise({ start: t, dur: 0.06, gain: 0.05, filter: { type: 'lowpass', freq: 900 } });
        break;
      case 'coin':
        ding([1318.5, 1975.5], t, 0.45, 0.09);
        break;
      case 'artifact':
        [64, 71, 76, 80, 83].forEach((m, i) =>
          this.tone({ type: 'triangle', freq: mtof(m), start: t + i * 0.11, dur: 0.9, gain: 0.08, attack: 0.02 }),
        );
        break;
      case 'dash':
        this.noise({ start: t, dur: 0.22, gain: 0.16, filter: { type: 'bandpass', freq: 3000, freqEnd: 500, q: 2 } });
        this.tone({ type: 'triangle', freq: 400, freqEnd: 120, start: t, dur: 0.18, gain: 0.08 });
        break;
      case 'impact':
        this.tone({ type: 'sine', freq: 90, freqEnd: 40, start: t, dur: 0.25, gain: 0.35 });
        this.noise({ start: t, dur: 0.15, gain: 0.12, filter: { type: 'lowpass', freq: 1200 } });
        break;
      case 'eraChange':
        // "Tada!" — acorde maior brilhante.
        [60, 64, 67, 72].forEach((m) => {
          this.tone({ type: 'triangle', freq: mtof(m), start: t, dur: 0.7, gain: 0.07, attack: 0.01 });
          this.tone({ type: 'sine', freq: mtof(m + 12), start: t + 0.04, dur: 0.6, gain: 0.04 });
        });
        break;
      case 'error':
        // "Ding" clássico de erro de SO: acorde dissonante (2ª menor + trítono).
        ding([880, 932.3, 1244.5], t, 0.6, 0.08);
        this.tone({ type: 'triangle', freq: 440, start: t, dur: 0.5, gain: 0.08 });
        break;
      case 'click':
        this.noise({ start: t, dur: 0.012, gain: 0.12, filter: { type: 'highpass', freq: 3000 } });
        this.tone({ type: 'sine', freq: 1800, start: t, dur: 0.02, gain: 0.05 });
        break;
      case 'bulletTimeOn':
        // Desaceleração: pitch descendo + lowpass fechando.
        this.tone({
          type: 'sawtooth', freq: 600, freqEnd: 70, start: t, dur: 1.0, gain: 0.14,
          filter: { type: 'lowpass', freq: 5000, freqEnd: 250, q: 4 },
        });
        this.noise({ start: t, dur: 0.9, gain: 0.08, filter: { type: 'lowpass', freq: 4000, freqEnd: 200 } });
        break;
      case 'bulletTimeOff':
        this.tone({
          type: 'sawtooth', freq: 80, freqEnd: 600, start: t, dur: 0.6, gain: 0.12,
          filter: { type: 'lowpass', freq: 250, freqEnd: 6000, q: 4 },
        });
        this.noise({ start: t, dur: 0.5, gain: 0.06, filter: { type: 'lowpass', freq: 200, freqEnd: 5000 } });
        break;
      case 'death':
        this.tone({ type: 'sine', freq: 600, freqEnd: 80, start: t, dur: 0.8, gain: 0.2 });
        ding([622.3, 659.3], t + 0.1, 0.5, 0.06);
        break;
      case 'bounce':
        boing(120, 720, 0.32, 0.22);
        break;
      case 'victory':
        [72, 76, 79, 84].forEach((m, i) =>
          this.tone({ type: 'triangle', freq: mtof(m), start: t + i * 0.12, dur: 0.3, gain: 0.1 }),
        );
        [60, 64, 67, 72, 76].forEach((m) =>
          this.tone({ type: 'sine', freq: mtof(m), start: t + 0.5, dur: 1.2, gain: 0.06, attack: 0.02 }),
        );
        break;
    }
  }

  // ----------------------------------------------- Eras 9-10: synthwave / neon

  private playSynth(s: SoundEffect, t: number): void {
    const sub = (f0: number, f1: number, at: number, d: number, g: number): void =>
      this.tone({ type: 'sine', freq: f0, freqEnd: f1, start: at, dur: d, gain: g });
    switch (s) {
      case 'jump':
        this.saw(330, t, 0.15, 0.18, { type: 'lowpass', freq: 600, freqPeak: 5000, freqEnd: 800, q: 6 }, 660);
        break;
      case 'doubleJump':
        this.saw(440, t, 0.15, 0.16, { type: 'lowpass', freq: 800, freqPeak: 7000, freqEnd: 1200, q: 6 }, 990);
        break;
      case 'wallJump':
        this.saw(392, t, 0.12, 0.16, { type: 'lowpass', freq: 700, freqPeak: 5000, freqEnd: 900, q: 5 }, 784);
        break;
      case 'land':
        sub(80, 45, t, 0.12, 0.3);
        this.noise({ start: t, dur: 0.06, gain: 0.05, filter: { type: 'lowpass', freq: 700 } });
        break;
      case 'coin':
        [84, 91].forEach((m, i) =>
          this.saw(mtof(m), t + i * 0.06, 0.12 + i * 0.12, 0.12, { type: 'lowpass', freq: 1500, freqPeak: 9000, freqEnd: 2000, q: 3 }),
        );
        break;
      case 'artifact':
        [60, 67, 72, 76].forEach((m) =>
          this.saw(mtof(m), t, 1.1, 0.1, { type: 'lowpass', freq: 300, freqEnd: 6000, q: 4 }),
        );
        sub(65.4, 65.4, t, 1.0, 0.2);
        break;
      case 'dash':
        // Dash encorpado: ruído filtrado + sub + saw.
        this.noise({ start: t, dur: 0.25, gain: 0.25, filter: { type: 'bandpass', freq: 3000, freqEnd: 600, q: 1.5 } });
        sub(70, 40, t, 0.25, 0.35);
        this.saw(220, t, 0.2, 0.1, { type: 'lowpass', freq: 2000, freqEnd: 300, q: 3 }, 110);
        break;
      case 'impact':
        // Grave: sine 55Hz com queda de pitch + ruído.
        sub(58, 28, t, 0.45, 0.6);
        this.noise({ start: t, dur: 0.2, gain: 0.18, filter: { type: 'lowpass', freq: 1200, freqEnd: 150 } });
        break;
      case 'eraChange':
        this.saw(110, t, 0.4, 0.12, { type: 'lowpass', freq: 200, freqEnd: 8000, q: 8 }, 880);
        [57, 64, 69, 72, 76, 81].forEach((m, i) =>
          this.saw(mtof(m), t + 0.1 + i * 0.05, 0.18, 0.08, { type: 'lowpass', freq: 800, freqPeak: 6000, freqEnd: 1000, q: 4 }),
        );
        break;
      case 'error':
        [70, 71].forEach((m) => this.saw(mtof(m), t, 0.3, 0.12, { type: 'lowpass', freq: 1200, freqEnd: 400, q: 3 }));
        break;
      case 'click':
        this.tone({ type: 'sine', freq: 2400, start: t, dur: 0.015, gain: 0.06 });
        this.noise({ start: t, dur: 0.01, gain: 0.08, filter: { type: 'highpass', freq: 5000 } });
        break;
      case 'bulletTimeOn':
        this.saw(400, t, 0.8, 0.16, { type: 'lowpass', freq: 3000, freqEnd: 200, q: 6 }, 60);
        sub(80, 40, t, 0.8, 0.2);
        break;
      case 'bulletTimeOff':
        this.saw(60, t, 0.5, 0.14, { type: 'lowpass', freq: 200, freqEnd: 4000, q: 6 }, 400);
        break;
      case 'death':
        [69, 72, 76].forEach((m) =>
          this.saw(mtof(m), t, 1.0, 0.08, { type: 'lowpass', freq: 4000, freqEnd: 150, q: 5 }, mtof(m - 36)),
        );
        sub(60, 30, t, 0.5, 0.4);
        break;
      case 'bounce':
        this.saw(150, t, 0.22, 0.16, { type: 'lowpass', freq: 400, freqEnd: 6000, q: 8 }, 900);
        break;
      case 'victory':
        [60, 64, 67, 71, 72, 76, 79, 83, 84].forEach((m, i) =>
          this.saw(mtof(m), t + i * 0.09, 0.16, 0.1, { type: 'lowpass', freq: 900, freqPeak: 7000, freqEnd: 1200, q: 4 }),
        );
        [48, 55, 60, 64].forEach((m) =>
          this.saw(mtof(m), t + 0.8, 1.4, 0.07, { type: 'lowpass', freq: 400, freqEnd: 5000, q: 2 }),
        );
        break;
    }
  }

  // ----------------------------------------------- Artifacts, achievements & codex

  /**
   * Runs `fn` with a start time once the context is running. Creates/resumes the
   * AudioContext if it is missing or suspended (same path as `resume()`).
   */
  private withAudio(fn: (t: number) => void, delay = 0): void {
    if (this.muted) return;
    const attempt = (): void => {
      const ctx = this.ready();
      if (!ctx) return;
      try {
        fn(ctx.currentTime + 0.01 + delay);
      } catch {
        /* never propagate audio errors */
      }
    };
    if (this.ctx && this.ctx.state === 'running') {
      attempt();
      return;
    }
    void this.resume().then(attempt);
  }

  /**
   * Gathers achievements unlocked in the same burst and plays only the highest rarity.
   * A sound of the same (or lower) class within ACHIEVEMENT_WINDOW_MS of the last one is
   * dropped; if an artifact boot sound just started, the achievement waits for it to settle.
   */
  private queueAchievementSound(rarity: AchievementRarity, era: EraId): void {
    const rank = RARITY_RANK[rarity] ?? 0;
    if (this.pendingAchievement) {
      if (rank > this.pendingAchievement.rank) this.pendingAchievement = { rank, era };
      return;
    }
    const isFanfare = (r: number): boolean => r >= RARITY_RANK.rare;
    const inWindow = Date.now() < this.lastAchievementAt + ACHIEVEMENT_WINDOW_MS;
    if (inWindow && (isFanfare(this.lastAchievementRank) || !isFanfare(rank))) return;
    this.pendingAchievement = { rank, era };
    this.pendingAchievementTimer = setTimeout(() => this.flushAchievementSound(), ACHIEVEMENT_GATHER_MS);
  }

  private flushAchievementSound(): void {
    const pending = this.pendingAchievement;
    this.pendingAchievement = null;
    this.pendingAchievementTimer = null;
    if (!pending) return;
    this.withAudio((now) => {
      let t = now;
      // Pickup + first_boot/full_museum unlock together: let the boot chime breathe first.
      if (this.bootStartAt !== null && now - this.bootStartAt < BOOT_OVERLAP_WINDOW && this.bootSettleAt > now) {
        t = this.bootSettleAt;
      }
      this.lastAchievementAt = Date.now() + (t - now) * 1000;
      this.lastAchievementRank = pending.rank;
      if (pending.rank >= RARITY_RANK.rare) this.epicFanfareAt(t);
      else this.achievementCommonAt(pending.era, t);
    });
  }

  /** Oscillator with attack/decay/sustain/release; always scheduled to stop and disconnect. */
  private pad(o: PadOpts): void {
    const ctx = this.ctx;
    const out = this.busFilter;
    if (!ctx || !out) return;
    const { start } = o;
    const atk = Math.max(0.002, o.attack ?? 0.01);
    const dec = Math.max(0.01, o.decay ?? 0.15);
    const peak = Math.max(0.001, o.gain);
    const sus = Math.max(0.001, peak * (o.sustain ?? 0.6));
    const decayEnd = start + atk + dec;
    const end = Math.max(start + o.dur, decayEnd + 0.03);
    const rel = Math.min(o.release ?? 0.3, end - decayEnd - 0.01);
    const releaseAt = Math.max(decayEnd, end - rel);

    const osc = ctx.createOscillator();
    if (o.wave) osc.setPeriodicWave(o.wave);
    else osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.freq, start);
    if (o.detune) osc.detune.value = o.detune;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, start);
    g.gain.linearRampToValueAtTime(peak, start + atk);
    g.gain.exponentialRampToValueAtTime(sus, decayEnd);
    g.gain.setValueAtTime(sus, releaseAt);
    g.gain.exponentialRampToValueAtTime(0.001, end);

    const nodes: AudioNode[] = [osc, g];
    let head: AudioNode = osc;
    if (o.filter) {
      const filter = this.makeFilter(ctx, o.filter, start, end - start);
      head.connect(filter);
      head = filter;
      nodes.push(filter);
    }
    head.connect(g);
    g.connect(out);
    osc.start(start);
    osc.stop(end + 0.03);
    osc.onended = () => nodes.forEach((n) => n.disconnect());
  }

  /** Short band-passed noise click (relay, drive head, plastic). */
  private tick(at: number, freq: number, gain: number, q = 4, dur = 0.016): void {
    this.noise({ start: at, dur, gain, filter: { type: 'bandpass', freq, q } });
  }

  /** Mechanical intro of the boot sound, specific to each artifact (~0.42 s). */
  private bootMechanics(id: ArtifactId, t: number): void {
    const jitter = (): number => Math.random() * 0.006;
    switch (id) {
      case ArtifactId.VALVE:
        // Mains hum warming up + relay clicks + a little filament crackle.
        this.pad({ type: 'sawtooth', freq: 50, start: t, dur: 0.46, gain: 0.05, attack: 0.12, decay: 0.1, sustain: 0.8, release: 0.14, filter: { type: 'lowpass', freq: 320, q: 1 } });
        this.pad({ type: 'sine', freq: 100, start: t, dur: 0.44, gain: 0.03, attack: 0.1, decay: 0.1, sustain: 0.8, release: 0.14 });
        this.tick(t + 0.02, 3000, 0.08, 2);
        this.tick(t + 0.31, 2600, 0.07, 2);
        for (let i = 0; i < 3; i++) this.tick(t + 0.08 + Math.random() * 0.25, 5000 + Math.random() * 2000, 0.025, 1, 0.008);
        break;
      case ArtifactId.FLOPPY:
        // Spindle motor + stepping head seek + settle thunk.
        this.pad({ type: 'sawtooth', freq: 55, start: t, dur: 0.42, gain: 0.03, attack: 0.04, decay: 0.1, sustain: 0.8, release: 0.1, filter: { type: 'lowpass', freq: 260, q: 1 } });
        for (let i = 0; i < 6; i++) this.tick(t + 0.04 + i * 0.042 + jitter(), 1600 + (i % 2) * 500, 0.09, 5);
        this.noise({ start: t + 0.34, dur: 0.05, gain: 0.08, filter: { type: 'lowpass', freq: 700 } });
        break;
      case ArtifactId.BALL_MOUSE: {
        // Rubber ball rolling + rattling rollers.
        this.noise({ start: t, dur: 0.36, gain: 0.04, attack: 0.05, filter: { type: 'lowpass', freq: 500, q: 1 } });
        let at = t + 0.02;
        for (let i = 0; i < 9; i++) {
          this.tick(at, 900 + Math.random() * 1300, 0.05 + Math.random() * 0.02, 3, 0.012);
          at += 0.022 + Math.random() * 0.018;
        }
        break;
      }
      case ArtifactId.CARTRIDGE:
        // Slide into the slot, then a plastic "clack".
        this.noise({ start: t, dur: 0.09, gain: 0.05, attack: 0.03, filter: { type: 'bandpass', freq: 1500, freqEnd: 600, q: 1.5 } });
        this.noise({ start: t + 0.1, dur: 0.05, gain: 0.13, filter: { type: 'lowpass', freq: 2200 } });
        this.tick(t + 0.125, 900, 0.1, 3, 0.03);
        this.tone({ type: 'triangle', freq: 160, freqEnd: 80, start: t + 0.1, dur: 0.07, gain: 0.12 });
        break;
      case ArtifactId.CD_ROM:
        // Tray click, disc spin-up whine, laser seek ticks.
        this.tick(t, 2400, 0.07, 3);
        this.tone({ type: 'sine', freq: 180, freqEnd: 1400, start: t + 0.02, dur: 0.42, gain: 0.025, attack: 0.08, vibrato: { rate: 30, depth: 6 } });
        this.noise({ start: t + 0.02, dur: 0.4, gain: 0.03, attack: 0.1, filter: { type: 'bandpass', freq: 300, freqEnd: 2500, q: 2 } });
        this.tick(t + 0.3, 2800, 0.05, 6, 0.01);
        this.tick(t + 0.34, 3100, 0.05, 6, 0.01);
        break;
      case ArtifactId.GPU_NEON:
        // Power relay + fan whoosh + faint coil whine.
        this.tick(t + 0.02, 2600, 0.07, 2);
        this.noise({ start: t, dur: 0.45, gain: 0.07, attack: 0.15, filter: { type: 'bandpass', freq: 250, freqEnd: 900, q: 0.7 } });
        this.pad({ type: 'sine', freq: 6400, start: t + 0.05, dur: 0.35, gain: 0.006, attack: 0.05, decay: 0.05, sustain: 0.8, release: 0.15 });
        break;
      default:
        // Unknown artifact: generic relay clicks.
        this.tick(t + 0.02, 2600, 0.08, 2);
        this.tick(t + 0.2, 2200, 0.07, 2);
        break;
    }
  }

  /** Startup-style major chime F4-C5-F5-A5 (+F3 body), slightly strummed, long tail. */
  private bootChime(at: number, era: EraId): void {
    const group = groupOf(era);
    const notes = [65, 72, 77, 81];
    notes.forEach((m, i) => {
      const s = at + i * 0.022;
      const f = mtof(m);
      this.pad({ type: 'sine', freq: f, start: s, dur: 2.0 - i * 0.1, gain: 0.055, attack: 0.025, decay: 0.35, sustain: 0.45, release: 1.2 });
      this.pad({ type: 'sine', freq: f, detune: 7, start: s, dur: 1.8 - i * 0.1, gain: 0.03, attack: 0.04, decay: 0.4, sustain: 0.4, release: 1.1 });
      // Era-flavoured shimmer an octave up.
      if (group === 'chip') {
        this.pad({ wave: this.pulse(0.125), freq: f * 2, start: s, dur: 0.6, gain: 0.008, attack: 0.01, decay: 0.2, sustain: 0.3, release: 0.3 });
      } else if (group !== 'retro') {
        this.pad({ type: 'triangle', freq: f * 2, start: s + 0.01, dur: 1.2, gain: 0.012, attack: 0.03, decay: 0.3, sustain: 0.35, release: 0.8, filter: { type: 'lowpass', freq: 3000 } });
      }
    });
    this.pad({ type: 'triangle', freq: mtof(53), start: at, dur: 1.9, gain: 0.05, attack: 0.03, decay: 0.5, sustain: 0.5, release: 1.2, filter: { type: 'lowpass', freq: 900 } });
  }

  private achievementCommonAt(era: EraId, t: number): void {
    if (era <= EraId.ASCII_1977) {
      // Lab console / terminal: two clean beeps.
      const sine = era === EraId.VECTOR_1958;
      const g = sine ? 0.12 : 0.06;
      const type: OscillatorType = sine ? 'sine' : 'square';
      this.pad({ type, freq: 1318.5, start: t, dur: 0.07, gain: g, attack: 0.003, decay: 0.02, sustain: 0.9, release: 0.02 });
      this.pad({ type, freq: 1760, start: t + 0.09, dur: 0.14, gain: g, attack: 0.003, decay: 0.03, sustain: 0.85, release: 0.04 });
      return;
    }
    if (era === EraId.MAC_1984) {
      // Simple desktop beep, softened square.
      const lp: FilterOpts = { type: 'lowpass', freq: 2200, q: 0.7 };
      this.pad({ type: 'square', freq: 880, start: t, dur: 0.16, gain: 0.07, attack: 0.004, decay: 0.05, sustain: 0.7, release: 0.06, filter: lp });
      this.pad({ type: 'square', freq: 1174.7, start: t + 0.13, dur: 0.24, gain: 0.07, attack: 0.004, decay: 0.06, sustain: 0.6, release: 0.12, filter: lp });
      return;
    }
    if (era <= EraId.SNES_1991) {
      // Chiptune pulse blips + held top note + triangle bass.
      const lead = { wave: this.pulse(0.25), type: 'square' as OscillatorType, gain: 0.09, attack: 0.002 };
      this.arp([76, 79, 84, 88], t, 0.05, lead);
      this.tone({ ...lead, wave: this.pulse(0.5), freq: mtof(91), start: t + 0.2, dur: 0.24 });
      this.tone({ type: 'triangle', freq: mtof(52), start: t, dur: 0.2, gain: 0.12, attack: 0.002 });
      this.tone({ type: 'triangle', freq: mtof(55), start: t + 0.2, dur: 0.24, gain: 0.12, attack: 0.002 });
      return;
    }
    if (era === EraId.WIN95_1995) {
      // Bright "tada"-style flourish: quick pickup chord into a sustained major chord.
      [67, 71, 74].forEach((m) =>
        this.pad({ type: 'triangle', freq: mtof(m), start: t, dur: 0.11, gain: 0.04, attack: 0.004, decay: 0.04, sustain: 0.7, release: 0.04 }),
      );
      [60, 64, 67, 72, 79].forEach((m) => {
        this.pad({ type: 'triangle', freq: mtof(m), start: t + 0.11, dur: 1.0, gain: 0.045, attack: 0.008, decay: 0.25, sustain: 0.4, release: 0.6 });
        this.pad({ type: 'sine', freq: mtof(m + 12), start: t + 0.12, dur: 0.8, gain: 0.02, attack: 0.008, decay: 0.2, sustain: 0.35, release: 0.5 });
      });
      this.tone({ type: 'sine', freq: mtof(96), start: t + 0.13, dur: 0.5, gain: 0.02, attack: 0.003 });
      return;
    }
    // 1999-2026: crystalline arpeggio with detuned layers and two soft echoes.
    const notes = [84, 88, 91, 96];
    [1, 0.4, 0.16].forEach((mult, k) => {
      notes.forEach((m, i) => {
        const at = t + i * 0.055 + k * 0.17;
        this.tone({ type: 'sine', freq: mtof(m), start: at, dur: 0.5, gain: 0.05 * mult, detune: -6, attack: 0.004 });
        this.tone({ type: 'triangle', freq: mtof(m), start: at, dur: 0.4, gain: 0.025 * mult, detune: 6, attack: 0.004, filter: { type: 'lowpass', freq: 6000 } });
      });
    });
  }

  private epicFanfareAt(t: number): void {
    const total = 1.8;
    const step = 0.13;
    // Brass section: 3 detuned saws per note through an enveloped lowpass; notes stack into a chord.
    [72, 76, 79, 84].forEach((m, i) => {
      const at = t + i * step;
      const last = i === 3;
      for (const det of [-8, 0, 8]) {
        this.pad({
          type: 'sawtooth', freq: mtof(m), detune: det, start: at, dur: total - i * step,
          gain: last ? 0.026 : 0.022, attack: 0.03, decay: 0.2, sustain: 0.65, release: last ? 0.7 : 0.5,
          filter: { type: 'lowpass', freq: 500, freqPeak: 3200, freqEnd: 1400, q: 2 },
        });
      }
    });
    // C4 bass + C3 sub for weight.
    this.pad({ type: 'sawtooth', freq: mtof(60), start: t, dur: total, gain: 0.05, attack: 0.02, decay: 0.25, sustain: 0.6, release: 0.6, filter: { type: 'lowpass', freq: 700, q: 1 } });
    this.pad({ type: 'sine', freq: mtof(48), start: t, dur: total, gain: 0.06, attack: 0.02, decay: 0.3, sustain: 0.6, release: 0.6 });
    // Sparkle once the top C lands.
    const sparkleAt = t + 3 * step + 0.04;
    [96, 100, 103, 108, 103, 108].forEach((m, i) =>
      this.tone({ type: i % 2 ? 'triangle' : 'sine', freq: mtof(m), start: sparkleAt + i * 0.06, dur: 0.35, gain: 0.02, attack: 0.003 }),
    );
    this.noise({ start: sparkleAt, dur: 0.6, gain: 0.015, attack: 0.05, filter: { type: 'highpass', freq: 7000 } });
  }

  private codexOpenAt(t: number): void {
    // Page/cover rustle: swept band-pass noise + a short high flick + a soft landing.
    this.noise({ start: t, dur: 0.16, gain: 0.07, attack: 0.03, filter: { type: 'bandpass', freq: 3200, freqEnd: 1400, q: 0.9 } });
    this.noise({ start: t + 0.05, dur: 0.1, gain: 0.04, attack: 0.01, filter: { type: 'highpass', freq: 4500 } });
    this.noise({ start: t + 0.11, dur: 0.07, gain: 0.06, attack: 0.006, filter: { type: 'lowpass', freq: 400 } });
    // Gentle low tone (G3 + soft D4).
    this.pad({ type: 'sine', freq: 196, start: t + 0.02, dur: 0.38, gain: 0.07, attack: 0.02, decay: 0.1, sustain: 0.5, release: 0.25 });
    this.pad({ type: 'triangle', freq: 293.7, start: t + 0.06, dur: 0.3, gain: 0.022, attack: 0.02, decay: 0.08, sustain: 0.5, release: 0.2, filter: { type: 'lowpass', freq: 1500 } });
  }

  // ----------------------------------------------- Música ambiente

  private ambientTick(): void {
    const ctx = this.ready();
    if (!ctx) return;
    try {
      const t = ctx.currentTime + 0.01;
      const step = this.ambientStep++;
      const group = groupOf(EraManager.getCurrentEra());
      const progression = [45, 41, 36, 43]; // Lá m — Fá — Dó — Sol
      const root = progression[Math.floor(step / 16) % progression.length];
      const arpNotes = [0, 7, 12, 15, 12, 7, 3, 7];
      const n = root + 24 + arpNotes[step % arpNotes.length];
      switch (group) {
        case 'retro':
          if (step % 4 === 0) this.tone({ type: 'sine', freq: mtof(root + 24), start: t, dur: 0.05, gain: 0.025, hard: true });
          break;
        case 'chip':
          this.tone({ wave: this.pulse(0.125), freq: mtof(n), start: t, dur: 0.08, gain: 0.025 });
          if (step % 4 === 0) this.tone({ type: 'triangle', freq: mtof(root), start: t, dur: 0.3, gain: 0.05 });
          break;
        case 'os':
          if (step % 2 === 0) this.tone({ type: 'triangle', freq: mtof(n), start: t, dur: 0.4, gain: 0.02, attack: 0.03 });
          break;
        case 'synth':
          if (step % 2 === 0) {
            this.saw(mtof(n), t, 0.3, 0.03, { type: 'lowpass', freq: 400, freqPeak: 2500, freqEnd: 500, q: 4 });
          }
          if (step % 8 === 0) this.tone({ type: 'sine', freq: mtof(root - 12), start: t, dur: 1.2, gain: 0.08, attack: 0.05 });
          break;
      }
    } catch {
      /* ignore */
    }
  }
}

export type { SoundSynthesizerImpl };
export const SoundSynthesizer = new SoundSynthesizerImpl();
