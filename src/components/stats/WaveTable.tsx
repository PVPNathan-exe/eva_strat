// Tableau par équipe de la vue Retakes : une ligne par équipe nommée (ou par côté quand la vidéo n'a pas de nom) avec ses vagues, retakes réussis et ratés,
// teamfights gagnés sans capture, vagues rapides et progressives, médiane de la durée du départ au premier kill et taux de retake réussi (masqué sous 5 vagues décidées).

import { formatSeconds, percent } from '../../lib/episodeFormat';
import { MIN_DECIDED, type TeamRow } from '../../lib/waveStats';

interface Props {
  rows: TeamRow[];
}

export function WaveTable({ rows }: Props) {
  if (rows.length === 0) return null;
  return (
    <div className="wtab" role="region" aria-label="Vagues par équipe" tabIndex={0}>
      <table>
        <thead>
          <tr>
            <th scope="col">Équipe</th>
            <th scope="col">Vagues</th>
            <th scope="col">Retakes réussis</th>
            <th scope="col">Retakes ratés</th>
            <th scope="col">Teamfights gagnés sans capture</th>
            <th scope="col">Rapides</th>
            <th scope="col">Progressives</th>
            <th scope="col">Départ au premier kill (médiane)</th>
            <th scope="col">Retake réussi</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <th scope="row">{r.label}</th>
              <td>{r.waves}</td>
              <td>{r.success}</td>
              <td>{r.fail}</td>
              <td>{r.won}</td>
              <td>{r.fast}</td>
              <td>{r.progressive}</td>
              <td>{r.medianToContactS !== null ? formatSeconds(r.medianToContactS) : 'aucun contact'}</td>
              <td title={r.rate === null ? `Masqué sous ${MIN_DECIDED} vagues décidées (${r.decided} ici)` : `${r.success} sur ${r.decided} vagues décidées`}>{r.rate !== null ? percent(r.rate) : `masqué (${r.decided})`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
