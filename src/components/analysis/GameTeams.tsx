// Noms des deux équipes d'une game (orange à gauche, bleue à droite), pour les statistiques par équipe.
// Saisis par l'utilisateur ; le préfixe commun des pseudos est seulement proposé (toutes les équipes n'en ont pas, et ce n'est qu'un diminutif).

import { analysisApi } from '../../lib/analysisApi';
import { teamTag } from '../../lib/teams';
import { useAnalysisStore } from '../../store/analysisStore';
import type { Game } from '../../types/analysis';

type Side = 'team_a' | 'team_b';
const SIDES: { key: Side; label: string; slots: number[] }[] = [
  { key: 'team_a', label: 'Orange', slots: [1, 2, 3, 4] },
  { key: 'team_b', label: 'Bleue', slots: [5, 6, 7, 8] },
];

export function GameTeams({ game }: { game: Game }) {
  const teams = useAnalysisStore((s) => s.teams);
  const rememberTeam = useAnalysisStore((s) => s.rememberTeam);
  const refreshGames = useAnalysisStore((s) => s.refreshGames);

  const save = async (side: (typeof SIDES)[number], value: string, tag: string | null) => {
    const name = value.trim();
    if (name === (game[side.key] ?? '')) return;
    await analysisApi.patchGame(game.id, { [side.key]: name || null });
    if (tag && name && name.toUpperCase() !== tag) await rememberTeam(tag, name); // les prochaines games proposent ce nom complet
    await refreshGames();
  };

  return (
    <div className="game__teams">
      {SIDES.map((side) => {
        const tag = teamTag(game.players.filter((p) => side.slots.includes(p.slot)).map((p) => p.name));
        const suggestion = tag ? (teams[tag] ?? tag) : null;
        return (
          <label key={side.key} className="game__team">
            <span>{side.label}</span>
            <input
              key={`${game.id}-${side.key}-${game[side.key] ?? ''}`}
              defaultValue={game[side.key] ?? ''}
              placeholder={suggestion ? `Proposé : ${suggestion}` : "Nom de l'équipe"}
              maxLength={60}
              onBlur={(e) => void save(side, e.target.value, tag)}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
            {!game[side.key] && suggestion && (
              <button type="button" onClick={() => void save(side, suggestion, tag)} title="Utiliser la proposition tirée des pseudos">
                Appliquer
              </button>
            )}
          </label>
        );
      })}
    </div>
  );
}
