/**
 * Modo de teste: pula direto para qualquer obstáculo, já com as eras anteriores liberadas.
 *
 * Disponível em `npm run dev` ou com `?teste` na URL. [F2] abre/fecha o painel.
 * Não toca no museu/conquistas: os artefatos pulados apenas somem do mapa.
 */
import { useEffect, useState } from 'react';
import { EventBus } from '../core/EventBus';
import { ARTIFACTS, ERA_CONFIGS, EraManager } from '../core/EraManager';
import { ALL_ERAS } from '../core/types';
import { DEV_WARPS, type DevWarpDef } from '../game/level/LevelLayout';
import { ERA_ACCENTS } from './eras-hud/shared';
import { useGameState } from './eras-hud/hooks';
import { startGame } from './eras-hud/TitleScreen';

const ENABLED = import.meta.env.DEV || new URLSearchParams(window.location.search).has('teste');

function warpTo(w: DevWarpDef): void {
  if (EventBus.getLast('GAME_STATE_CHANGED')?.state !== 'playing') startGame();
  // Tudo o que os artefatos removidos pela cena liberariam (o Mouse libera 1995 E 1999, por exemplo).
  const skipped = Object.values(ARTIFACTS).filter((a) => a.unlocks.some((e) => e <= w.era));
  EraManager.unlock([...ALL_ERAS.filter((e) => e <= w.era), ...skipped.flatMap((a) => a.unlocks)]);
  EventBus.emit('DEV_WARP', { x: w.x, y: w.y, era: w.era });
  EraManager.setEra(w.era, 'timeline');
}

export function DevWarpPanel() {
  const [open, setOpen] = useState(false);
  const gameState = useGameState();

  useEffect(() => {
    if (!ENABLED) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F2' || e.repeat) return;
      e.preventDefault();
      setOpen((o) => !o);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!ENABLED) return null;

  if (!open) {
    return (
      <div className="pointer-events-none absolute left-2 top-2 font-pixel text-[7px] text-slate-500/80">[F2] TESTE</div>
    );
  }

  // Na vitória a cena reinicia ao voltar a jogar, o que desfaria o salto.
  const disabled = gameState === 'victory';

  return (
    <div
      className="pointer-events-auto absolute left-2 top-2 w-[250px] bg-[#07080D]/95 p-2 text-slate-100"
      style={{ boxShadow: 'inset 0 0 0 2px #FACC15, 0 8px 24px rgba(0,0,0,.6)' }}
    >
      <div className="mb-1.5 flex items-center justify-between font-pixel text-[8px] text-[#FACC15]">
        <span>MODO TESTE · FASES</span>
        <span className="text-slate-500">[F2]</span>
      </div>
      {disabled && <div className="mb-1 font-terminal text-[15px] text-slate-400">Reinicie a partida para usar.</div>}
      <div className="flex flex-col gap-1">
        {DEV_WARPS.map((w) => (
          <button
            key={w.era}
            type="button"
            tabIndex={-1}
            disabled={disabled}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => warpTo(w)}
            className="flex items-center gap-2 px-2 py-1 text-left outline-none hover:bg-white/10 disabled:opacity-40"
            style={{ boxShadow: `inset 0 0 0 1px ${ERA_ACCENTS[w.era]}66` }}
          >
            <span className="font-pixel text-[9px]" style={{ color: ERA_ACCENTS[w.era] }}>
              {ERA_CONFIGS[w.era].year}
            </span>
            <span className="min-w-0 flex-1 truncate font-terminal text-[16px] leading-none">{w.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default DevWarpPanel;
