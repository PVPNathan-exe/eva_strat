// Tableau par joueur du Récap : une ligne par joueur, l'équipe suivie d'abord (palette « a »), puis une ligne de total par équipe quand tous ses joueurs sont montrés.
// Colonnes : kills, morts, kills sur morts, secondaires utilisés sur possibles, morts avec le secondaire disponible, vitesses, duels et somme des notes.
// Le tableau défile dans son propre conteneur (jamais plus large que l'écran). « n/d » : ligne de bilan absente ; « non établi » : le calcul n'a pas pu l'établir.

import { fmtCount, fmtSpeed, gadgetCell, killsOnDeaths, playerName, scoreSumCell, signed, speedMaxTitle, unusedCell, type Cell } from '../../../lib/recapFormat';
import { palClass, paletteNames, paletteOf, type FollowSpec, type Palette } from '../../../lib/teamFollow';
import type { RecapPlayer, RecapTeam, RecapTeamTotals } from '../../../types/statsRecap';
import type { StatsGame } from '../useStats';

interface Props {
  /** Joueurs retenus par les filtres, déjà ordonnés (équipe suivie d'abord). */
  players: RecapPlayer[];
  /** Nombre de joueurs de chaque équipe dans la game (pour savoir si une équipe est montrée en entier). */
  teamSizes: Record<RecapTeam, number>;
  totals: Record<RecapTeam, RecapTeamTotals>;
  replay: StatsGame;
  spec: FollowSpec;
}

const td = (c: Cell, key: string) => (
  <td key={key} title={c.title}>
    {c.text}
  </td>
);

/** Ligne d'un joueur. */
function PlayerRow({ p, pal, game }: { p: RecapPlayer; pal: Palette; game: StatsGame }) {
  const gadget = gadgetCell(p.gadget_uses, p.gadget_possible);
  const duelsTitle = 'Duel : un joueur en pousse un ou deux sans aide proche. Gagné par celui qui tue, sinon par les points de vie restants (convention).';
  return (
    <tr className={palClass(pal, p.slot)}>
      <th scope="row">
        <i className="recap__dot" aria-hidden />
        {playerName(p.slot, p.name ?? game.players.find((q) => q.slot === p.slot)?.name)}
      </th>
      <td>{fmtCount(p.kills)}</td>
      <td>{fmtCount(p.deaths)}</td>
      {td(killsOnDeaths(p.kills, p.deaths), 'kd')}
      {td(gadget, 'gadget')}
      {td(unusedCell(p.gadget_unused_at_death), 'unused')}
      <td>{fmtSpeed(p.v_mean)}</td>
      <td title={speedMaxTitle(p)}>{fmtSpeed(p.v_p98)}</td>
      <td title={duelsTitle}>{fmtCount(p.duels_won)}</td>
      <td title={duelsTitle}>{fmtCount(p.duels_lost)}</td>
      <td title="Duels sans vainqueur net (sans kill et sans écart de points de vie suffisant, ou interrompus).">{fmtCount(p.duels_other)}</td>
      {td(scoreSumCell(p), 'score')}
    </tr>
  );
}

/** Ligne de total d'une équipe. */
function TotalRow({ t, label, pal }: { t: RecapTeamTotals; label: string; pal: Palette }) {
  const gadget = gadgetCell(t.gadget_uses, t.gadget_possible);
  const score = t.kill_score_sum + t.death_score_sum;
  return (
    <tr className={`recap__total pal pal--${pal}`}>
      <th scope="row">Total {label}</th>
      <td>{fmtCount(t.kills)}</td>
      <td>{fmtCount(t.deaths)}</td>
      {td(killsOnDeaths(t.kills, t.deaths), 'kd')}
      {td(gadget, 'gadget')}
      {td(unusedCell(t.gadget_unused_at_death), 'unused')}
      <td />
      <td />
      <td>{fmtCount(t.duels_won)}</td>
      <td>{fmtCount(t.duels_lost)}</td>
      <td>{fmtCount(t.duels_other)}</td>
      <td title="Somme des notes des kills et des morts de l'équipe (convention).">{signed(score)}</td>
    </tr>
  );
}

export function RecapPlayers({ players, teamSizes, totals, replay, spec }: Props) {
  const names = paletteNames(replay, spec);
  const sides: RecapTeam[] = [...new Set(players.map((p) => p.team))];
  return (
    <div className="recap__scroll" role="region" aria-label="Bilan par joueur" tabIndex={0}>
      <table className="recap__table">
        <thead>
          <tr>
            <th scope="col">Joueur</th>
            <th scope="col">Kills</th>
            <th scope="col">Morts</th>
            <th scope="col" title="Kills divisés par morts">Kills sur morts</th>
            <th scope="col" title="Secondaires utilisés sur possibles (borne haute calculée par délai de gadget)">Secondaires utilisés</th>
            <th scope="col" title="Morts avec le secondaire encore disponible (mauvais : mourir avec)">Morts avec secondaire</th>
            <th scope="col" title="Vitesse moyenne sur les lignes vivantes, tyroliennes et sauts exclus (m/s)">Vitesse moyenne (m/s)</th>
            <th scope="col" title="98e centile de la vitesse (m/s) ; le maximum brut est en infobulle sur chaque valeur">Vitesse max, 98e centile (m/s)</th>
            <th scope="col">Duels gagnés</th>
            <th scope="col">Duels perdus</th>
            <th scope="col">Duels autres</th>
            <th scope="col" title="Somme des notes des kills et des morts du joueur (convention, de -2 à +3 par kill)">Somme des notes</th>
          </tr>
        </thead>
        {sides.map((side) => {
          const mine = players.filter((p) => p.team === side);
          const pal = paletteOf(replay, spec, side === 'A' ? 1 : 5);
          return (
            <tbody key={side}>
              {mine.map((p) => (
                <PlayerRow key={p.slot} p={p} pal={pal} game={replay} />
              ))}
              {mine.length === teamSizes[side] && <TotalRow t={totals[side]} label={names[pal]} pal={pal} />}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}
