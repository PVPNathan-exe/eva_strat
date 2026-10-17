// Une couche de chaleur de la vue Équipe : un canevas n par n étiré sur la minimap (le navigateur interpole entre les cases), ou tracé déformé sur le plan pour une carte à maillage (Artefact).

import { PlanCanvas } from '../../PlanCanvas';

export function HeatCanvas({ pixels, n, warp }: { pixels: Uint8ClampedArray; n: number; warp?: string }) {
  return <PlanCanvas pixels={pixels} w={n} h={n} warp={warp} className="stats__heat team__canvas" />;
}
