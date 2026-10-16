// Une couche de chaleur de la vue Équipe : un canevas n par n étiré sur la minimap (le navigateur interpole entre les cases).

import { useEffect, useRef } from 'react';

export function HeatCanvas({ pixels, n }: { pixels: Uint8ClampedArray; n: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (ctx) ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), n, n), 0, 0);
  }, [pixels, n]);
  return <canvas ref={ref} width={n} height={n} className="stats__heat team__canvas" />;
}
