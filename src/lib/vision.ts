// Calques de « Ce que voit le programme » (dessinés sur la vidéo, voir VisionOverlay).

export interface VisionLayers {
  zones: boolean;
  minimap: boolean;
  bandeaux: boolean;
  killfeed: boolean;
  controle: boolean; // anneau rouge sur les positions que la vraie minimap ne confirme pas, anneau blanc sur le joueur observé
  zonesFiables: boolean; // cases de la minimap où le suivi est peu fiable
}

export const VISION_LAYER_LABELS: Record<keyof VisionLayers, string> = {
  zones: 'Zones du HUD lues',
  minimap: 'Pastilles de la minimap',
  bandeaux: 'Bandeaux et équipement',
  killfeed: 'Kills récents',
  controle: 'Contrôle à la minimap (non confirmés, observé)',
  zonesFiables: 'Zones peu fiables',
};
