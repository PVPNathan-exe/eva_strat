// Lecture de l'en-tête HTTP Range, indispensable pour naviguer dans une vidéo de plusieurs Go.

export interface ByteRange {
  start: number;
  end: number; // inclus
}

/** null : pas de Range (réponse complète). 'invalid' : à refuser avec un 416. */
export function parseRange(header: string | undefined, size: number): ByteRange | null | 'invalid' {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return 'invalid';

  let start: number;
  let end: number;
  if (m[1] === '') {
    const last = Number(m[2]);
    if (last === 0) return 'invalid';
    start = Math.max(0, size - last);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return 'invalid';
  return { start, end };
}
