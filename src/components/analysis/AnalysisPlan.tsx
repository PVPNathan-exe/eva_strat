// Panneau « Analyse détaillée » : après la détection des games, l'utilisateur vérifie les bornes (liste des games et vidéo), puis choisit
// quelles games analyser et dans quel ordre (pour prioriser une carte). Lancer l'analyse confirme les bornes des games choisies.
// Ce qui est déjà lu et à jour est sauté par l'analyse : relancer ne recalcule rien d'inutile.

import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Play } from 'lucide-react';
import { formatTime } from '../../lib/timeline';
import { useAnalysisStore } from '../../store/analysisStore';
import type { Game } from '../../types/analysis';

export function AnalysisPlan() {
  const games = useAnalysisStore((s) => s.games);
  const job = useAnalysisStore((s) => s.job);
  const startAnalysis = useAnalysisStore((s) => s.startAnalysis);
  const selectGame = useAnalysisStore((s) => s.selectGame);
  const requestSeek = useAnalysisStore((s) => s.requestSeek);

  // Ordre d'analyse (identifiants) et cases cochées : initialisés à chaque changement de liste de games, par défaut les games pas encore analysées.
  const [order, setOrder] = useState<number[]>([]);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const signature = games.map((g) => `${g.id}:${g.samples > 0 ? 1 : 0}`).join(',');
  const [seen, setSeen] = useState('');
  if (seen !== signature) {
    // La liste des games (ou l'état d'analyse de l'une d'elles) a changé : on repart de l'ordre de la vidéo (ajustement pendant le rendu, sans effet).
    setSeen(signature);
    setOrder(games.map((g) => g.id));
    setChecked(new Set(games.filter((g) => g.samples === 0).map((g) => g.id)));
  }

  const byId = useMemo(() => new Map(games.map((g) => [g.id, g])), [games]);
  const rows = order.map((id) => byId.get(id)).filter((g): g is Game => !!g);
  const maps = [...new Set(games.map((g) => g.map).filter((m): m is string => !!m))];
  const chosen = order.filter((id) => checked.has(id));
  const toConfirm = games.filter((g) => g.status === 'detected').length;
  const withDoubts = games.filter((g) => g.doubts.length > 0).length;
  if (games.length === 0) return null;

  const toggle = (id: number) =>
    setChecked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const move = (id: number, delta: number) =>
    setOrder((cur) => {
      const i = cur.indexOf(id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= cur.length) return cur;
      const next = [...cur];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  // Une carte d'abord : ses games passent en tête (ordre de la vidéo conservé) et sont seules cochées.
  const prioritize = (map: string) => {
    if (!map) return;
    const first = rows.filter((g) => g.map === map).map((g) => g.id);
    setOrder([...first, ...order.filter((id) => !first.includes(id))]);
    setChecked(new Set(first));
  };

  return (
    <details className="plan" open>
      <summary>
        <strong>Analyse détaillée</strong>
        <span>
          {toConfirm > 0 ? `${toConfirm} game(s) à confirmer` : 'bornes confirmées'}
          {withDoubts > 0 ? `, ${withDoubts} avec des zones à vérifier` : ''}
        </span>
      </summary>
      <p className="plan__hint">
        Vérifie les bornes de chaque game (clique une ligne pour voir la vidéo, corrige dans la liste des games), puis choisis quoi analyser et dans quel
        ordre. Lancer l'analyse confirme les bornes des games cochées. Ce qui est déjà lu et à jour est sauté.
      </p>
      <div className="plan__tools">
        <button type="button" onClick={() => setChecked(new Set(order))} disabled={job.running}>Tout cocher</button>
        <button type="button" onClick={() => setChecked(new Set())} disabled={job.running}>Tout décocher</button>
        {maps.length > 1 && (
          <select value="" onChange={(e) => prioritize(e.target.value)} disabled={job.running} aria-label="Analyser une carte en premier">
            <option value="">Une carte d'abord…</option>
            {maps.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        )}
      </div>
      <ol className="plan__list">
        {rows.map((g, i) => {
          const n = games.findIndex((x) => x.id === g.id) + 1;
          return (
            <li key={g.id} className={`plan__row${checked.has(g.id) ? ' is-checked' : ''}`}>
              <input type="checkbox" checked={checked.has(g.id)} onChange={() => toggle(g.id)} disabled={job.running} aria-label={`Analyser la game ${n}`} />
              <button
                type="button"
                className="plan__name"
                onClick={() => {
                  selectGame(g.id);
                  requestSeek(g.start_s);
                }}
                title="Voir le début de cette game dans la vidéo"
              >
                Game {n} · {g.map ?? 'carte ?'} · {formatTime(g.start_s)} à {formatTime(g.end_s)}
              </button>
              <span className="plan__state">
                {g.samples > 0 ? 'analysée' : 'à analyser'}
                {g.status === 'detected' ? ' · à confirmer' : ''}
                {g.doubts.length > 0 ? ' · à vérifier' : ''}
              </span>
              <span className="plan__move">
                <button type="button" onClick={() => move(g.id, -1)} disabled={job.running || i === 0} aria-label="Monter dans l'ordre d'analyse">
                  <ArrowUp className="ic" />
                </button>
                <button type="button" onClick={() => move(g.id, 1)} disabled={job.running || i === rows.length - 1} aria-label="Descendre dans l'ordre d'analyse">
                  <ArrowDown className="ic" />
                </button>
              </span>
            </li>
          );
        })}
      </ol>
      <div className="plan__go">
        <button type="button" className="plan__run" disabled={job.running || chosen.length === 0} onClick={() => void startAnalysis(chosen)}>
          <Play className="ic" /> Analyser la sélection dans cet ordre ({chosen.length})
        </button>
        <button type="button" disabled={job.running} onClick={() => void startAnalysis(games.map((g) => g.id))} title="Toutes les games, dans l'ordre de la vidéo">
          Analyser toute la vidéo
        </button>
      </div>
    </details>
  );
}
