// Écran de review : la reconstruction de la game choisie, sous la vidéo et sur toute la largeur utile.
// Sans quitter cet écran : choisir un joueur, écrire des notes de review (sans effet sur les données), afficher sa zone de tir (voir ReplayPanel).

import type { Game } from '../../../types/analysis';
import { ReplayPanel } from '../ReplayPanel';

export function ReviewScreen({ game, number, onEnlarge }: { game: Game | undefined; number: number; onEnlarge: () => void }) {
  if (!game) return <p className="games__empty">Choisis une game dans la liste pour afficher sa reconstruction sous la vidéo.</p>;
  if (game.samples <= 0) return <p className="games__empty">La game {number} n'a pas encore de positions lues : lance « Analyser » dans la liste des games.</p>;
  return (
    <section className="review replay-box">
      <header>
        <strong>
          Reconstruction · Game {number}
          {game.map ? ` · ${game.map}` : ''}
        </strong>
        <button onClick={onEnlarge}>Agrandir</button>
      </header>
      <ReplayPanel key={`${game.id}-${game.map}`} game={game} />
    </section>
  );
}
