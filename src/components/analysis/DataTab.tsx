// Onglet Données (groupe Avancé) : place prise par la base et le cache, export et import en fichiers JSON vers un dossier (clé, disque externe, autre PC).
// La base reste sur le disque interne ; l'export écrit chaque game une seule fois (voir analysis/data_export.py).

import { useEffect, useState } from 'react';
import { Download, FolderOpen, HardDrive, Trash2, Upload } from 'lucide-react';
import { dataApi } from '../../lib/dataApi';
import { formatBytes } from '../../lib/formatBytes';
import { useAnalysisStore } from '../../store/analysisStore';
import type { DataUsage, ExportResult, ImportResult } from '../../types/data';

const FOLDER_KEY = 'eva.data.folder';

function savedFolder(): string {
  try {
    return localStorage.getItem(FOLDER_KEY) ?? '';
  } catch {
    return ''; // stockage indisponible : champ vide
  }
}

function UsageRow({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="data__row">
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <span className="data__note">{note}</span>}
    </div>
  );
}

export function DataTab() {
  const loadVideos = useAnalysisStore((s) => s.loadVideos);
  const bumpData = useAnalysisStore((s) => s.bumpData);
  const [usage, setUsage] = useState<DataUsage | null>(null);
  const [folder, setFolder] = useState(savedFolder);
  const [busy, setBusy] = useState<'usage' | 'export' | 'import' | 'purge' | 'pick' | null>('usage');
  const [error, setError] = useState<string | null>(null);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [exported, setExported] = useState<ExportResult | null>(null);
  const [imported, setImported] = useState<ImportResult | null>(null);

  // Première mesure à l'ouverture de l'onglet (les mesures suivantes suivent chaque action).
  useEffect(() => {
    let alive = true;
    dataApi
      .usage()
      .then((u) => alive && setUsage(u))
      .catch((err: Error) => alive && setError(err.message))
      .finally(() => alive && setBusy(null));
    return () => {
      alive = false;
    };
  }, []);

  const changeFolder = (value: string) => {
    setFolder(value);
    try {
      localStorage.setItem(FOLDER_KEY, value);
    } catch {
      // le dossier ne sera pas retenu pour la prochaine visite
    }
  };

  // Une action : message d'erreur effacé, bouton bloqué pendant qu'elle tourne, résultats précédents retirés.
  const run = async (kind: NonNullable<typeof busy>, action: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const pick = () =>
    run('pick', async () => {
      const { path } = await dataApi.pickFolder();
      if (path) changeFolder(path);
    });

  const doExport = () =>
    run('export', async () => {
      setImported(null);
      setExported(await dataApi.exportTo(folder.trim()));
      setUsage(await dataApi.usage());
    });

  const doImport = (dryRun: boolean) =>
    run('import', async () => {
      setExported(null);
      setImported(await dataApi.importFrom(folder.trim(), dryRun));
      if (!dryRun) {
        await loadVideos();
        await bumpData();
        setUsage(await dataApi.usage());
      }
    });

  const doPurge = () =>
    run('purge', async () => {
      setConfirmPurge(false);
      setUsage(await dataApi.purgeCache());
    });

  const working = busy !== null;
  const videosBytes = usage?.downloaded_videos.reduce((sum, v) => sum + v.bytes, 0) ?? 0;
  const backupsBytes = usage?.backups.reduce((sum, b) => sum + b.bytes, 0) ?? 0;

  return (
    <div className="data">
      <div className="advanced-note" role="note">
        <HardDrive className="ic" />
        <span>Onglet avancé : l'import écrit dans ta base (une copie est faite avant). La base doit rester sur le disque interne ; une clé ou un disque externe sert aux exports.</span>
      </div>

      {error && <p className="data__error" role="alert">{error}</p>}

      <div className="data__cols">
        <section className="data__card" aria-labelledby="data-usage">
          <h2 id="data-usage">Stockage</h2>
          {!usage ? (
            <p className="games__empty">Mesure en cours…</p>
          ) : (
            <>
              <UsageRow label="Base" value={formatBytes(usage.db_bytes + usage.db_journal_bytes)} note={`${usage.games ?? 0} games, dont ${usage.games_with_positions ?? 0} avec positions`} />
              {usage.bytes_per_analysed_game ? <UsageRow label="Par game analysée" value={formatBytes(usage.bytes_per_analysed_game)} note="estimation : base entière divisée par les games lues" /> : null}
              <UsageRow label="Sauvegardes à côté de la base" value={formatBytes(backupsBytes)} note={`${usage.backups.length} fichier(s) eva.avant-*.db : à supprimer à la main quand elles ne servent plus`} />
              <div className="data__row">
                <span>Lectures gardées</span>
                <strong>{formatBytes(usage.eval_cache_bytes)}</strong>
                {confirmPurge ? (
                  <span className="data__confirm">
                    Elles se refont (1 à 2 minutes par game).
                    <button type="button" onClick={() => void doPurge()} disabled={working}>
                      Oui, effacer
                    </button>
                    <button type="button" onClick={() => setConfirmPurge(false)}>
                      Annuler
                    </button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setConfirmPurge(true)} disabled={working || usage.eval_cache_bytes === 0}>
                    <Trash2 className="ic" /> Effacer
                  </button>
                )}
              </div>
              <UsageRow label="Vidéos téléchargées" value={formatBytes(videosBytes)} note={`${usage.downloaded_videos.length} fichier(s) : jamais effacées ici (la base en garde le chemin), à supprimer à la main`} />
              <UsageRow label="Icônes d'armes" value={formatBytes(usage.icons_bytes)} />
              {usage.warning && <p className="data__error" role="alert">{usage.warning}</p>}
              {usage.purged && <p className="data__ok">Effacé : {usage.purged.files} fichier(s), {formatBytes(usage.purged.bytes)}.</p>}
              <details className="help">
                <summary>Où sont mes données ?</summary>
                <p className="help__body">
                  Base : <code>{usage.db_path}</code>. Cache : <code>{usage.cache_path}</code>. Pour les mettre ailleurs, avant de lancer le site : variables d'environnement <code>EVA_DATA_DIR</code> (dossier des données), <code>EVA_DB</code> (fichier de la base) et <code>EVA_CACHE</code> (cache seul). Voir le README.
                </p>
              </details>
            </>
          )}
        </section>

        <section className="data__card" aria-labelledby="data-exchange">
          <h2 id="data-exchange">Export et import</h2>
          <label className="data__folder">
            Dossier
            <input value={folder} onChange={(e) => changeFolder(e.target.value)} placeholder="Ex. E:\Sauvegarde EVA (clé, disque externe ou dossier)" disabled={working} />
            <button type="button" onClick={() => void pick()} disabled={working}>
              <FolderOpen className="ic" /> Parcourir…
            </button>
          </label>
          <div className="data__actions">
            <button type="button" className="btn-primary" onClick={() => void doExport()} disabled={working || !folder.trim()} title="Écrit chaque game dans un fichier du dossier ; un deuxième export ne réécrit que ce qui a changé">
              <Upload className="ic" /> {busy === 'export' ? 'Export…' : 'Exporter'}
            </button>
            <button type="button" onClick={() => void doImport(true)} disabled={working || !folder.trim()} title="Compte ce qui serait ajouté, sans rien écrire">
              Voir ce qui serait importé
            </button>
            <button type="button" onClick={() => void doImport(false)} disabled={working || !folder.trim()} title="Ajoute les games absentes de la base (celles déjà présentes sont gardées telles quelles)">
              <Download className="ic" /> {busy === 'import' ? 'Import…' : 'Importer'}
            </button>
          </div>

          {exported && (
            <p className="data__ok">
              {exported.games} game(s) exportée(s) : {exported.files_written} fichier(s) écrit(s), {exported.files_unchanged} déjà à jour, {formatBytes(exported.bytes)} au total.
              {exported.icons_without_image > 0 && ` ${exported.icons_without_image} icône(s) citée(s) sans image.`}
              {exported.orphans.length > 0 && ` ${exported.orphans.length} fichier(s) du dossier ne correspondent plus à une game de la base (laissés en place).`}
            </p>
          )}
          {imported && (
            <p className="data__ok">
              {imported.dry_run ? 'Simulation : ' : ''}
              {imported.imported} game(s) {imported.dry_run ? 'seraient importées' : 'importée(s)'}, {imported.skipped} déjà présente(s) (gardées telles quelles).
              {imported.icons_created > 0 && ` ${imported.icons_created} icône(s) d'arme ajoutée(s).`}
              {imported.missing_videos.length > 0 && ` Vidéo(s) introuvable(s) sur ce disque : ${imported.missing_videos.join(', ')} (corrige le chemin, voir le README).`}
              {imported.backup && ` Copie de la base avant l'import : ${imported.backup}.`}
            </p>
          )}

          <details className="help">
            <summary>Pourquoi des fichiers, et pas la base sur la clé ?</summary>
            <p className="help__body">
              Lire une clé ne l'use pas, mais la base écrit sans cesse et un débranchement en cours d'écriture peut la corrompre. L'export écrit chaque game une seule fois, d'un bloc, en JSON compressé : lisible par n'importe quel outil, et environ cinq fois plus petit que la base (mesuré : 32 games en 5 Mo contre 23 Mo). Importer ajoute les games absentes et ne touche jamais celles qui sont déjà là.
            </p>
          </details>
        </section>
      </div>
    </div>
  );
}
