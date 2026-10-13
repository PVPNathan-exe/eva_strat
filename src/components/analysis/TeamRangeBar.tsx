// Noms d'équipes valables pour un morceau de la vidéo, sur la ligne de « Ce que voit le programme » : deux champs (orange, bleue) et un menu pour choisir le morceau.
// Bootcamp : une rediffusion de 4 à 5 heures où les équipes tournent. Les games dont le milieu tombe dans le morceau reçoivent les noms ; les morceaux sont retenus et s'appliquent
// aussi aux games détectées ou posées plus tard. « Proposer d'après les pseudos » découpe la vidéo là où les équipes changent, avec les diminutifs lus sur les bandeaux.

import { useCallback, useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { analysisApi } from '../../lib/analysisApi';
import { sideTags, teamRangesFromGames } from '../../lib/teams';
import { formatTime, parseTime } from '../../lib/timeline';
import { useAnalysisStore } from '../../store/analysisStore';
import type { TeamRange } from '../../types/analysis';

export function TeamRangeBar({ videoId, duration }: { videoId: number; duration: number }) {
  const games = useAnalysisStore((s) => s.games);
  const teams = useAnalysisStore((s) => s.teams);
  const currentTime = useAnalysisStore((s) => s.currentTime);
  const selected = useAnalysisStore((s) => s.games.find((g) => g.id === s.selectedGameId));
  const refreshGames = useAnalysisStore((s) => s.refreshGames);
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [from, setFrom] = useState('0:00');
  const [to, setTo] = useState(formatTime(duration));
  const [ranges, setRanges] = useState<TeamRange[]>([]);
  const [note, setNote] = useState<string | null>(null);

  const reload = useCallback(() => {
    analysisApi.teamRanges(videoId).then(setRanges).catch(() => setRanges([]));
  }, [videoId]);
  useEffect(reload, [reload]);

  // Proposition tirée des pseudos de la game choisie (ou de la première game qui en a) : le nom complet retenu d'un diminutif passe avant le diminutif.
  const source = selected && sideTags(selected).a ? selected : games.find((g) => sideTags(g).a || sideTags(g).b);
  const tags = source ? sideTags(source) : { a: null, b: null };
  const proposal = (tag: string | null) => (tag ? (teams[tag] ?? tag) : '');

  const run = async (action: () => Promise<{ games?: number } | unknown>, done: (r: { games?: number }) => string) => {
    try {
      const r = (await action()) as { games?: number };
      setNote(done(r));
      reload();
      await refreshGames();
    } catch (e) {
      setNote((e as Error).message);
    }
  };

  const apply = () => {
    const start = parseTime(from);
    const end = parseTime(to);
    const nameA = a.trim() || proposal(tags.a);
    const nameB = b.trim() || proposal(tags.b);
    if (start === null || end === null || end <= start) return setNote('Intervalle invalide (écris par exemple 0:00 et 1:22:53)');
    if (!nameA && !nameB) return setNote("Écris au moins un nom d'équipe");
    void run(() => analysisApi.putTeamRange({ video_id: videoId, start_s: start, end_s: end, team_a: nameA || null, team_b: nameB || null }), (r) => `${r.games ?? 0} game(s) mises à jour`);
  };

  const propose = async () => {
    const guesses = teamRangesFromGames(games, teams);
    if (guesses.length === 0) return setNote("Aucun diminutif lisible : les pseudos ne sont pas encore lus (lance « Analyser » sur quelques games).");
    await run(
      async () => {
        let total = 0;
        for (const g of guesses) total += (await analysisApi.putTeamRange({ video_id: videoId, start_s: g.start_s, end_s: g.end_s, team_a: g.team_a, team_b: g.team_b })).games;
        return { games: total };
      },
      (r) => `${guesses.length} morceau(x) créés, ${r.games ?? 0} game(s) mises à jour`,
    );
  };

  return (
    <div className="teambar">
      <span className="teambar__label">Équipes</span>
      <input className="teambar__input teambar__input--a" value={a} onChange={(e) => setA(e.target.value)} placeholder={proposal(tags.a) ? `Orange : ${proposal(tags.a)}` : 'Orange'} maxLength={60} aria-label="Nom de l'équipe orange" />
      <input className="teambar__input teambar__input--b" value={b} onChange={(e) => setB(e.target.value)} placeholder={proposal(tags.b) ? `Bleue : ${proposal(tags.b)}` : 'Bleue'} maxLength={60} aria-label="Nom de l'équipe bleue" />
      <details className="menu teambar__menu">
        <summary>
          <Users className="ic" /> Appliquer à… ({ranges.length})
        </summary>
        <div className="menu__panel teambar__panel">
          <div className="teambar__row">
            Du
            <input value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Début du morceau" />
            <button type="button" onClick={() => setFrom(formatTime(currentTime))}>lecture</button>
            au
            <input value={to} onChange={(e) => setTo(e.target.value)} aria-label="Fin du morceau" />
            <button type="button" onClick={() => setTo(formatTime(currentTime))}>lecture</button>
          </div>
          <button type="button" className="btn-primary" onClick={apply}>Appliquer aux games de ce morceau</button>
          <button type="button" onClick={() => void propose()}>Proposer d'après les pseudos</button>
          {note && <p className="teambar__note">{note}</p>}
          {ranges.length > 0 && (
            <ul className="teambar__list">
              {ranges.map((r) => (
                <li key={r.id}>
                  <span>
                    {formatTime(r.start_s)} à {formatTime(r.end_s)} : {r.team_a ?? '?'} contre {r.team_b ?? '?'}
                  </span>
                  <button type="button" onClick={() => void run(() => analysisApi.deleteTeamRange(r.id), () => 'Morceau oublié (les noms déjà donnés aux games restent)')}>Oublier</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>
    </div>
  );
}
