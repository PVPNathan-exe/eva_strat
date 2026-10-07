// Référence partagée au <video> de l'onglet Analyse (pour capturer une frame de calibration).

let element: HTMLVideoElement | null = null;

export function setVideoElement(el: HTMLVideoElement | null) {
  element = el;
}

/** Image courante de la vidéo en data URL JPEG, ou null si indisponible. */
export function captureFrame(): string | null {
  if (!element || !element.videoWidth) return null;
  const canvas = document.createElement('canvas');
  canvas.width = element.videoWidth;
  canvas.height = element.videoHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(element, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.9);
}
