/**
 * Aviso de som bloqueado. Navegadores só liberam áudio após clique/tecla física —
 * botão de controle não conta como gesto. Se o jogador usa só o controle e o
 * AudioContext segue suspenso, mostramos como liberar (um clique em qualquer lugar).
 */
import { useEffect, useState } from 'react';
import { VolumeX } from 'lucide-react';
import { SoundSynthesizer } from '../core/SoundSynthesizer';
import { useInputMode } from './eras-hud/hooks';

export default function SoundUnlockNotice() {
  const mode = useInputMode();
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    if (mode !== 'gamepad') {
      setBlocked(false);
      return;
    }
    const check = () => setBlocked(!SoundSynthesizer.isAudioRunning());
    check();
    const id = window.setInterval(check, 500);
    return () => window.clearInterval(id);
  }, [mode]);

  if (!blocked) return null;
  return (
    <div className="pointer-events-none fixed left-1/2 top-3 z-[60] flex -translate-x-1/2 items-center gap-2 rounded border border-amber-400/60 bg-black/85 px-3 py-1.5 font-pixel text-[9px] text-amber-300 shadow-lg">
      <VolumeX size={12} />
      SOM BLOQUEADO PELO NAVEGADOR · CLIQUE OU APERTE UMA TECLA UMA VEZ PARA ATIVAR
    </div>
  );
}
