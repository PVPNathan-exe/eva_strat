// Tableaux de la vue Équipe : totaux de l'équipe suivie, issues des vagues et joueurs (cliquer sur un pseudo le choisit). Une valeur null s'écrit « non établi ».

import { formatTime } from '../../../lib/timeline';
import { duelShare, killsMinusDeathsTotal, MIN_DECIDED_WAVES, outcomeRows, percentText, playerGroups, shownRate } from '../../../lib/teamView';
import type { TeamSummary } from '../../../types/statsTeam';

const NA = 'non établi';
const num = (v: number | null): string => (v === null ? NA : String(v));

export function TotalsTable({ data }: { data: TeamSummary }) {
  const { stats, duels } = data;
  const diff = killsMinusDeathsTotal(stats.kills, stats.deaths);
  const gadget =
    stats.gadget_uses === null
      ? NA
      : `${stats.gadget_uses} utilisation${stats.gadget_uses > 1 ? 's' : ''}${stats.gadget_possible === null ? ' (utilisations possibles : non établi)' : ` sur ${stats.gadget_possible} possible${stats.gadget_possible > 1 ? 's' : ''}`}`;
  return (
    <section className="team__block">
      <h3 className="team__title">Totaux de l'équipe ({data.games} games)</h3>
      <div className="team__scroll">
        <table className="team__table">
          <tbody>
            <tr><th scope="row">Kills</th><td>{num(stats.kills)}</td></tr>
            <tr><th scope="row">Morts</th><td>{num(stats.deaths)}</td></tr>
            <tr><th scope="row">Kills moins morts</th><td>{diff === null ? NA : diff > 0 ? `+${diff}` : String(diff)}</td></tr>
            <tr><th scope="row">Duels gagnés</th><td>{duels.won}</td></tr>
            <tr><th scope="row">Duels perdus</th><td>{duels.lost}</td></tr>
            <tr><th scope="row">Duels sans vainqueur</th><td>{duels.other}</td></tr>
            <tr><th scope="row">Part de duels gagnés</th><td>{percentText(duelShare(duels))}</td></tr>
            <tr><th scope="row">Gadget utilisé</th><td>{gadget}</td></tr>
            <tr><th scope="row">Morts avec le gadget encore disponible</th><td>{num(stats.gadget_unused_at_death)}</td></tr>
          </tbody>
        </table>
      </div>
      {stats.games_with_stats < data.games && (
        <p className="team__note">Kills et morts : {stats.games_with_stats} game{stats.games_with_stats > 1 ? 's' : ''} sur {data.games} ont un bilan par joueur calculé.</p>
      )}
    </section>
  );
}

export function OutcomesTable({ data }: { data: TeamSummary }) {
  const t = data.outcomes;
  if (!t) return null;
  const rows = outcomeRows(t);
  const rate = shownRate(t);
  return (
    <section className="team__block">
      <h3 className="team__title">Issues des vagues de l'équipe ({data.games} games)</h3>
      {rows.length === 0 ? (
        <p className="team__note">Aucune vague comptée pour ces games.</p>
      ) : (
        <div className="team__scroll">
          <table className="team__table">
            <thead>
              <tr><th scope="col">Issue</th><th scope="col">Vagues</th><th scope="col">Part</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}><th scope="row">{r.label}</th><td>{r.count}</td><td>{percentText(r.share)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="team__note">
        {t.waves} vague{t.waves > 1 ? 's' : ''} comptée{t.waves > 1 ? 's' : ''}, {t.decided} décidée{t.decided > 1 ? 's' : ''}.{' '}
        {rate !== null ? `Taux de retake réussi : ${percentText(rate)}.` : `Taux de retake réussi masqué sous ${MIN_DECIDED_WAVES} vagues décidées.`}
      </p>
    </section>
  );
}

interface PlayersProps {
  data: TeamSummary;
  selected: string | null;
  onPick: (key: string | null) => void;
}

export function PlayersTable({ data, selected, onPick }: PlayersProps) {
  const groups = playerGroups(data.players);
  if (groups.length === 0) return null;
  return (
    <section className="team__block">
      <h3 className="team__title">Joueurs de l'équipe</h3>
      <div className="team__scroll">
        <table className="team__table">
          <thead>
            <tr><th scope="col">Pseudo</th><th scope="col">Games</th><th scope="col">Présence</th><th scope="col">Duels gagnés</th><th scope="col">Duels perdus</th></tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const sides = [g.bySide.left, g.bySide.right].filter((p) => p !== null);
              const won = sides.reduce((s, p) => s + p.duels_won, 0);
              const lost = sides.reduce((s, p) => s + p.duels_lost, 0);
              return (
                <tr key={g.key} className={selected === g.key ? 'is-selected' : ''}>
                  <th scope="row">
                    <button type="button" className="team__link" aria-pressed={selected === g.key} onClick={() => onPick(selected === g.key ? null : g.key)}>
                      {g.name}
                    </button>
                  </th>
                  <td>{g.games}</td>
                  <td>{formatTime(g.seconds)}</td>
                  <td>{won}</td>
                  <td>{lost}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
