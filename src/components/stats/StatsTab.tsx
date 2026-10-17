// Onglet Stats : filtres communs (carte, games, équipe suivie par nom, côté, joueur) et une vue à la fois : Récap (une game), Joueurs et Équipes (stats globales, toutes cartes), Équipe et Global (positions par carte),
// Présence, Rotations, Zones sûres, Plans (import EBP.GG). Par défaut, une seule game est retenue (la plus récente de la carte) ; le menu Games en ajoute. Récap, Rotations et Zones sûres rejouent une game à la fois
// (sélecteur « Game rejouée »), Présence additionne les games retenues ; Rotations garde un mode Cumul. Les vues Parcours, Morts et Retakes ont été retirées (16 octobre 2026).

import { useMemo, useState, type ReactNode } from 'react';
import { ClipboardList, Flame, Globe, ListChecks, Repeat, ShieldCheck, User, Users, UsersRound } from 'lucide-react';
import { filterByRoom } from '../../lib/roomFilter';
import { eligibleGames, pickGames, teamNames } from '../../lib/teamFollow';
import { StatsFilters, type StatsFilterState } from './StatsFilters';
import { StatsGlobal } from './StatsGlobal';
import { StatsPlans } from './StatsPlans';
import { StatsPlayers } from './StatsPlayers';
import { StatsPresence } from './StatsPresence';
import { StatsRecap } from './StatsRecap';
import { StatsRotations } from './StatsRotations';
import { StatsSafe } from './StatsSafe';
import { StatsTeam } from './StatsTeam';
import { StatsTeams } from './StatsTeams';
import { gameLabel, INITIAL_FILTERS, mapsOf, noticeOf, specOf, useStatsGames } from './useStats';

type View = 'recap' | 'joueurs' | 'equipes' | 'equipe' | 'global' | 'presence' | 'rotations' | 'safe' | 'plans';

const REPLAY_VIEWS: View[] = ['recap', 'rotations', 'safe'];

export function StatsTab() {
  const [view, setView] = useState<View>('recap');
  const [filters, setFilters] = useState<StatsFilterState>(INITIAL_FILTERS);
  const [replayId, setReplayId] = useState<number | null>(null);
  const gamesLoad = useStatsGames();
  const allGames = useMemo(() => gamesLoad.data ?? [], [gamesLoad.data]);
  const all = useMemo(() => filterByRoom(allGames, filters.room), [allGames, filters.room]); // contexte de jeu : toutes les games, intersalle ou même salle
  const maps = useMemo(() => mapsOf(all), [all]);
  // Carte affichée : le choix s'il existe encore, sinon la première
  const map = filters.map && maps.some(([name]) => name === filters.map) ? filters.map : (maps[0]?.[0] ?? null);
  const mapAll = useMemo(() => all.filter((g) => g.map === map), [all, map]);
  const teams = useMemo(() => teamNames(mapAll), [mapAll]);
  const spec = useMemo(() => specOf(filters), [filters]);
  // Games du réglage d'équipe et de côté, puis games retenues (par défaut la plus récente)
  const mapGames = useMemo(() => eligibleGames(mapAll, spec), [mapAll, spec]);
  const selected = useMemo(() => pickGames(mapGames, filters.chosen), [mapGames, filters.chosen]);
  // Game rejouée par Parcours, Morts, Retakes, Rotations et Zones sûres : le choix s'il est retenu, sinon la plus récente retenue
  const replay = selected.find((g) => g.id === replayId) ?? pickGames(selected, null)[0] ?? null;

  const notice = noticeOf(gamesLoad);

  const tab = (id: View, icon: ReactNode, label: string) => (
    <button type="button" role="tab" aria-selected={view === id} className={view === id ? 'is-active' : ''} onClick={() => setView(id)}>
      {icon} {label}
    </button>
  );

  return (
    <div className="stats">
      <div className="subtabs" role="tablist" aria-label="Vue des statistiques">
        {tab('recap', <ListChecks className="ic" />, 'Récap')}
        {tab('joueurs', <User className="ic" />, 'Joueurs')}
        {tab('equipes', <UsersRound className="ic" />, 'Équipes')}
        {tab('equipe', <Users className="ic" />, 'Équipe')}
        {tab('global', <Globe className="ic" />, 'Global')}
        {tab('presence', <Flame className="ic" />, 'Présence')}
        {tab('rotations', <Repeat className="ic" />, 'Rotations')}
        {tab('safe', <ShieldCheck className="ic" />, 'Zones sûres')}
        {tab('plans', <ClipboardList className="ic" />, 'Plans')}
      </div>
      {notice && <p className="stats__empty">{notice}</p>}
      {!notice && !map && <p className="stats__empty">Aucune game avec des positions lues. Lancer l'analyse détaillée d'une vidéo dans l'onglet Analyse (positions), puis calculer les statistiques : `python analysis/stats_run.py --game N`.</p>}
      {map && (
        <>
          <StatsFilters maps={maps} map={map} mapGames={mapGames} mapTotal={mapAll.length} selected={selected} teams={teams} state={filters} onChange={setFilters} />
          {selected.length > 1 && REPLAY_VIEWS.includes(view) && (
            <label className="stats__field">
              Game rejouée
              <select value={replay?.id ?? ''} onChange={(e) => setReplayId(Number(e.target.value))}>
                {selected.map((g) => (
                  <option key={g.id} value={g.id}>
                    {gameLabel(g)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {view === 'plans' ? (
            <StatsPlans map={map} />
          ) : view === 'joueurs' ? (
            <StatsPlayers map={map} spec={spec} />
          ) : view === 'equipes' ? (
            <StatsTeams map={map} spec={spec} />
          ) : view === 'global' ? (
            <StatsGlobal map={map} games={mapGames} spec={spec} />
          ) : view === 'equipe' ? (
            <StatsTeam map={map} games={mapGames} spec={spec} />
          ) : selected.length === 0 || !replay ? (
            <p className="stats__empty">
              {mapGames.length === 0 ? 'Aucune game de cette carte pour ce choix d\'équipe et de côté.' : 'Aucune game retenue : cocher au moins une game dans le menu Games.'}
            </p>
          ) : view === 'recap' ? (
            <StatsRecap map={map} replay={replay} spec={spec} />
          ) : view === 'presence' ? (
            <StatsPresence map={map} games={selected} spec={spec} />
          ) : view === 'rotations' ? (
            <StatsRotations map={map} games={selected} replay={replay} spec={spec} />
          ) : (
            <StatsSafe map={map} replay={replay} spec={spec} />
          )}
        </>
      )}
    </div>
  );
}
