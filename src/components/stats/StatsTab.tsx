// Onglet Stats : filtres communs (carte, games, équipe, joueur) et une vue à la fois : Parcours, Morts, Présence, Zones sûres.
// Les vues Retakes et Rotations s'ajoutent ici quand elles sont livrées (docs/PLAN_STATS_AGENTS.md).

import { useMemo, useState } from 'react';
import { Flame, Route, ShieldCheck, Skull } from 'lucide-react';
import { StatsFilters, type StatsFilterState } from './StatsFilters';
import { StatsDeaths } from './StatsDeaths';
import { StatsPaths } from './StatsPaths';
import { StatsPresence } from './StatsPresence';
import { StatsSafe } from './StatsSafe';
import { INITIAL_FILTERS, mapsOf, noticeOf, useStatsGames } from './useStats';

type View = 'parcours' | 'morts' | 'presence' | 'safe';

export function StatsTab() {
  const [view, setView] = useState<View>('parcours');
  const [filters, setFilters] = useState<StatsFilterState>(INITIAL_FILTERS);
  const gamesLoad = useStatsGames();
  const all = useMemo(() => gamesLoad.data ?? [], [gamesLoad.data]);
  const maps = useMemo(() => mapsOf(all), [all]);
  // Carte affichée : le choix s'il existe encore, sinon la première
  const map = filters.map && maps.some(([name]) => name === filters.map) ? filters.map : (maps[0]?.[0] ?? null);
  const mapGames = useMemo(() => all.filter((g) => g.map === map), [all, map]);
  const selected = useMemo(() => mapGames.filter((g) => !filters.excluded.includes(g.id)), [mapGames, filters.excluded]);

  const notice = noticeOf(gamesLoad);
  const common = map ? { map, games: selected, team: filters.team, slot: filters.slot } : null;

  return (
    <div className="stats">
      <div className="subtabs" role="tablist" aria-label="Vue des statistiques">
        <button type="button" role="tab" aria-selected={view === 'parcours'} className={view === 'parcours' ? 'is-active' : ''} onClick={() => setView('parcours')}>
          <Route className="ic" /> Parcours
        </button>
        <button type="button" role="tab" aria-selected={view === 'morts'} className={view === 'morts' ? 'is-active' : ''} onClick={() => setView('morts')}>
          <Skull className="ic" /> Morts
        </button>
        <button type="button" role="tab" aria-selected={view === 'presence'} className={view === 'presence' ? 'is-active' : ''} onClick={() => setView('presence')}>
          <Flame className="ic" /> Présence
        </button>
        <button type="button" role="tab" aria-selected={view === 'safe'} className={view === 'safe' ? 'is-active' : ''} onClick={() => setView('safe')}>
          <ShieldCheck className="ic" /> Zones sûres
        </button>
      </div>
      {notice && <p className="stats__empty">{notice}</p>}
      {!notice && !common && <p className="stats__empty">Aucune game avec des positions lues. Lancer l'analyse détaillée d'une vidéo dans l'onglet Analyse (positions), puis calculer les statistiques : `python analysis/stats_run.py --game N`.</p>}
      {common && (
        <>
          <StatsFilters maps={maps} map={map} mapGames={mapGames} selected={selected} state={filters} onChange={setFilters} />
          {selected.length === 0 ? (
            <p className="stats__empty">Aucune game retenue : cocher au moins une game dans le menu Games.</p>
          ) : view === 'parcours' ? (
            <StatsPaths {...common} />
          ) : view === 'morts' ? (
            <StatsDeaths {...common} />
          ) : view === 'presence' ? (
            <StatsPresence {...common} />
          ) : (
            <StatsSafe {...common} />
          )}
        </>
      )}
    </div>
  );
}
