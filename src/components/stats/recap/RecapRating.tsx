// Note sur 20 d'un joueur dans le Récap : trois colonnes (individuelle, teamplay, globale), cellules des lignes de joueur et de total, et détail dépliable
// (assistances et leur source, puis pour chaque sous-note la liste des composantes avec valeur brute, note sur 20 et poids ; une composante sans donnée dit pourquoi
// et reste hors de la moyenne pondérée). Conventions sans vérité terrain.

import { assistSourceText, coverageText, fmtRating, groupLines, ratingCell, type DetailLine } from '../../../lib/ratingFormat';
import type { RatingGroupDetail } from '../../../types/stats';
import type { RecapPlayer, RecapRating as Rating, RecapTeamRating } from '../../../types/statsRecap';
import '../../../styles/stats-rating.css';

/** Nombre de colonnes que les notes ajoutent au tableau du Récap. */
export const RATING_COLUMNS = 3;

/** En-têtes des trois colonnes de notes. */
export function RatingHeaders() {
  const hint = 'Note sur 20, 10 = médiane de la base. Convention, sans vérité terrain.';
  return (
    <>
      <th scope="col" title={`Individuelle : kills, morts et assistances du joueur, et qualité de ses kills et de ses morts. ${hint}`}>Individuelle /20</th>
      <th scope="col" title={`Teamplay : kills, morts et assistances comparés à son équipe, présence, espace, fight, aggro, trades, cohésion, secondaire. ${hint}`}>Teamplay /20</th>
      <th scope="col" title={`Globale : moyenne de l'individuelle et du teamplay. ${hint}`}>Globale /20</th>
    </>
  );
}

const MISSING = 'Aucune note calculée pour ce joueur dans cette game (lancer npm run stats -- --all).';

/** Une cellule de note : « n/d » avec la raison en infobulle quand elle n'est pas établie. */
function NoteCell({ value, why, strong }: { value: number | null | undefined; why?: string | null; strong?: boolean }) {
  const c = ratingCell(value, why);
  return (
    <td className={strong ? 'recap__overall' : undefined} title={c.title}>
      {c.text}
    </td>
  );
}

/** Cellules des trois notes d'un joueur. */
export function RatingCells({ player }: { player: RecapPlayer }) {
  const r = player.rating;
  const d = r?.detail ?? null;
  return (
    <>
      <NoteCell value={r?.individual} why={r ? d?.individual.reason : MISSING} />
      <NoteCell value={r?.teamplay} why={r ? d?.teamplay.reason : MISSING} />
      <NoteCell value={r?.overall} why={r ? (d?.overall_reason ?? undefined) : MISSING} strong />
    </>
  );
}

/** Cellules des notes d'une équipe : moyenne de ses quatre joueurs, « n/d » quand un joueur n'a pas la note. */
export function TeamRatingCells({ rating }: { rating: RecapTeamRating | undefined }) {
  const why = 'Moyenne des quatre joueurs de l\'équipe : non établie quand un joueur n\'a pas cette note.';
  return (
    <>
      <NoteCell value={rating?.individual} why={why} />
      <NoteCell value={rating?.teamplay} why={why} />
      <NoteCell value={rating?.overall} why={why} strong />
    </>
  );
}

/** Tableau des composantes d'un groupe. */
function Group({ title, group }: { title: string; group: RatingGroupDetail }) {
  const lines = groupLines(group);
  return (
    <section className="rating__group" aria-label={title}>
      <h4 className="rating__title">
        {title} : <b>{fmtRating(group.note)}</b> / 20
      </h4>
      {group.note === null && group.reason && <p className="rating__why">Note non établie : {group.reason}.</p>}
      <div className="rating__scroll">
        <table className="rating__table">
          <thead>
            <tr>
              <th scope="col">Composante</th>
              <th scope="col">Valeur</th>
              <th scope="col">Note /20</th>
              <th scope="col" title="Poids dans la moyenne pondérée de la sous-note">Poids</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l: DetailLine) => (
              <tr key={l.key} className={l.reason ? 'is-absent' : undefined}>
                <th scope="row">
                  {l.label}
                  {l.down && <span className="rating__down" title="Moins c'est mieux : la note est inversée"> (inversée)</span>}
                </th>
                <td>{l.value}</td>
                <td title={l.reason ?? undefined}>{l.reason ? 'n/d' : l.note}</td>
                <td>{l.weight}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {lines.some((l) => l.reason) && (
        <ul className="rating__absent">
          {lines
            .filter((l) => l.reason)
            .map((l) => (
              <li key={l.key}>
                {l.label} : ignorée de la moyenne ({l.reason}).
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}

/** Contenu de la ligne dépliée d'un joueur. */
export function RatingDetailPanel({ rating }: { rating: Rating | null }) {
  const detail = rating?.detail ?? null;
  if (!rating || !detail) {
    return (
      <p className="rating__why">
        Détail de la note non disponible pour ce joueur (lancer <code>npm run stats -- --all</code>).
      </p>
    );
  }
  const m = detail.meta;
  return (
    <div className="rating">
      <p className="rating__line">
        Assistances : <b>{rating.assists ?? 'n/d'}</b>, source : {assistSourceText(rating.assist_source)}. Kills {m.kills}, morts {m.deaths}, équipe : {m.team_kills} kills, {m.team_deaths} morts, {m.team_assists}{' '}
        assistances ; game de {m.game_minutes.toLocaleString('fr-FR')} min.
      </p>
      <div className="rating__groups">
        <Group title="Individuelle" group={detail.individual} />
        <Group title="Teamplay" group={detail.teamplay} />
      </div>
      <p className="rating__line">
        Poids disponibles : {coverageText(detail)}. {detail.overall_reason ? `Pas de note globale : ${detail.overall_reason}.` : 'Note globale = moyenne des deux sous-notes.'} Le regard de l'ennemi n'est pas utilisé pour la prise
        d'aggro (décision de l'utilisateur).
      </p>
    </div>
  );
}
