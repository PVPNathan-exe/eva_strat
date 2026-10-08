import { useEffect, useState } from 'react';
import { useAnalysisStore } from './store/analysisStore';
import { Toolbar } from './components/Toolbar';
import { FloorSelector } from './components/FloorSelector';
import { DrawToolbar } from './components/DrawToolbar';
import { WeaponPanel } from './components/WeaponPanel';
import { MapCanvas } from './components/MapCanvas';
import { AnalysisTab } from './components/analysis/AnalysisTab';
import { WeaponPrompt } from './components/analysis/WeaponPrompt';
import { WeaponsTab } from './components/analysis/WeaponsTab';
import './App.css';

type View = 'strategie' | 'analyse' | 'armes';

export default function App() {
  const [view, setView] = useState<View>('strategie');
  const weapons = useAnalysisStore((s) => s.weapons);
  const loadWeapons = useAnalysisStore((s) => s.loadWeapons);
  const resumeJob = useAnalysisStore((s) => s.resumeJob);
  const unnamed = (weapons ?? []).filter((w) => !w.name).length;

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
        <button className={view === 'strategie' ? 'is-active' : ''} onClick={() => setView('strategie')}>
          Stratégie
        </button>
        <button className={view === 'analyse' ? 'is-active' : ''} onClick={() => setView('analyse')}>
          Analyse
        </button>
        <button className={view === 'armes' ? 'is-active' : ''} onClick={() => setView('armes')}>
          Armes{unnamed > 0 && <span className="tabs__badge" title="Icônes d'armes à nommer">{unnamed}</span>}
        </button>
      </nav>
      {view === 'strategie' ? (
        <>
          <Toolbar />
          <FloorSelector />
          <DrawToolbar />
          <WeaponPanel />
          <main className="app__main">
            <MapCanvas />
          </main>
        </>
      ) : view === 'armes' ? (
        <WeaponsTab />
      ) : (
        <AnalysisTab />
      )}
      <WeaponPrompt />
    </div>
  );
}
