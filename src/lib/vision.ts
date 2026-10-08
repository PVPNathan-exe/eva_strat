// Calques de « Ce que voit le programme » (dessinés sur la vidéo, voir VisionOverlay).

export interface VisionLayers {
  zones: boolean;
  minimap: boolean;
  bandeaux: boolean;
  killfeed: boolean;
}

export const VISION_LAYER_LABELS: Record<keyof VisionLayers, string> = {
  zones: 'Zones du HUD lues',
  minimap: 'Pastilles de la minimap',
  bandeaux: 'Bandeaux et équipement',
  killfeed: 'Kills récents',
};
