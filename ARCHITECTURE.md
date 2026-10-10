# Architecture EVA Strat

Carte du projet pour retrouver vite quel fichier modifier. **À lire avant de chercher un fichier ou d'en créer un**, et à mettre à jour quand on ajoute, renomme ou supprime un fichier.
Chemins relatifs à la racine. Ignorés ici : `node_modules`, `dist`, `data`, `__pycache__`, `*.mp4`, les PNG de `weapon_icons`, `map_names`, `docs/superpowers`.
Les nombres de lignes ne sont donnés que pour les fichiers de plus de 300 lignes (état au 9 octobre 2026).

## Vue d'ensemble

- **Stratégie** : planificateur de carte (Konva et Zustand, sauvegarde automatique dans le navigateur).
- **Analyse** : lecture de vidéos EVA (Python, OpenCV, SQLite), pilotée depuis l'interface par un plugin du serveur Vite.
- **Armes** : nommage des icônes d'armes vues par l'analyse, avec modèles verrouillés et recalcul des icônes floues.

## Racine et configuration

- `README.md` : présentation et mode d'emploi. `CLAUDE.md` : règles de travail pour Claude Code. `docs/SKILLS_ET_OUTILS.md` : skills et outils utiles au projet.
- `package.json` : scripts npm (`setup`, `start`, `dev`, `build`, `lint`, `test:js`, `test:py`).
- `vite.config.ts` : configuration Vite, branche `analysisPlugin`. `tsconfig*.json` : TypeScript. `eslint.config.js` : lint. `pytest.ini` : tests Python (dossier `analysis/tests`).
- `index.html` : page d'entrée, charge `src/main.tsx`.

## src/

- `src/main.tsx` : point d'entrée React. `src/App.tsx` : coquille et onglets Stratégie, Analyse, Armes (importe `src/styles/index.css`).
- `src/index.css` : styles de base globaux (police, `box-sizing`, fond).
- `src/assets/maps/` : plans des cartes.

### src/components (onglet Stratégie)

- `Toolbar.tsx` : barre du haut, choix de carte, export et import JSON.
- `FloorSelector.tsx` : sélecteur d'étage (jusqu'à 3).
- `DrawToolbar.tsx` : outils de dessin, couleur, épaisseur.
- `MapCanvas.tsx` (516 lignes) : canevas Konva, image de fond et formes de l'étage courant.
- `WeaponPanel.tsx` : panneau des armes (stats, échelle, portée).

### src/components/analysis (onglets Analyse et Armes)

- `AnalysisTab.tsx` : conteneur de l'onglet Analyse.
- `IngestBar.tsx` : source (chemin ou URL), « Détecter les games » (étape 1), options, progression (game en cours), pause et arrêt.
- `AnalysisPlan.tsx` : panneau « Analyse détaillée » : confirmation des bornes, games à analyser et leur ordre, lancement (étape 2).
- `GameList.tsx` : games d'une vidéo, bornes, carte, confirmation, suppression. `GameTeams.tsx` : noms des équipes orange et bleue d'une game (saisis, avec proposition tirée des pseudos).
- `SegmentTimeline.tsx` : frise des games. `VideoPlayer.tsx` : lecteur sur `/api/videos/:id/stream`. `PlayerControls.tsx` : barre de lecture.
- `VisionOverlay.tsx` : calques « ce que voit le programme ». `CalibrationEditor.tsx` : zones du HUD par carte.
- `ReplayPanel.tsx` (549 lignes) : rejeu des positions sur le plan de la carte.
- `CommentsPanel.tsx` : commentaires liés à un instant, export texte.
- `WeaponsTab.tsx` : onglet Armes (recalcul des floues et signalées, verrouillage des modèles).
- `WeaponCard.tsx` : une icône (nom, verrou, étiquette floue, avis sur le nom deviné). `WeaponPrompt.tsx` : demande le nom des icônes inconnues après une analyse. `WeaponReport.tsx` : signalement et recalcul d'une icône.

### src/lib, src/store, src/types

- `lib/analysisApi.ts` : client HTTP de l'onglet Analyse et `subscribeJob` (SSE). `lib/timeline.ts` : fonctions pures de temps. `lib/comments.ts` : catégories et export. `lib/teams.ts` : diminutif d'équipe proposé par les pseudos.
- `lib/builtinMaps.ts`, `lib/storage.ts` (export JSON d'une carte), `lib/videoRef.ts` (référence au `<video>`), `lib/vision.ts` (calques).
- `lib/stuffs.ts` (371 lignes) : données des armes de l'onglet Stratégie. `lib/weaponCatalog.ts` : suggestions de noms. `lib/weaponNames.ts` : `canonicalName`.
- `store/mapStore.ts` (284 lignes) : état Stratégie, persisté. `store/analysisStore.ts` : état Analyse (vidéos, games, analyse en cours, armes, commentaires), non persisté.
- `types/analysis.ts`, `types/map.ts`, `types/stuff.ts` : types.

### src/styles

Point d'entrée `index.css` (l'ordre des imports est l'ordre de la cascade). **Les couleurs sont dans `tokens.css`** : les changer là pour tout le site.
`layout`, `tabs`, `toolbar`, `canvas`, `draw-toolbar`, `floor-selector`, `weapon-panel`, `icons`, `comments`, `replay`, `weapons-tab` (372 lignes), puis `analysis-shell`, `analysis-ingest`, `analysis-games`, `analysis-plan`, `analysis-player`, `analysis-timeline`, `analysis-vision`, `analysis-calibration`.

## server/

- `analysisPlugin.ts` (364 lignes) : plugin Vite, routes `/api/*` d'analyse (lancement, jobs, armes, vidéo en Range), choix de l'interpréteur Python. Le reste est délégué à `handleApi`.
- `api.ts` (359 lignes) : `handleApi`, routes REST (games, positions, commentaires, corrections, calibrations).
- `db.ts` : SQLite (`node:sqlite`) et schéma. `jobs.ts` : lance `analyze.py`, garde ses événements, pause, reprise, arrêt.
- `weapons.ts` : catalogue des icônes, noms (`names.json`), avis et verrous (`reviews.json`), noms déduits ou devinés.
- `guard.ts` : refuse les requêtes d'une autre origine. `range.ts` : en-tête HTTP Range. `filePicker.ts` : boîte « Ouvrir un fichier » de Windows.

## analysis/ (Python)

Pipeline : `analyze.py` (CLI principale, `run()`) enchaîne les étapes ci-dessous et écrit dans SQLite par `db.py` (schéma `schema.sql`, partagé avec `server/db.ts`).

- `ingest.py` : source (fichier ou URL yt-dlp). `segments.py` et `timer.py` : games d'après le chrono. `mapname.py` : nom de la carte. `names.py` : pseudos.
- `banners.py` : vivant ou mort, joueur observé. `loadout.py` : armes et gadget de chaque joueur. `capture.py` : pourcentages de capture.
- `killfeed.py` : kills. `weapons.py` : modèles d'icônes (W killfeed, B armes, G gadgets), netteté (`edge_width`).
- `minimap.py` : pastilles sur la minimap. `positions.py` : lectures régulières. `tracking.py` (598 lignes) : suivi dans le temps et attribution des joueurs 1 à 8.
- `ocr.py` et `ocr_win.ps1` : reconnaissance de texte de Windows. `recap.py` : bilan de qualité par game.
- `icon_fix.py` : recalcul des icônes (`candidates`, `rebuild` avec marge élargie, `audit`, `guess`).
- Outils : `tune.py` (réglage du suivi), `evaluate.py` (accord avec les bandeaux, positions manquantes, sauts, test de trous simulés `--gap-test`), `benchmark.py` (vitesse), `build_templates.py` (chiffres du chrono).
- `reread_loadouts.py` : relit l'équipement d'une vidéo avec l'algorithme actuel et retire les icônes B et G devenues inutiles (sans nom, ni verrou, ni signalement).
- `resolve.py` : refait le suivi des positions d'une vidéo déjà analysée sans relire la vidéo (lectures en cache de `evaluate.py`).
- Données : `default_zones.json`, `map_teleports.json` (paires de stations de tyrolienne par carte : un joueur qui entre dans l'une ressort à l'autre), `map_zones.json` (minimap propre à chaque carte, entre la calibration de l'utilisateur et la zone par défaut), `tracking_params.json` (versionné), `*.npz` (modèles de chiffres et de croix), `weapon_icons/` (`names.json`, `reviews.json`, images), `map_names/`.
- `analysis/tests/` : un `test_<module>.py` par module (`test_kills.py` fait 339 lignes).

## tests/ et scripts/

- `tests/*.test.ts` : fonctions pures du site. `tests/server/` : API, base, jobs, plage HTTP, garde, armes, sélecteur de fichier.
- `scripts/setup.mjs` : prépare le projet (npm, Python, ffmpeg) et, avec `--run`, lance le site. `scripts/crop_maps.py` : rogne les plans.
- `docs/` : `PLAN_RESTANT.md` (reste à faire), `PLAN_OPTIMISATIONS.md` (vitesse), `CHANGER_DE_PC.md` (reprise sur un autre PC).

## Flux principaux

**Analyse vidéo**
1. `IngestBar.tsx` (« Détecter les games », étape 1) puis `AnalysisPlan.tsx` (étape 2, `analysisStore.startAnalysis`) appellent `POST /api/ingest`.
2. `server/analysisPlugin.ts` valide et lance `analysis/analyze.py` par `server/jobs.ts` (réponse 202 avec `jobId`).
3. `analyze.py` : source, games, carte, pseudos, équipements, capture, kills, positions. Une vidéo sans aucune game s'arrête avec une erreur et n'est pas gardée.
4. Chaque étape écrit dans `data/eva.db` et émet une ligne JSON ; `jobs.ts` les relaie en SSE (`GET /api/jobs/:id/events`) vers `store.job`.
5. À la fin : mesure de netteté et nommage automatique des icônes, rechargement des vidéos et des games, puis `server/api.ts` sert les données aux panneaux.

**Armes**
1. `weapons.py` crée un modèle numéroté pour chaque icône inconnue. Les noms sont dans `names.json`, les avis et verrous dans `reviews.json` (lus et écrits par `server/weapons.ts`).
2. « Recalculer les floues et signalées » : `POST /api/weapons/audit` mesure, puis `icon_fix.py rebuild` refait chaque icône floue ou signalée en élargissant la marge de lecture tant qu'elle reste floue, puis `POST /api/weapons/guess` nomme celles qui ressemblent à un modèle verrouillé.
3. Un modèle verrouillé n'est jamais recalculé. Une forme inconnue reste à nommer par l'utilisateur.

## Endpoints de l'API

**`server/analysisPlugin.ts`**

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/api/videos/:id/stream` | vidéo locale (Range) |
| POST | `/api/ingest` | lance `analyze.py` (`detectOnly`, `redetect`, `games` = identifiants dans l'ordre voulu), renvoie `{ jobId }` |
| POST | `/api/pick-file` | boîte de fichier Windows |
| GET | `/api/jobs/current` | analyse en cours et pause |
| POST | `/api/jobs/:id/pause`, `/resume`, `/stop` | contrôle |
| GET | `/api/jobs/:id/events` | progression (SSE) |
| GET | `/api/weapons` | armes, avec netteté |
| POST | `/api/weapons/audit`, `/api/weapons/guess` | mesure de netteté, nommage automatique |
| GET | `/api/weapons/work` | état des travaux d'icônes |
| GET, POST | `/api/weapons/:id/work` | lire ou lancer `candidates` ou `rebuild` |
| GET | `/api/weapons/:id/candidates/:token.png`, `/api/weapons/:id/icon` | images |
| PUT | `/api/weapons/:id` | nommer une arme |
| POST | `/api/weapons/:id/review` | avis, signalement, verrouillage |

**`server/api.ts`**

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/api/videos` | vidéos analysées |
| GET, POST | `/api/games` | lister (`?video=`) ou créer |
| PATCH, DELETE | `/api/games/:id` | modifier ou supprimer |
| GET | `/api/samples?game=`, `/api/capture?game=` | positions, pourcentages de capture |
| GET, POST | `/api/comments` | lister (`?video=`) ou créer |
| PATCH, DELETE | `/api/comments/:id` | modifier ou supprimer |
| GET, POST, DELETE | `/api/corrections`, `/api/corrections/:id` | corrections de joueurs |
| GET, PUT | `/api/calibrations` | zones du HUD d'une carte |
| GET, PUT | `/api/teams` | diminutifs d'équipe et leur nom complet (ex. SNV : nom saisi) |

## Fichiers à surveiller (plus de 400 lignes)

- `analysis/tracking.py` (598) : séparer trajectoires, vote des joueurs et paramètres.
- `src/components/analysis/ReplayPanel.tsx` (549) : extraire cadrage, horloge de lecture et dessin du plan.
- `src/components/MapCanvas.tsx` (516) : un module par outil de dessin et la sélection à part.
- `analysis/db.py` (402) : répartir les requêtes par domaine (games, kills, positions, commentaires).
