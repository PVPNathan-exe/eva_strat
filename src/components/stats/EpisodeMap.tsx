// Plan des vues Retakes et Rotations à l'instant du curseur : pions numérotés des joueurs vivants (équipe suivie en --c-owner-a, adversaires en --c-owner-b, comme le Parcours),
// points concernés entourés (le point d'un retake ; l'ancien point en pointillé et le nouveau en plein pour une rotation) et croix des morts de l'épisode choisi.

import { X } from 'lucide-react';
import type { Pawn, Rect } from '../../lib/episodeClock';
import { numberOfSlot } from '../../lib/killTimeline';
import { palClass, type Palette } from '../../lib/teamFollow';
import '../../styles/stats-chrono.css';
import { StatsMapBase } from './StatsMapBase';

/** Un point entouré sur le plan : `role` « point » (retake), « old » (ancien point actif) ou « new » (nouveau point actif). */
export interface Ring {
  point: string;
  rect: Rect;
  role: 'point' | 'old' | 'new';
}

export interface DeathCross {
  key: string;
  x: number;
  y: number;
  palette: Palette;
  title: string;
}

interface Props {
  map: string;
  corridors: boolean;
  pawns: Pawn[];
  paletteOfSlot: (slot: number) => Palette;
  /** Pseudo d'un joueur (info-bulle du pion). */
  nameOf: (slot: number) => string | undefined;
  rings: Ring[];
  crosses: DeathCross[];
}

const ROLE_TITLE: Record<Ring['role'], string> = { point: 'Point concerné', old: 'Ancien point actif', new: 'Nouveau point actif' };

export function EpisodeMap({ map, corridors, pawns, paletteOfSlot, nameOf, rings, crosses }: Props) {
  return (
    <StatsMapBase map={map} corridors={corridors}>
      {({ at }) => (
        <>
          {rings.map((r) => {
            const a = at(r.rect[0], r.rect[1]);
            const b = at(r.rect[2], r.rect[3]);
            return (
              <span key={`${r.role}${r.point}`} className={`epmap__ring epmap__ring--${r.role}`} style={{ left: `${a.x}%`, top: `${a.y}%`, width: `${b.x - a.x}%`, height: `${b.y - a.y}%` }} title={`${ROLE_TITLE[r.role]} : point ${r.point}`}>
                <b>{r.point}</b>
              </span>
            );
          })}
          {crosses.map((c) => {
            const o = at(c.x, c.y);
            return (
              <span key={c.key} className={`epmap__death pal pal--${c.palette}`} style={{ left: `${o.x}%`, top: `${o.y}%` }} title={c.title}>
                <X className="ic" />
              </span>
            );
          })}
          {pawns.map((p) => {
            const o = at(p.x, p.y);
            const name = nameOf(p.slot);
            return (
              <span key={p.slot} className={`stats__pawn ${palClass(paletteOfSlot(p.slot), p.slot)}`} style={{ left: `${o.x}%`, top: `${o.y}%` }} title={`N° ${numberOfSlot(p.slot)}${name ? ` (${name})` : ''}`}>
                {numberOfSlot(p.slot)}
              </span>
            );
          })}
        </>
      )}
    </StatsMapBase>
  );
}
