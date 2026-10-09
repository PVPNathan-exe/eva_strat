// Onglet Armes : toutes les icônes d'armes vues par l'analyse (killfeed, armes des bandeaux, gadgets), à nommer une fois pour toutes.
// Les noms sont enregistrés dans analysis/weapon_icons/names.json (versionné avec le projet). L'application les demande d'elle-même
// quand une icône est inconnue (voir WeaponPrompt) ; cet onglet sert à les revoir ou les corriger.

import { useEffect, useRef, useState } from 'react';
import { Layers, Loader2, Lock } from 'lucide-react';
import { analysisApi, bumpIconVersion } from '../../lib/analysisApi';
import { useAnalysisStore } from '../../store/analysisStore';
import type { IconWork, WeaponKind } from '../../types/analysis';
import { WeaponCard, WeaponSuggestions } from './WeaponCard';

const SECTIONS: { kind: WeaponKind; title: string; hint: string }[] = [
  { kind: 'arme', title: 'Armes des joueurs (bandeaux)', hint: "Les deux armes de chaque joueur, principale et secondaire : l'arme tenue est en noir sur le bandeau, l'autre en pâle." },
  { kind: 'killfeed', title: 'Armes du killfeed', hint: "L'icône entre le tueur et la victime. La petite cible est le marqueur de headshot : elle n'est pas comptée dans l'arme. Le logo de grenade (le même pour toutes les grenades) est reconnu tout seul et n'apparaît pas ici." },
  { kind: 'gadget', title: 'Gadgets (bandeaux)', hint: 'La troisième icône du bandeau.' },
];

export function WeaponsTab() {
  const weapons = useAnalysisStore((s) => s.weapons);
  const loadWeapons = useAnalysisStore((s) => s.loadWeapons);
  const nameWeapon = useAnalysisStore((s) => s.nameWeapon);
  const [onlyUnnamed, setOnlyUnnamed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Cases à cocher = icônes proposées comme modèles de référence, à verrouiller. Le recalcul par lots (icônes signalées) est lancé d'un clic.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batch, setBatch] = useState<string[]>([]);
  const [guessInfo, setGuessInfo] = useState<string | null>(null);
  const [works, setWorks] = useState<Record<string, IconWork>>({});
  const polling = useRef(0);

  useEffect(() => {
    void loadWeapons().catch((err: Error) => setError(err.message));
  }, [loadWeapons]);

  const rebuildable = (weapons ?? []).filter((w) => w.id[0] === 'B' || w.id[0] === 'G');
  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const finished = batch.filter((id) => works[id]?.state === 'done' || works[id]?.state === 'error');
  const running = batch.length > 0 && finished.length < batch.length;

  // À recalculer : les icônes signalées et celles que le programme juge floues (contour épais). Les modèles verrouillés ne bougent pas.
  const toRebuild = rebuildable.filter((w) => (w.reported || w.blurry) && !w.locked);

  /** Devine le nom des icônes sans nom par ressemblance avec les modèles verrouillés. */
  const guess = async () => {
    try {
      const r = await analysisApi.guessWeapons();
      setGuessInfo(r.locked === 0 ? "Aucun modèle verrouillé : verrouille d'abord des icônes nommées." : `${r.guessed} nom(s) deviné(s) d'après ${r.locked} modèle(s) verrouillé(s)`);
      await loadWeapons();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const startBatch = async () => {
    setError(null);
    await analysisApi.auditWeapons().catch(() => undefined); // mesure la netteté de tous les modèles avant de choisir lesquels refaire
    await loadWeapons();
    const ids = (useAnalysisStore.getState().weapons ?? []).filter((w) => (w.id[0] === 'B' || w.id[0] === 'G') && (w.reported || w.blurry) && !w.locked).map((w) => w.id);
    if (ids.length === 0) return;
    setGuessInfo(null);
    const mine = ++polling.current;
    setBatch(ids);
    try {
      // Tout est mis en file tout de suite (réponses immédiates) ; le serveur recalcule ensuite une icône après l'autre.
      for (const id of ids) await analysisApi.startIconWork(id, 'rebuild');
      for (;;) {
        const all = await analysisApi.allIconWork();
        if (polling.current !== mine) return;
        setWorks(all);
        if (ids.every((id) => all[id]?.state === 'done' || all[id]?.state === 'error')) break;
        await new Promise((r) => setTimeout(r, 2000));
      }
      bumpIconVersion();
      await loadWeapons();
      await guess(); // une fois recalculées, le programme essaie de nommer les icônes d'après les modèles verrouillés
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const lockSelected = async () => {
    setError(null);
    try {
      for (const id of selected) await analysisApi.reviewWeapon(id, { locked: true });
      setSelected(new Set());
      await loadWeapons();
    } catch (err) {
      setError((err as Error).message);
      await loadWeapons();
    }
  };

  const unlock = (id: string) => void analysisApi.reviewWeapon(id, { locked: false }).then(() => loadWeapons()).catch((err: Error) => setError(err.message));

  const unnamed = (weapons ?? []).filter((w) => !w.name).length;
  const save = (id: string, name: string) => void nameWeapon(id, name).catch((err: Error) => setError(err.message));

  return (
    <div className="weapons">
      <header className="weapons__head">
        <h2>Armes</h2>
        <span>{weapons ? `${weapons.length} icônes, ${unnamed} sans nom` : 'Chargement…'}</span>
        <label>
          <input type="checkbox" checked={onlyUnnamed} onChange={(e) => setOnlyUnnamed(e.target.checked)} />
          Seulement celles sans nom
        </label>
      </header>
      <p className="weapons__intro">
        Ces noms servent au programme (liste des kills, équipement des joueurs). L'arme d'un kill n'est plus lue sur le killfeed : c'est
        l'arme tenue (en noir) sur le bandeau du tueur juste avant le kill, et le gadget du tueur pour une grenade. Il ne reste ici
        que les icônes des bandeaux, et d'anciennes icônes de killfeed tant que des kills les utilisent encore. Les propositions viennent de l'onglet Stratégie, tu peux aussi écrire un autre nom. Plusieurs icônes peuvent porter le même
        nom (une même arme est parfois vue sous des aspects différents).
      </p>
      {rebuildable.length > 0 && (
        <div className="weapons__batch">
          <Layers className="ic" />
          <span>
            <b>Recalcul :</b> un clic mesure la netteté de chaque icône, garde celles qui sont nettes et refait les floues et les signalées, une par une (tu peux continuer à utiliser l'application). Si une icône reste floue, le programme élargit tout seul sa marge de lecture (plus d'images, d'autres games, d'autres joueurs). Puis le programme nomme tout seul celles qui
            ressemblent à un modèle verrouillé. Une forme qu'il ne connaît pas reste à nommer par toi (une arme peut venir d'un autre practice). <b>Cases à cocher :</b> coche les icônes bien nommées et bien lues pour en faire des modèles verrouillés : elles ne sont plus
            recalculées et servent de référence pour deviner les autres.
          </span>
          <button type="button" className="weapons__batch-go" onClick={() => void startBatch()} disabled={toRebuild.length === 0 || running}>
            {running ? <Loader2 className="ic ic--spin" /> : null} Recalculer les floues et signalées ({toRebuild.length})
          </button>
          <button type="button" onClick={() => void lockSelected()} disabled={selected.size === 0 || running}>
            <Lock className="ic" /> Verrouiller les cochées ({selected.size})
          </button>
          <button type="button" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>
            Tout décocher
          </button>
          {batch.length > 0 && (
            <strong>
              {finished.length} / {batch.length} terminées
              {running ? ` · en cours : ${batch.find((id) => works[id]?.state === 'running') ?? "file d'attente"}` : ''}
              {finished.some((id) => works[id]?.state === 'error') ? ` · ${finished.filter((id) => works[id]?.state === 'error').length} en erreur` : ''}
            </strong>
          )}
          {guessInfo && <strong>{guessInfo}</strong>}
        </div>
      )}
      {error && <p className="games__error">{error}</p>}
      {weapons && weapons.length === 0 && (
        <p className="games__empty">Aucune icône pour l'instant : lance « Analyser » sur une vidéo, les armes vues apparaîtront ici.</p>
      )}
      <WeaponSuggestions />
      {SECTIONS.map(({ kind, title, hint }) => {
        const list = (weapons ?? []).filter((w) => w.kind === kind && (!onlyUnnamed || !w.name));
        if (list.length === 0) return null;
        return (
          <section key={kind} className="weapons__section">
            <h3>
              {title} <small>({list.length})</small>
            </h3>
            <p className="weapons__hint">{hint}</p>
            <div className="weapons__grid">
              {list.map((w) => (
                <WeaponCard key={w.id} weapon={w} onName={save} selected={selected.has(w.id)} onSelect={w.id[0] === 'B' || w.id[0] === 'G' ? toggle : undefined} onUnlock={unlock} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
