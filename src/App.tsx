import { useState } from 'react';
import { Toolbar } from './components/Toolbar';
import { FloorSelector } from './components/FloorSelector';
import { DrawToolbar } from './components/DrawToolbar';
import { WeaponPanel } from './components/WeaponPanel';
import { MapCanvas } from './components/MapCanvas';
import { AnalysisTab } from './components/analysis/AnalysisTab';
import { WeaponsTab } from './components/analysis/WeaponsTab';
import './App.css';

type View = 'strategie' | 'analyse' | 'armes';

export default function App() {
  const [view, setView] = useState<View>('strategie');

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
          Armes
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
    </div>
  );
}
