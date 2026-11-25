import type { CSSProperties } from 'react';
import { Cpu, Disc, Gamepad2, Lightbulb, Mouse, Save } from 'lucide-react';
import { PAD, TOUCH, type InputMode } from '../../core/InputMode';
import type { LucideIcon } from 'lucide-react';
import { ArtifactId, EraId } from '../../core/types';
import type { EraConfig, PlayerStats } from '../../core/types';

/** Props comuns de todos os HUDs de era. */
export interface HudProps {
  config: EraConfig;
  stats: PlayerStats;
  unlocked: EraId[];
}

/** Ordem fixa dos 6 slots de artefato (cronológica: 1946, 1976, 1983, 1984, 1985, 1999). */
export const ARTIFACT_ORDER: readonly ArtifactId[] = [
  ArtifactId.VALVE,
  ArtifactId.FLOPPY,
  ArtifactId.CARTRIDGE,
  ArtifactId.BALL_MOUSE,
  ArtifactId.CD_ROM,
  ArtifactId.GPU_NEON,
];

export const ARTIFACT_ICONS: Record<ArtifactId, LucideIcon> = {
  [ArtifactId.VALVE]: Lightbulb,
  [ArtifactId.FLOPPY]: Save,
  [ArtifactId.BALL_MOUSE]: Mouse,
  [ArtifactId.CARTRIDGE]: Gamepad2,
  [ArtifactId.CD_ROM]: Disc,
  [ArtifactId.GPU_NEON]: Cpu,
};

export function ArtifactIcon({
  id,
  size = 14,
  className,
  style,
  strokeWidth = 2,
}: {
  id: ArtifactId;
  size?: number;
  className?: string;
  style?: CSSProperties;
  strokeWidth?: number;
}) {
  const Icon = ARTIFACT_ICONS[id];
  return <Icon size={size} className={className} style={style} strokeWidth={strokeWidth} />;
}

/** Cor de acento legível sobre fundo escuro, por era (Timeline / telas). */
export const ERA_ACCENTS: Record<EraId, string> = {
  [EraId.VECTOR_1958]: '#00FF66',
  [EraId.ASCII_1977]: '#33FF00',
  [EraId.MAC_1984]: '#F5F5F5',
  [EraId.NES_1986]: '#E45C10',
  [EraId.SNES_1991]: '#6C8CFF',
  [EraId.WIN95_1995]: '#1084D0',
  [EraId.Y2K_1999]: '#A6FF00',
  [EraId.FLASH_2005]: '#2FA8E8',
  [EraId.FLAT_2013]: '#1ABC9C',
  [EraId.NEON_2026]: '#10B981',
};

export interface ControlHint {
  keys: string;
  action: string;
}

/** Dica de controles conforme as mecânicas da era e o dispositivo em uso. */
export function controlHints(config: EraConfig, mode: InputMode = 'keyboard'): ControlHint[] {
  const isPad = mode !== 'keyboard';
  const L = mode === 'touch' ? TOUCH : PAD;
  const jump = isPad ? L.jump : 'Espaço';
  const hints: ControlHint[] = [
    { keys: isPad ? L.move : '← →', action: 'mover' },
    { keys: jump, action: config.allowDoubleJump ? 'pular (2× no ar)' : 'pular' },
  ];
  if (config.allowVariableJump) hints.push({ keys: `Toque no ${jump}`, action: 'pulinho' });
  if (config.allowWallJump) hints.push({ keys: `Parede + ${jump}`, action: 'wall-jump' });
  if (config.allowDash) hints.push({ keys: isPad ? L.dash : 'X/K/Shift', action: 'dash' });
  if (config.allowBulletTime) hints.push({ keys: isPad ? L.bullet : 'Shift', action: 'liga/desliga bullet time' });
  if (config.allowWindowDrag) hints.push({ keys: mode === 'touch' ? 'Toque' : 'Mouse', action: 'arrasta janelas' });
  if (config.id === EraId.WIN95_1995) hints.push({ keys: mode === 'touch' ? 'Toque' : 'Mouse', action: 'fecha pop-ups' });
  if (config.passThroughCodeComments) hints.push({ keys: '//', action: 'atravesse comentários' });
  hints.push({ keys: isPad ? L.eras : '1…0', action: 'eras' });
  return hints;
}

export function pad(n: number, len: number): string {
  return String(Math.max(0, Math.floor(n))).padStart(len, '0');
}

export function hasArtifact(stats: PlayerStats, id: ArtifactId): boolean {
  return stats.artifacts.includes(id);
}
