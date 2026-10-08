// Fonctions pures de temps pour la timeline de l'onglet Analyse.

/** Lit un instant saisi : « 1:23 », « 1:02:03 », « 83 » ou « 83,5 ». null si incompréhensible. */
export function parseTime(text: string): number | null {
  const parts = text.trim().replace(',', '.').split(':');
  if (parts.length === 0 || parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
  return parts.reduce((total, p) => total * 60 + Number(p), 0);
}

export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function timeToPct(t: number, duration: number): number {
  if (duration <= 0) return 0;
  return Math.min(100, Math.max(0, (t / duration) * 100));
}

export function pctToTime(pct: number, duration: number): number {
  return (pct / 100) * duration;
}

/** Ramène des bornes dans 0 ≤ début < fin ≤ durée (au moins 1 s d'écart). */
export function clampBounds(start: number, end: number, duration: number): { start: number; end: number } {
  const s = Math.min(Math.max(0, start), Math.max(0, duration - 1));
  const e = Math.min(Math.max(end, s + 1), duration);
  return { start: s, end: e };
}
