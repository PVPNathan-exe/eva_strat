// Échange de deux joueurs d'une équipe à partir de l'instant affiché ; les échanges déjà faits sont listés et annulables.

import { useState } from 'react';
import { ArrowLeftRight, ArrowRight } from 'lucide-react';
import { analysisApi } from '../../../lib/analysisApi';
import { formatTime } from '../../../lib/timeline';
import type { Correction, Game } from '../../../types/analysis';
import { numberOfSlot } from './replayFrames';

const DURATIONS = [
  { label: 'jusqu\'à la fin de la game', seconds: Infinity },
  { label: 'pendant 60 s', seconds: 60 },
  { label: 'pendant 30 s', seconds: 30 },
  { label: 'pendant 10 s', seconds: 10 },
];

export function FixForm(props: {
  game: Game;
  time: number;
  nameOf: Map<number, string>;
  slots: number[];
  pickA: number | null;
  pickB: number | null;
  setPickA: (s: number | null) => void;
  setPickB: (s: number | null) => void;
  corrections: Correction[];
  onChanged: () => void;
}) {
  const { game, time, nameOf, slots, pickA, pickB, corrections } = props;
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const label = (slot: number) => `${numberOfSlot(slot)} · ${nameOf.get(slot) ?? 'joueur'}`;
  const sameTeam = pickA !== null && pickB !== null && (pickA <= 4) === (pickB <= 4);
  const optionsFor = (other: number | null) => slots.filter((s) => other === null || ((s <= 4) === (other <= 4) && s !== other));

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      props.onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const swap = () => {
    if (pickA === null || pickB === null) return;
    const end = DURATIONS[duration].seconds === Infinity ? game.end_s : Math.min(game.end_s, time + DURATIONS[duration].seconds);
    void run(() => analysisApi.swapPlayers(game.id, pickA, pickB, time, end));
  };

  return (
    <div className="replay__fixform">
      <div className="replay__fixrow">
        <select value={pickA ?? ''} onChange={(e) => { props.setPickA(e.target.value ? Number(e.target.value) : null); props.setPickB(null); }}>
          <option value="">Joueur A…</option>
          {slots.map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </select>
        <ArrowLeftRight className="ic" />
        <select value={pickB ?? ''} disabled={pickA === null} onChange={(e) => props.setPickB(e.target.value ? Number(e.target.value) : null)}>
          <option value="">Joueur B…</option>
          {optionsFor(pickA).map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </select>
      </div>
      <div className="replay__fixrow">
        <span>À partir de {formatTime(time - game.start_s)}</span>
        <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
          {DURATIONS.map((d, i) => <option key={d.label} value={i}>{d.label}</option>)}
        </select>
        <button disabled={!sameTeam || busy} onClick={swap}>Échanger</button>
      </div>
      {error && <p className="games__error">{error}</p>}
      {corrections.length > 0 && (
        <ul className="replay__fixlist">
          {corrections.map((c) => (
            <li key={c.id}>
              <span>
                {formatTime(c.t0 - game.start_s)} <ArrowRight className="ic" /> {formatTime(c.t1 - game.start_s)} : {nameOf.get(c.slot_a) ?? `n° ${numberOfSlot(c.slot_a)}`} <ArrowLeftRight className="ic" /> {nameOf.get(c.slot_b) ?? `n° ${numberOfSlot(c.slot_b)}`}
              </span>
              <button disabled={busy} onClick={() => void run(() => analysisApi.undoCorrection(c.id))}>Annuler</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
