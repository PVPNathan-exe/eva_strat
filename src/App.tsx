import { useEffect, useState } from 'react';
import { useAnalysisStore } from './store/analysisStore';
import { Toolbar } from './components/Toolbar';
import { FloorSelector } from './components/FloorSelector';
import { DrawToolbar } from './components/DrawToolbar';
import { WeaponPanel } from './components/WeaponPanel';
import { MapCanvas } from './components/MapCanvas';
import { AnalysisTab } from './components/analysis/AnalysisTab';
import { DataTab } from './components/analysis/DataTab';
import { ReadingTab } from './components/analysis/ReadingTab';
import { PatchNotice } from './components/PatchNotice';
import { StatsTab } from './components/stats/StatsTab';
import { WeaponPrompt } from './components/analysis/WeaponPrompt';
import { WeaponsTab } from './components/analysis/WeaponsTab';
import './styles/index.css';

type View = 'strategie' | 'analyse' | 'stats' | 'lecture' | 'armes' | 'donnees';

export default function App() {
  const [view, setView] = useState<View>('strategie');
  const weapons = useAnalysisStore((s) => s.weapons);
  const loadWeapons = useAnalysisStore((s) => s.loadWeapons);
  const resumeJob = useAnalysisStore((s) => s.resumeJob);
  const viewRequest = useAnalysisStore((s) => s.viewRequest);
  const unnamed = (weapons ?? []).filter((w) => !w.name).length;

  // Un lien venu d'un autre onglet (ex. « Vu dans » des armes) ouvre l'onglet Analyse.
  const [seenRequest, setSeenRequest] = useState(viewRequest);
  if (viewRequest !== seenRequest) {
    setSeenRequest(viewRequest);
    if (viewRequest) setView(viewRequest.view);
  }

  // Compteur d'icônes sans nom sur l'onglet Armes (si le serveur d'analyse n'est pas joignable, il n'y en a simplement pas).
  useEffect(() => {
    void loadWeapons().catch(() => undefined);
  }, [loadWeapons]);

  // Après un rechargement de la page, on se reconnecte à l'analyse en cours (progression, pause, arrêt).
  useEffect(() => {
    void resumeJob().catch(() => undefined);
  }, [resumeJob]);

  return (
    <div className="app">
      <nav className="tabs">
        <h1 className="tabs__brand">EVA Strat</h1>
        <button className={view === 'strategie' ? 'is-active' : ''} onClick={() => setView('strategie')}>
          Stratégie
        </button>
        <button className={view === 'analyse' ? 'is-active' : ''} onClick={() => setView('analyse')}>
          Analyse
        </button>
        <button className={view === 'stats' ? 'is-active' : ''} onClick={() => setView('stats')}>
          Stats
        </button>
        <button className={view === 'armes' ? 'is-active' : ''} onClick={() => setView('armes')}>
          Armes{unnamed > 0 && <span className="tabs__badge" title="Icônes d'armes à nommer">{unnamed}</span>}
        </button>
        <span className="tabs__sep" aria-hidden="true" />
        <span className="tabs__group" title="Réglages du programme : ce qui est modifié ici peut changer les calculs de l'analyse">
          Avancé
        </span>
        <button className={view === 'lecture' ? 'is-active' : ''} onClick={() => setView('lecture')}>
          Lecture
        </button>
        <button className={view === 'donnees' ? 'is-active' : ''} onClick={() => setView('donnees')}>
          Données
        </button>
      </nav>
      <PatchNotice />
      {view === 'strategie' ? (
        <>
          <div className="strat-bars">
            <Toolbar />
            <FloorSelector />
            <DrawToolbar />
            <WeaponPanel />
          </div>
          <main className="app__main">
            <MapCanvas />
          </main>
        </>
      ) : view === 'stats' ? (
        <StatsTab />
      ) : view === 'armes' ? (
        <WeaponsTab />
      ) : view === 'lecture' ? (
        <ReadingTab />
      ) : view === 'donnees' ? (
        <DataTab />
      ) : (
        <AnalysisTab />
      )}
      <WeaponPrompt />
    </div>
  );
}
