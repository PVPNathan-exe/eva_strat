// Tableau par joueur du Récap : une ligne par joueur, l'équipe suivie d'abord (palette « a »), puis une ligne de total par équipe quand tous ses joueurs sont montrés.
// Colonnes : kills, morts, assistances (tableau de fin de game ; en infobulle des kills et morts, les valeurs officielles quand elles diffèrent), kills sur morts, secondaires utilisés sur possibles, morts avec le secondaire disponible, vitesses, duels
// et note sur 20 (individuelle, teamplay, globale) : un clic sur le nom d'un joueur déplie le détail de sa note (RecapRating), conventions sans vérité terrain.
// Le tableau défile dans son propre conteneur (jamais plus large que l'écran). « n/d » : ligne de bilan absente ; « non établi » : le calcul n'a pas pu l'établir.

import { ChevronDown, ChevronRight } from 'lucide-react';
import { Fragment, useState } from 'react';
import { assistsCell, fmtCount, fmtSpeed, gadgetCell, killsOnDeaths, officialTitle, playerName, speedMaxTitle, unusedCell, type Cell } from '../../../lib/recapFormat';
import { palClass, paletteNames, paletteOf, type FollowSpec, type Palette } from '../../../lib/teamFollow';
import type { RecapPlayer, RecapTeam, RecapTeamTotals } from '../../../types/statsRecap';
import type { StatsGame } from '../useStats';
import { RATING_COLUMNS, RatingCells, RatingDetailPanel, RatingHeaders, TeamRatingCells } from './RecapRating';

interface Props {
  /** Joueurs retenus par les filtres, déjà ordonnés (équipe suivie d'abord). */
  players: RecapPlayer[];
  /** Nombre de joueurs de chaque équipe dans la game (pour savoir si une équipe est montrée en entier). */
  teamSizes: Record<RecapTeam, number>;
  totals: Record<RecapTeam, RecapTeamTotals>;
  replay: StatsGame;
  spec: FollowSpec;
}

/** Colonnes du tableau : le joueur, onze chiffres, puis les notes. */
const COLUMNS = 12 + RATING_COLUMNS;

const td = (c: Cell, key: string) => (
  <td key={key} title={c.title}>
    {c.text}
  </td>
);

/** Ligne d'un joueur, suivie de son détail de note quand elle est dépliée. */
function PlayerRow({ p, pal, game, open, onToggle }: { p: RecapPlayer; pal: Palette; game: StatsGame; open: boolean; onToggle: () => void }) {
  const gadget = gadgetCell(p.gadget_uses, p.gadget_possible);
  const duelsTitle = 'Duel : un joueur en pousse un ou deux sans aide proche. Gagné par celui qui tue, sinon par les points de vie restants (convention).';
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <Fragment>
      <tr className={palClass(pal, p.slot)}>
        <th scope="row">
          <button type="button" className="recap__expand" aria-expanded={open} onClick={onToggle} title="Déplier le détail de la note de ce joueur">
            <Chevron className="ic" aria-hidden />
            <i className="recap__dot" aria-hidden />
            {playerName(p.slot, p.name ?? game.players.find((q) => q.slot === p.slot)?.name)}
          </button>
        </th>
        <td title={officialTitle('kills', p.kills, p.scoreboard)}>{fmtCount(p.kills)}</td>
        <td title={officialTitle('deaths', p.deaths, p.scoreboard)}>{fmtCount(p.deaths)}</td>
        {td(assistsCell(p), 'assists')}
        {td(killsOnDeaths(p.kills, p.deaths), 'kd')}
        {td(gadget, 'gadget')}
        {td(unusedCell(p.gadget_unused_at_death), 'unused')}
        <td>{fmtSpeed(p.v_mean)}</td>
        <td title={speedMaxTitle(p)}>{fmtSpeed(p.v_p98)}</td>
        <td title={duelsTitle}>{fmtCount(p.duels_won)}</td>
        <td title={duelsTitle}>{fmtCount(p.duels_lost)}</td>
        <td title="Duels sans vainqueur net (sans kill et sans écart de points de vie suffisant, ou interrompus).">{fmtCount(p.duels_other)}</td>
        <RatingCells player={p} />
      </tr>
      {open && (
        <tr className="recap__detail">
          <td colSpan={COLUMNS}>
            <div className="recap__detail-in">
              <RatingDetailPanel rating={p.rating} />
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

/** Ligne de total d'une équipe. */
function TotalRow({ t, label, pal }: { t: RecapTeamTotals; label: string; pal: Palette }) {
  const gadget = gadgetCell(t.gadget_uses, t.gadget_possible);
  return (
    <tr className={`recap__total pal pal--${pal}`}>
      <th scope="row">Total {label}</th>
      <td>{fmtCount(t.kills)}</td>
      <td>{fmtCount(t.deaths)}</td>
      <td />
      {td(killsOnDeaths(t.kills, t.deaths), 'kd')}
      {td(gadget, 'gadget')}
      {td(unusedCell(t.gadget_unused_at_death), 'unused')}
      <td />
      <td />
      <td>{fmtCount(t.duels_won)}</td>
      <td>{fmtCount(t.duels_lost)}</td>
      <td>{fmtCount(t.duels_other)}</td>
      <TeamRatingCells rating={t.rating} />
    </tr>
  );
}

export function RecapPlayers({ players, teamSizes, totals, replay, spec }: Props) {
  const names = paletteNames(replay, spec);
  const sides: RecapTeam[] = [...new Set(players.map((p) => p.team))];
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const toggle = (slot: number) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (!next.delete(slot)) next.add(slot);
      return next;
    });
  return (
    <div className="recap__scroll" role="region" aria-label="Bilan par joueur" tabIndex={0}>
      <table className="recap__table">
        <thead>
          <tr>
            <th scope="col">Joueur</th>
            <th scope="col">Kills</th>
            <th scope="col">Morts</th>
            <th scope="col" title="Assistances officielles du tableau de fin de game (l'analyse ne les lit pas ailleurs)">Assistances</th>
            <th scope="col" title="Kills divisés par morts">Kills sur morts</th>
            <th scope="col" title="Secondaires utilisés sur possibles (borne haute calculée par délai de gadget)">Secondaires utilisés</th>
            <th scope="col" title="Morts avec le secondaire encore disponible (mauvais : mourir avec)">Morts avec secondaire</th>
            <th scope="col" title="Vitesse moyenne sur les lignes vivantes, tyroliennes et sauts exclus (m/s)">Vitesse moyenne (m/s)</th>
            <th scope="col" title="98e centile de la vitesse (m/s) ; le maximum brut est en infobulle sur chaque valeur">Vitesse max, 98e centile (m/s)</th>
            <th scope="col">Duels gagnés</th>
            <th scope="col">Duels perdus</th>
            <th scope="col">Duels autres</th>
            <RatingHeaders />
          </tr>
        </thead>
        {sides.map((side) => {
          const mine = players.filter((p) => p.team === side);
          const pal = paletteOf(replay, spec, side === 'A' ? 1 : 5);
          return (
            <tbody key={side}>
              {mine.map((p) => (
                <PlayerRow key={p.slot} p={p} pal={pal} game={replay} open={open.has(p.slot)} onToggle={() => toggle(p.slot)} />
              ))}
              {mine.length === teamSizes[side] && <TotalRow t={totals[side]} label={names[pal]} pal={pal} />}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}
