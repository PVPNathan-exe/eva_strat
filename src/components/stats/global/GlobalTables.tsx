// Tableaux de la vue Global : totaux par côté, issues des vagues de toutes les équipes, puis stratégies (issues par vitesse et par taille de vague).
// Une valeur null s'écrit « non établi » ; le taux de retake réussi est masqué sous MIN_DECIDED_WAVES vagues décidées.

import { sideTotals, sizeRows, speedRows, strategyAnswer, type StrategyRow } from '../../../lib/globalView';
import { MIN_DECIDED_WAVES, outcomeRows, percentText, shownRate } from '../../../lib/teamView';
import type { GlobalSummary } from '../../../types/statsTeam';

const NA = 'non établi';
const num = (v: number | null): string => (v === null ? NA : String(v));
const signed = (v: number | null): string => (v === null ? NA : v > 0 ? `+${v}` : String(v));
const plural = (n: number, word: string): string => `${n} ${word}${n > 1 ? 's' : ''}`;

/** Kills, morts et duels de chaque côté (toutes équipes confondues). */
export function SidesTable({ data }: { data: GlobalSummary }) {
  const left = sideTotals(data.left);
  const right = sideTotals(data.right);
  const rows: [string, string, string][] = [
    ['Kills', num(left.kills), num(right.kills)],
    ['Morts', num(left.deaths), num(right.deaths)],
    ['Kills moins morts', signed(left.diff), signed(right.diff)],
    ['Duels gagnés', String(left.duels.won), String(right.duels.won)],
    ['Duels perdus', String(left.duels.lost), String(right.duels.lost)],
    ['Part de duels gagnés', percentText(left.duelShare), percentText(right.duelShare)],
  ];
  return (
    <section className="global__block">
      <h3 className="global__title">Totaux par côté ({plural(data.games, 'game')})</h3>
      <div className="global__scroll">
        <table className="global__table">
          <thead>
            <tr>
              <th scope="col" />
              <th scope="col">Côté gauche (orange)</th>
              <th scope="col">Côté droit (bleu)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, a, b]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                <td>{a}</td>
                <td>{b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Issues des vagues de toutes les équipes de la carte. */
export function GlobalOutcomes({ data }: { data: GlobalSummary }) {
  const t = data.outcomes;
  const rows = outcomeRows(t);
  const rate = shownRate(t);
  return (
    <section className="global__block">
      <h3 className="global__title">Issues des vagues de toutes les équipes</h3>
      {rows.length === 0 ? (
        <p className="global__note">Aucune vague comptée pour ces games.</p>
      ) : (
        <div className="global__scroll">
          <table className="global__table">
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
      <p className="global__note">
        {plural(data.games, 'game')}, {plural(t.waves, 'vague')} comptée{t.waves > 1 ? 's' : ''}, {t.decided} décidée{t.decided > 1 ? 's' : ''}.{' '}
        {rate !== null ? `Taux de retake réussi : ${percentText(rate)}.` : `Taux de retake réussi masqué sous ${MIN_DECIDED_WAVES} vagues décidées.`}
      </p>
    </section>
  );
}

function StrategyTable({ title, rows }: { title: string; rows: StrategyRow[] }) {
  if (rows.length === 0) return <p className="global__note">{title} : aucune vague comptée.</p>;
  return (
    <div className="global__scroll">
      <table className="global__table">
        <thead>
          <tr><th scope="col">{title}</th><th scope="col">Vagues</th><th scope="col">Décidées</th><th scope="col">Retakes réussis</th><th scope="col">Taux</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <th scope="row">{r.label}</th>
              <td>{r.waves}</td>
              <td>{r.decided}</td>
              <td>{r.success}</td>
              <td>{r.rate === null ? `masqué (moins de ${MIN_DECIDED_WAVES} décidées)` : percentText(r.rate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Quelle stratégie a le plus marché : issues par vitesse puis par taille de vague, avec le meilleur taux quand on peut comparer. */
export function StrategyBlock({ data }: { data: GlobalSummary }) {
  const speeds = speedRows(data.outcomes.by_speed);
  const sizes = sizeRows(data.outcomes.by_size);
  return (
    <section className="global__block">
      <h3 className="global__title">Quelle stratégie a le mieux marché pour capturer ou recapturer ?</h3>
      <StrategyTable title="Vitesse de la vague" rows={speeds} />
      <p className="global__note">{strategyAnswer('Par vitesse', speeds, percentText)}</p>
      <StrategyTable title="Taille de la vague" rows={sizes} />
      <p className="global__note">{strategyAnswer('Par taille', sizes, percentText)}</p>
      <p className="global__note">Taux = retakes réussis sur (réussis + ratés + teamfights gagnés sans capture), toutes équipes et tous côtés confondus. Seules la vitesse et la taille de la vague sont calculées.</p>
    </section>
  );
}
