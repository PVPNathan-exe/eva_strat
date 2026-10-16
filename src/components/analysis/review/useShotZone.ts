// Calque « zone de tir » du replay : charge ce qu'il faut (grille de la carte, noms d'armes, équipement par vie, niveaux) et calcule la zone du joueur choisi.
// Le calcul se fait au quart de seconde (quantize) avec un cache : la lecture à 60 images par seconde ne le relance pas à chaque image.

import { useDeferredValue, useMemo } from 'react';
import { analysisApi } from '../../../lib/analysisApi';
import { readingOf, rotorsOf } from '../../../lib/mapReading';
import { createCache } from '../../../lib/safeZones';
import { statsApi } from '../../../lib/statsApi';
import { TWO_LEVEL_MAPS } from '../../../lib/twoLevelMaps';
import { buildGrid, type Segment } from '../../../lib/visibility';
import { medianRange, type PlayerRange } from '../../../lib/weaponRange';
import type { Game } from '../../../types/analysis';
import { noticeOf, useLoad } from '../../stats/useStats';
import { type Frame, shownAt } from './replayFrames';
import { equipmentAt, playerShotZone, quantize, weaponRangeOf, type Equipment, type ShotZone, type WeaponChoice } from './shotZone';
import { loadZoneSources } from './zoneSources';

const GRID_SIZE = 200; // côté de la grille de calcul (le masque fait 400 sur 400), comme les zones sûres

interface Computed {
  zone: ShotZone | null;
  range: PlayerRange;
  equipment: Equipment | null;
}

export interface ShotZoneState extends Partial<Computed> {
  /** Message à montrer à la place du calque (chargement, aucun joueur choisi, joueur mort). null : la zone est prête. */
  notice: string | null;
  /** L'équipement par vie n'a pas pu être lu : l'équipement de la game est utilisé. */
  loadoutsMissing: boolean;
}

interface Args {
  game: Game;
  enabled: boolean;
  slot: number | null;
  choice: WeaponChoice;
  frames: Frame[];
  /** Instant de la vidéo (s). */
  time: number;
}

export function useShotZone({ game, enabled, slot, choice, frames, time }: Args): ShotZoneState {
  const map = game.map ?? '';
  const sources = useLoad(enabled && map ? `review-zone-sources:${map}` : null, () => loadZoneSources(map));
  const weapons = useLoad(enabled ? 'review-weapons' : null, () => analysisApi.weapons()); // identifiants d'icônes vers noms d'armes
  const loadouts = useLoad(enabled ? `review-loadouts:${game.id}` : null, () => statsApi.lifeLoadouts(game.id)); // équipement par vie (tables Stats)
  const levels = useLoad(enabled && TWO_LEVEL_MAPS.includes(map) ? `review-levels:${game.id}` : null, () => statsApi.levels(game.id));

  const iconNames = useMemo(() => Object.fromEntries((weapons.data ?? []).filter((w) => w.name).map((w) => [w.id, w.name])), [weapons.data]);
  const base = useMemo(() => (sources.data ? buildGrid(sources.data.walk, sources.data.classes, 'balles', GRID_SIZE, sources.data.under) : null), [sources.data]);
  const rotors = useMemo(() => rotorsOf(map), [map]);
  const doors = useMemo<Segment[]>(() => readingOf(map).openings.filter((o) => o.kind === 'porte' && !o.glass).map((o) => [o.from, o.to] as Segment), [map]);
  const glassDoors = useMemo<Segment[]>(() => readingOf(map).openings.filter((o) => o.kind === 'porte' && o.glass).map((o) => [o.from, o.to] as Segment), [map]);
  // Les données du calcul, avec un cache : il est neuf (vide) quand les positions, l'équipement ou les niveaux changent.
  const inputs = useMemo(
    () => ({ frames, base, iconNames, loadouts: loadouts.data ?? [], levels: levels.data, doors, glassDoors, rotors, cache: createCache<Computed>() }),
    [frames, base, iconNames, loadouts.data, levels.data, doors, glassDoors, rotors],
  );

  const tq = useDeferredValue(quantize(time)); // le curseur reste fluide, le calcul suit
  const computed = useMemo<Computed | null>(() => {
    if (!enabled || !inputs.base || slot === null || inputs.frames.length === 0) return null;
    const key = `${slot}|${choice}|${tq}`;
    const hit = inputs.cache.get(key);
    if (hit) return hit;
    const gameT = tq - game.start_s;
    const equipment = equipmentAt(inputs.loadouts, slot, gameT, game.players);
    const fallback = medianRange(game.players.flatMap((p) => [p.weapon1, p.weapon2]), inputs.iconNames);
    const range = weaponRangeOf(equipment, choice, inputs.iconNames, fallback);
    const living = shownAt(inputs.frames, tq).filter((p) => p.alive);
    const zone = playerShotZone({ base: inputs.base, doors: inputs.doors, glassDoors: inputs.glassDoors, rotors: inputs.rotors, t: gameT, living, slot, range, levels: inputs.levels });
    const value = { zone, range, equipment };
    inputs.cache.set(key, value);
    return value;
  }, [enabled, inputs, slot, choice, tq, game.start_s, game.players]);

  const loading = noticeOf(sources, weapons);
  const notice = !enabled ? null : slot === null ? 'Choisis un joueur (clic sur sa pastille ou liste « Joueur choisi ») pour voir sa zone de tir.' : loading ? loading : computed && !computed.zone ? 'Ce joueur est mort ou n\'a pas de position lue à cet instant.' : null;
  return { ...computed, notice, loadoutsMissing: enabled && (loadouts.error !== null || (loadouts.data !== null && loadouts.data.length === 0)) };
}
