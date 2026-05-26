import { Toolbar } from './components/Toolbar';
import { FloorSelector } from './components/FloorSelector';
import { DrawToolbar } from './components/DrawToolbar';
import { MapCanvas } from './components/MapCanvas';
import './App.css';

export default function App() {
  return (
    <div className="app">
      <Toolbar />
      <FloorSelector />
      <DrawToolbar />
      <main className="app__main">
        <MapCanvas />
      </main>
    </div>
  );
}
