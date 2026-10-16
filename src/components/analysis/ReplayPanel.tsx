// Reconstruction d'une game sur le plan de sa carte, sous la vidéo : positions, regards, traînées, calques (zones peu fiables, zone de tir d'un joueur).
// Le temps suit la vidéo, ou une horloge propre (lecture, vitesse) pour rejouer sans la vidéo.
// Les positions sont normalisées sur la minimap du jeu : un cadre réglable (par carte) les ramène sur l'image du plan.
// Les morceaux sont dans review/ : horloge, données, plan, joueur choisi, notes de review (sans effet sur les données), zone de tir.

import { useMemo, useState } from 'react';
import { Layers, Pause, Play } from 'lucide-react';
import { builtinMaps } from '../../lib/builtinMaps';
import { defaultInset, insetStorageKey, project, type Inset } from '../../lib/planInsets';
import { observedAt, unconfirmedSet } from '../../lib/replayFlags';
import { gadgetChoices, noteMarks, type NoteShape } from '../../lib/reviewNotes';
import type { ZoneColors } from '../../lib/safeZones';
import { formatTime } from '../../lib/timeline';
import { getVideoElement } from '../../lib/videoRef';
import { DOOR_OPEN_M } from '../../lib/visibility';
import { USEFUL_FRACTION } from '../../lib/weaponRange';
import { useAnalysisStore } from '../../store/analysisStore';
import type { Game } from '../../types/analysis';
import type { ReviewNote } from '../../types/stats';
import { SafeZoneLayer } from '../stats/SafeZoneLayer';
import { tokenRgb } from '../stats/useStats';
import { KillList } from './review/KillList';
import { NotePanel } from './review/NotePanel';
import { boxStyleOf } from './review/notePlacement';
import { PlayerPanel } from './review/PlayerPanel';
import { computeTrails, formatFine, groupFrames, numberOfSlot, shownAt } from './review/replayFrames';
import { ReplayStage } from './review/ReplayStage';
import { ScoreChart } from './review/ScoreChart';
import { WEAPON_CHOICES, type WeaponChoice } from './review/shotZone';
import { useNoteDraft } from './review/useNoteDraft';
import { useReplayClock, RATES } from './review/useReplayClock';
import { useReplayData } from './review/useReplayData';
import { useReviewNotes } from './review/useReviewNotes';
import { useShotZone } from './review/useShotZone';
import { useGameFlags } from './useGameFlags';

const ZONE_ALPHA = 130; // opacité de la zone de tir, 0 à 255

// Cadre de la minimap dans l'image du plan (fractions des bords) : aligné automatiquement quand la carte a des traits de murs (planInsets.ts), sinon approximatif.
// Réglable à la main, mémorisé par carte.
function loadInset(map: string): Inset {
  try {
    const raw = localStorage.getItem(insetStorageKey(map));
    if (raw) return { ...defaultInset(map), ...(JSON.parse(raw) as Partial<Inset>) };
  } catch {
    // stockage indisponible : valeur par défaut
  }
  return defaultInset(map);
}

const metres = (m: number) => `${m.toFixed(m % 1 ? 1 : 0).replace('.', ',')} m`;

export function ReplayPanel({ game, large = false }: { game: Game; large?: boolean }) {
  const requestSeek = useAnalysisStore((s) => s.requestSeek);
  const { samples, error, capture } = useReplayData(game);
  const clock = useReplayClock(game);
  const { time } = clock;
  const reviewNotes = useReviewNotes(game.id);

  const [trails, setTrails] = useState(false);
  const [labels, setLabels] = useState(large); // pseudos affichés d'emblée dans la vue agrandie
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const [inset, setInset] = useState<Inset>(() => loadInset(game.map ?? ''));
  const [zonesPos, setZonesPos] = useState(false); // calque : positions peu fiables
  const [zonesGaze, setZonesGaze] = useState(false); // calque : regards peu fiables
  const [marks, setMarks] = useState(true); // anneau rouge sur les positions non confirmées par la vraie minimap
  const [selected, setSelected] = useState<number | null>(null); // joueur choisi : zone de tir, notes de review
  const [showNotes, setShowNotes] = useState(true); // notes de review dessinées sur le plan (dans leur fenêtre d'affichage)
  const [showZone, setShowZone] = useState(false); // calque : zone de tir de l'arme équipée du joueur choisi
  const [choice, setChoice] = useState<WeaponChoice>('longest');

  const nameOf = useMemo(() => new Map(game.players.map((p) => [p.slot, p.name])), [game.players]);
  const plan = useMemo(() => builtinMaps.find((m) => m.name === game.map), [game.map]);
  const frames = useMemo(() => (samples ? groupFrames(samples) : []), [samples]);
  const { flags, reliability } = useGameFlags(game.id, game.map, game.samples);
  const unconfirmed = useMemo(() => unconfirmedSet(flags), [flags]);

  const place = (x: number, y: number) => project(inset, x, y);
  const shown = useMemo(() => shownAt(frames, time).filter((p) => !hidden.has(p.slot)), [frames, time, hidden]);
  const observed = observedAt(flags, time);
  const trailPaths = useMemo(() => (trails ? computeTrails(frames, time, hidden, (x, y) => project(inset, x, y)) : null), [trails, frames, time, hidden, inset]);
  const slotsPresent = useMemo(() => {
    const set = new Set<number>();
    for (const f of frames) for (const s of f.bySlot.keys()) set.add(s);
    return [...set].sort((a, b) => a - b);
  }, [frames]);

  // Zone de tir du joueur choisi (calculée seulement quand le calque est affiché)
  const zone = useShotZone({ game, enabled: showZone, slot: selected, choice, frames, time });
  const zoneColors = useMemo<ZoneColors>(
    () => ({ a: tokenRgb('--c-owner-a', [255, 159, 28]), b: tokenRgb('--c-owner-b', [61, 139, 255]), contested: tokenRgb('--c-owner-none', [91, 99, 120]), alpha: ZONE_ALPHA }),
    [],
  );
  const zoneLayer =
    showZone && zone.zone && selected !== null ? (
      <SafeZoneLayer result={zone.zone.result} colors={zoneColors} boxStyle={boxStyleOf(inset)} outlines={selected} pins={false} show="shot" outlineKind="tir" />
    ) : null;

  // Notes de review : le brouillon (volet NotePanel) et le geste de pose sur le plan. Rien de cela ne modifie les données lues.
  const readAt = (slot: number, t: number) => {
    const p = shownAt(frames, t + game.start_s).find((q) => q.slot === slot && q.alive);
    return p ? { x: p.x, y: p.y } : null;
  };
  const gameT = time - game.start_s;
  const note = useNoteDraft({
    game,
    selected,
    time,
    inset,
    place,
    defaultGadget: gadgetChoices(reviewNotes.loadouts, selected, gameT).current,
    freeze: () => {
      getVideoElement()?.pause();
      if (!clock.follow && clock.playing) clock.seek(time);
    },
  });
  const gadgets = gadgetChoices(reviewNotes.loadouts, selected, note.draft.t);
  const draftShape: NoteShape | null = note.draft.kind === 'note' ? null : { kind: note.draft.kind, slot: note.draft.slot, t: note.draft.t, x: note.draft.x, y: note.draft.y, angle: note.draft.angle, gadget: note.draft.gadget };
  // Peu de notes visibles à la fois : recalculé à chaque image sans mémoïsation.
  const marksOnStage = noteMarks(showNotes ? reviewNotes.notes : [], draftShape, gameT, readAt);

  // Clic sur une pastille : elle devient le joueur choisi (ou le redevient aucun).
  const onDot = (slot: number) => setSelected(slot === selected ? null : slot);

  // Clic sur une note de la liste : le replay se place à son instant et son joueur est choisi.
  const openNote = (n: ReviewNote) => {
    clock.seek(game.start_s + n.t);
    if (n.slot !== null) setSelected(n.slot);
  };

  const changeInset = (patch: Partial<Inset>) => {
    const next = { ...inset, ...patch };
    setInset(next);
    try {
      if (game.map) localStorage.setItem(insetStorageKey(game.map), JSON.stringify(next));
    } catch {
      // stockage indisponible : le réglage vaut pour cette session seulement
    }
  };

  if (error) return <p className="games__error">{error}</p>;
  if (samples === null) return <p className="games__empty">Chargement des positions…</p>;
  if (frames.length === 0) return <p className="games__empty">Aucune position lue pour cette game. Lance « Analyser ».</p>;

  const range = zone.range;
  return (
    <div className={`replay${large ? ' replay--large' : ''}`}>
      <div className="replay__main">
        <ReplayStage
          plan={plan}
          place={place}
          trails={trailPaths}
          reliability={reliability}
          showPos={zonesPos}
          showGaze={zonesGaze}
          zoneLayer={zoneLayer}
          shown={shown}
          nameOf={nameOf}
          labels={labels}
          observed={observed}
          unconfirmed={unconfirmed}
          showUnconfirmed={marks}
          selected={selected}
          placing={note.active}
          noteMarks={marksOnStage}
          dragHandlers={note.handlers}
          onDot={onDot}
        />

        <div className="replay__bar">
          <button onClick={clock.togglePlay} title={clock.follow ? 'Rejouer sans la vidéo' : clock.playing ? 'Pause' : 'Lecture'}>
            {!clock.follow && clock.playing ? <Pause className="ic" /> : <Play className="ic" />}
          </button>
          <input type="range" min={game.start_s} max={game.end_s} step={0.1} value={time} onChange={(e) => clock.seek(Number(e.target.value))} />
          <span className="replay__time">
            {formatFine(time - game.start_s)} / {formatTime(game.end_s - game.start_s)}
          </span>
          <select value={clock.rate} onChange={(e) => clock.setRate(Number(e.target.value))} disabled={clock.follow}>
            {RATES.map((r) => (
              <option key={r} value={r}>{r}×</option>
            ))}
          </select>
        </div>

        {capture && (capture.A.length > 1 || capture.B.length > 1) && <ScoreChart capture={capture} start={game.start_s} end={game.end_s} time={time} onSeek={clock.seek} />}
      </div>

      <div className="replay__side">
        <div className="replay__opts">
          <label>
            <input type="checkbox" checked={clock.follow} onChange={(e) => clock.setFollowing(e.target.checked)} />
            Suivre la vidéo
          </label>
          <details className="menu replay__display">
            <summary>
              <Layers className="ic" /> Affichage
            </summary>
            <div className="menu__panel">
              <label>
                <input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} />
                Pseudos
              </label>
              <label>
                <input type="checkbox" checked={trails} onChange={(e) => setTrails(e.target.checked)} />
                Traînées
              </label>
              <label title="Anneau rouge : la vraie minimap n'a aucune pastille de cette équipe autour de la position calculée">
                <input type="checkbox" checked={marks} onChange={(e) => setMarks(e.target.checked)} />
                Positions non confirmées
              </label>
              {reliability && (
                <>
                  <label title="Cases de la carte où les positions se calculent mal">
                    <input type="checkbox" checked={zonesPos} onChange={(e) => setZonesPos(e.target.checked)} />
                    Zones : positions
                  </label>
                  <label title="Cases de la carte où les regards se lisent mal">
                    <input type="checkbox" checked={zonesGaze} onChange={(e) => setZonesGaze(e.target.checked)} />
                    Zones : regards
                  </label>
                </>
              )}
              <label title="Fantômes et gadgets des notes de review, de 3 s avant à 8 s après leur instant (aucun effet sur les données)">
                <input type="checkbox" checked={showNotes} onChange={(e) => setShowNotes(e.target.checked)} />
                Afficher les notes
              </label>
              <label title="Cases que les balles du joueur choisi peuvent atteindre, avec l'arme équipée à cet instant">
                <input type="checkbox" checked={showZone} onChange={(e) => setShowZone(e.target.checked)} />
                Zone de tir du joueur choisi
              </label>
              {showZone && (
                <label className="replay__field">
                  Arme
                  <select value={choice} onChange={(e) => setChoice(e.target.value as WeaponChoice)}>
                    {WEAPON_CHOICES.map((c) => (
                      <option key={c.id} value={c.id}>{c.label}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </details>
          {observed !== null && (
            <span className="replay__observed">
              Observé : n° {numberOfSlot(observed)}
              {nameOf.get(observed) ? ` · ${nameOf.get(observed)}` : ''}
            </span>
          )}
        </div>

        {(marks || zonesPos || zonesGaze || showZone) && (
          <div className="replay__key">
            {marks && <span><i className="key-unconfirmed" />position non confirmée par la vraie minimap</span>}
            {zonesPos && <span><i className="key-zone-pos" />zone où les positions se calculent mal</span>}
            {zonesGaze && <span><i className="key-zone-gaze" />zone où les regards se lisent mal</span>}
            {showZone && zone.notice && <span>{zone.notice}</span>}
            {showZone && !zone.notice && range && selected !== null && (
              <span>
                <i className="key-zone-shot" />
                zone de tir n° {numberOfSlot(selected)}
                {nameOf.get(selected) ? ` (${nameOf.get(selected)})` : ''} : {range.estimated ? 'portée estimée' : range.weapon} {range.open ? 'sans limite' : metres(range.rangeM)}
                {range.estimated && choice === 'held' ? ' (arme tenue non lue : médiane des armes de la game)' : range.estimated ? ' (équipement non lu : médiane des armes de la game)' : ''}
                {zone.equipment?.source === 'vie' ? `, équipement de sa vie ${(zone.equipment.lifeIdx ?? 0) + 1}` : ', équipement de la game'}
              </span>
            )}
          </div>
        )}
        {showZone && (
          <details className="help">
            <summary>Comment lire la zone de tir</summary>
            <p className="help__body">
              La zone colorée est celle que les balles du joueur choisi peuvent atteindre à l'instant affiché, dans toutes les directions (le regard n'est pas utilisé). Sa limite est la portée utile de l'arme :
              la distance jusqu'à laquelle les dégâts restent à {Math.round(USEFUL_FRACTION * 100)} % ou plus du maximum, d'après les bandes de dégâts de l'onglet Stratégie (sans limite s'ils ne tombent jamais sous ce seuil, ce qui est
              une hypothèse non vérifiée). Les murs, les vitres, les fenêtres et les portes fermées bloquent les balles ; une porte s'ouvre quand un joueur vivant, de n'importe quelle équipe, est à moins de {DOOR_OPEN_M} m (hypothèse).
              L'équipement vient de la lecture du bandeau pour chaque vie du joueur. <strong>L'arme tenue n'est fiable qu'à la mort du joueur</strong> : le choix « arme tenue » donne l'arme lue à sa mort, appliquée à toute la vie
              (une portée estimée est montrée quand elle n'est pas lue) ; pendant la vie, « la plus longue des deux armes » est la lecture prudente, la même que celle des zones sûres de l'onglet Stats. La zone est recalculée au quart
              de seconde : pendant la lecture elle avance par petits pas. Sur Atlantis et The Cliff le niveau du joueur vient des tyroliennes (étages mélangés quand il est inconnu). Une position peu sûre du suivi décale la zone.
            </p>
          </details>
        )}

        <div className="replay__legend">
          {slotsPresent.map((slot) => (
            <button
              key={slot}
              className={hidden.has(slot) ? 'is-off' : ''}
              style={{ ['--c' as string]: slot <= 4 ? 'var(--c-team-a)' : 'var(--c-team-b)' }}
              onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(slot)) n.delete(slot); else n.add(slot); return n; })}
              title={`${nameOf.get(slot) ?? 'Joueur'} · n° ${numberOfSlot(slot)} : afficher / masquer`}
            >
              {numberOfSlot(slot)}
            </button>
          ))}
        </div>

        <PlayerPanel slots={slotsPresent} nameOf={nameOf} selected={selected} onSelect={setSelected} />
        <NotePanel game={game} nameOf={nameOf} gadgets={gadgets} api={reviewNotes} note={note} onOpenNote={openNote} />

        <KillList game={game} time={time} nameOf={nameOf} onSeek={(t) => { clock.backToVideo(); requestSeek(t); }} />

        <details className="replay__align">
          <summary>Alignement sur le plan</summary>
          {(['l', 't', 'r', 'b'] as const).map((k) => (
            <label key={k}>
              {{ l: 'Gauche', t: 'Haut', r: 'Droite', b: 'Bas' }[k]}
              <input type="range" min={-0.05} max={0.2} step={0.002} value={inset[k]} onChange={(e) => changeInset({ [k]: Number(e.target.value) })} />
            </label>
          ))}
          <button onClick={() => changeInset(defaultInset(game.map ?? ''))}>Réinitialiser</button>
        </details>
      </div>
    </div>
  );
}
