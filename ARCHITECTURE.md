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

- Interface : une seule chose à l'écran à la fois. L'onglet Lecture a trois sous-onglets (`ReadingTab.tsx`) ; les cases de calques sont dans un menu « Calques » ou « Affichage » (`.menu`), les textes d'explication dans des `<details className="help">`, la liste des games (`GameList.tsx`) a une ligne par game et la game choisie se déplie, les réglages de la détection sont dans le menu « Options » de `IngestBar.tsx`, les commentaires sont repliés. `CorridorLegend.tsx` : légende de la carte des couloirs. `TeamRangeBar.tsx` : noms d'équipes (orange, bleue) par morceau de vidéo sur la ligne de « Ce que voit le programme » (bootcamp : équipes qui tournent), menu « Appliquer à… » et « Proposer d'après les pseudos » ; table `team_ranges`, API `GET/PUT /api/team-ranges`, `DELETE /api/team-ranges/:id`, `POST /api/team-ranges/apply?video=` ; `lib/teams.ts` : `teamTag`, `sideTags`, `teamRangesFromGames`.
- `AnalysisTab.tsx` : conteneur de l'onglet Analyse. `ReadingTab.tsx` : onglet Lecture (ce que le programme sait de la carte et la forme des joueurs lue) ; `CorridorMap.tsx` : couloirs, murs, tyroliennes, points de capture, étages superposés (passage en dessous), traits tracés et zones sur le plan ; `ShapeViewer.tsx` : disque et pointe de chaque joueur dessinés sur la vraie minimap de la vidéo ; `MarkPanel.tsx`, `useMarks.ts`, `markDraw.ts` : outil de correction à la main (position et regard posés sur la minimap, niveau étage ou dessous pour Atlantis et The Cliff, recalcul du suivi) ; `KillFlagsPanel.tsx` : kills marqués « libanaise » (le tueur collé à un mur tire à l'aveugle : la règle du kill ne s'applique pas). Cartographie à la main d'une carte (section pleine largeur de l'onglet Lecture) : `MapMapping.tsx` (outils Couleurs avec détection des pixels ambigus entre classes, Zones de classe (remplacer une classe par une autre dans un polygone), Tyroliennes en cercles avec direction, Portes et fenêtres en traits avec sens unique, traits de mur, Points de capture en forme libre, Départs, Alignement, enregistrer et appliquer), `MappingCanvas.tsx` (médiane au pixel près, aperçu des classes), `MappingShapes.tsx` (tracés vectoriels), `MappingColors.tsx` (loupe 15 x 15 et liste des couleurs), `MappingPlan.tsx` (repères sur le plan stratégique), `useMapAnnotation.ts` ; logique pure et testée dans `src/lib/mapAnnotation.ts`.
- `IngestBar.tsx` : source (chemin ou URL), « Détecter les games » (étape 1), options, progression (game en cours), pause et arrêt.
- `AnalysisPlan.tsx` : panneau « Analyse détaillée » : confirmation des bornes, games à analyser et leur ordre, lancement (étape 2).
- `GameList.tsx` : games d'une vidéo, bornes, carte, confirmation, suppression. `GameTeams.tsx` : noms des équipes orange et bleue d'une game (saisis, avec proposition tirée des pseudos).
- `SegmentTimeline.tsx` : frise des games. `VideoPlayer.tsx` : lecteur sur `/api/videos/:id/stream`. `PlayerControls.tsx` : barre de lecture.
- `VisionOverlay.tsx` : calques « ce que voit le programme » (dont le contrôle à la vraie minimap et les zones peu fiables). `useGameFlags.ts` : positions non confirmées, joueur observé et carte de fiabilité d'une game. `ReliabilityLayer.tsx` : cases douteuses sur le plan du replay. `CalibrationEditor.tsx` : zones du HUD par carte.
- `ReplayPanel.tsx` (549 lignes) : rejeu des positions sur le plan de la carte.
- `CommentsPanel.tsx` : commentaires liés à un instant, export texte.
- `WeaponsTab.tsx` : onglet Armes (recalcul des floues et signalées, verrouillage des modèles).
- `WeaponCard.tsx` : une icône (nom, verrou, étiquette floue, avis sur le nom deviné). `WeaponPrompt.tsx` : demande le nom des icônes inconnues après une analyse. `WeaponReport.tsx` : signalement et recalcul d'une icône.

### src/lib, src/store, src/types

- `lib/analysisApi.ts` : client HTTP de l'onglet Analyse et `subscribeJob` (SSE). `lib/timeline.ts` : fonctions pures de temps. `lib/comments.ts` : catégories et export. `lib/teams.ts` : diminutif d'équipe proposé par les pseudos.
- `lib/planInsets.ts` : cadre de la minimap sur le plan (aligné par `plan_align.py`, sinon approximatif) et projection. `lib/mapReading.ts` : masque, murs, tyroliennes et zones de départ d'une carte. `lib/pinShape.ts` : contour disque plus pointe d'un joueur.
- `lib/replayFlags.ts` : fonctions pures du contrôle à la minimap, du joueur observé et des cases douteuses. `lib/builtinMaps.ts`, `lib/storage.ts` (export JSON d'une carte), `lib/videoRef.ts` (référence au `<video>`), `lib/vision.ts` (calques).
- `lib/stuffs.ts` (371 lignes) : données des armes de l'onglet Stratégie. `lib/weaponCatalog.ts` : suggestions de noms. `lib/weaponNames.ts` : `canonicalName`.
- `store/mapStore.ts` (284 lignes) : état Stratégie, persisté. `store/analysisStore.ts` : état Analyse (vidéos, games, analyse en cours, armes, commentaires), non persisté.
- `types/analysis.ts`, `types/map.ts`, `types/stuff.ts` : types.

### src/styles

Point d'entrée `index.css` (l'ordre des imports est l'ordre de la cascade). **Les couleurs sont dans `tokens.css`** : les changer là pour tout le site.
`layout`, `tabs`, `ui-common` (aide repliable `.help`, sous-onglets `.subtabs`, menu de calques `.menu`, bloc replié `.fold`), `toolbar`, `canvas`, `draw-toolbar`, `floor-selector`, `weapon-panel`, `icons`, `comments`, `replay`, `replay-flags` (contrôle, observé, zones peu fiables), `analysis-reading` (onglet Lecture), `weapons-tab` (372 lignes), puis `analysis-shell`, `analysis-ingest`, `analysis-games`, `analysis-plan`, `analysis-player`, `analysis-timeline`, `analysis-vision`, `analysis-calibration`.

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
- `killfeed.py` : kills (texte lu par OCR, puis pseudos reconnus par leur aspect quand le texte échoue). `weapons.py` : modèles d'icônes (W killfeed, B armes, G gadgets), netteté (`edge_width`).
- `minimap.py` : pastilles sur la minimap. `positions.py` : lectures régulières. `tracking.py` : suivi dans le temps, attribution des joueurs 1 à 8 et passes finales (aller-retour, lecture isolée, pas impossible, lissage, séparation des joueurs ; tests dans `analysis/tests/test_postpasses.py`).
- `ocr.py` et `ocr_win.ps1` : reconnaissance de texte de Windows. `recap.py` : bilan de qualité par game.
- `icon_fix.py` : recalcul des icônes (`candidates`, `rebuild` avec marge élargie, `audit`, `guess`).
- Outils : `tune.py` (réglage du suivi), `evaluate.py` (accord avec les bandeaux, positions manquantes, sauts, test de trous simulés `--gap-test`), `benchmark.py` (vitesse), `build_templates.py` (chiffres du chrono).
- `reread_loadouts.py` : relit l'équipement d'une vidéo avec l'algorithme actuel et retire les icônes B et G devenues inutiles (sans nom, ni verrou, ni signalement).
- `frame_noise.py` : contamination de couleur de la minimap (stries de lumière qui ressemblent à des joueurs), mesurée à partir d'une carte grossière des couleurs d'équipe gardée à chaque lecture (`minimap.coarse_colour_map`) ; le suivi n'y crée ni trajectoire ni croix sans numéro.
- `observed_name.py` : pseudo du joueur observé lu en bas à droite de l'écran (images regroupées par ressemblance du texte, un représentant par groupe lu par la reconnaissance de texte de Windows) ; complète le cadre blanc des bandeaux, ne le contredit jamais.
- `marks_eval.py` : erreur du suivi (sans corrections) mesurée sur les positions et regards posés à la main ; `python analysis/marks_eval.py --game 26 [--all]`.
- `capture_points.py` : points de capture mobiles d'Outlaw (un seul actif à la fois, changement toutes les 1 min 30) : détection de la boîte active sur la minimap par écart à la médiane et filtres de forme, segments, nom du point (lettre la plus proche des indications tracées à la main), `python analysis/capture_points.py --game N [--store] [--write]` ; les boîtes d'une game vont dans la table `capture_boxes` (API `GET /api/capture-boxes?game=`), les positions vues et le calendrier des changements dans `map_capture_points.json` (lus par `src/lib/captureSchedule.ts` et `CaptureSchedule.tsx`, affichés sous la carte dans l'onglet Lecture avec les points vus de la game choisie). Les points jamais vus sur une minimap sont placés d'après les boîtes grises du plan stratégique (`--from-plan`, `plan_boxes`). `map_annotations.apply` grave les boîtes vues ou lues sur le plan à la place des polygones tracés (indications).
- Portes à bouton (Reef Point) : `db.button_doors_for` lit les portes opaques de `map_doors.json` ; `tracking.sight_blocked` les compte comme des murs pour la vue entre deux joueurs (`tracking.solve(..., doors=)`), les trajets les gardent praticables.
- `mask_clean.py` : nettoie les masques praticables (taches et trous minuscules), appelé à chaque « Appliquer » ; `python analysis/mask_clean.py [--write]`.
- `rotors.py` : anneaux tournants d'Engine (deux anneaux de murs autour du point central, extérieur horaire et intérieur anti-horaire, ouvertures qui tournent avec eux) : mesure de la vitesse sur les images de la minimap par balayage des vitesses (`python analysis/rotors.py --map Engine --game 30 --game 14 --game 21 [--write]`), modèle dans `map_rotors.json`, test « dans un arc plein à l'instant t » et déplacement vers l'ouverture la plus proche ; `tracking.rotor_snap` l'applique aux positions peu sûres. Le site les dessine à l'instant choisi (`src/lib/rotors.ts`, carte des couloirs).
- `map_tp.py` : stations de tyrolienne et paires de chaque carte (médiane native, sauts du suivi, trait pointillé) ; `python analysis/map_tp.py --all [--write]`. `map_spawn.py` : zones de départ des équipes ; `python analysis/map_spawn.py --all [--write]`. `plan_mask.py` : recoupe le masque saisi avec le plan stratégique (src/assets/maps/<Carte>.png, cadre d'alignement de la cartographie) : sol manquant à l'intérieur de l'arène ajouté, murs du plan retirés du praticable, option `usePlan` par carte (recoupe aussi avec les positions lues sûres : elles font foi, `map_annotations.reads_step`), hors-carte retiré, aperçus `<Carte>_plan_ajouts.png` et `_plan_retraits.png`, refus si plus de lectures sûres seraient refusées ou si le plan ajoute plus de 25 % du sol saisi. `map_annotations.py` : applique la cartographie faite à la main (traits et zones de classe « passage possible en dessous » : ils bloquent l'étage mais pas le niveau du dessous d'Atlantis et de The Cliff) (table `map_annotations`) : couleurs rangées en classes (sol, mur, tir par-dessus, vue seulement, porte, porte vitrée) vers `<Carte>.png` (praticable = sol, portes, zones de capture sous les pixels sans classe, tracé des tyroliennes entouré de sol ; fenêtres et traits de mur jamais praticables), `<Carte>_lignes.png` (murs) et `<Carte>_classes.png`, tyroliennes en paires de cercles (centres vers `map_teleports.json`, rayon et direction d'entrée et de sortie vers `map_stations.json`, valables dans les deux sens ; sous le trait entre les centres, un trait fin de la couleur des murs posé sur du sol devient praticable), portes, fenêtres, murs et tirs par-dessus tracés vers `map_doors.json` (sens unique : côté qui voit), zones de capture en polygones vers `map_capture.json`, zones de départ et disques des stations jouables dans le masque, masque non écrit si plus de 1 % des lectures sûres de la carte seraient refusées (le résumé donne la part), portes tracées vers `map_doors.json`, zones de départ (2 au plus par équipe, l'équipe sans zone saisie garde la détectée) vers `map_spawns.json`, alignement vers `map_plan_insets.json` ; `python analysis/map_annotations.py --map Atlantis`. `map_mask.py` : masque de chaque carte (couloirs sombres de Polaris, sol gris uni appris sur les lectures pour les autres) et `<Carte>_mediane.png`.
- `plan_align.py` : aligne la minimap sur le plan stratégique (traits de murs recalés sur les contours du plan) ; `python analysis/plan_align.py --map Polaris`, écrit `analysis/map_plan_insets.json`.
- `reliability.py` : carte des cases de la carte où positions et regards sont peu fiables (`analysis/map_reliability/<Carte>.json`) ; `python analysis/reliability.py --map Polaris`, lue par `tracking.py` et affichée par le site.
- `superpose.py` : vérifie le suivi en le superposant à la vraie minimap (une pastille de la couleur de l'équipe, ou un disque blanc pour l'observé, doit se trouver autour de chaque position) ; `python analysis/superpose.py --game 26 [--rows fichier.pkl]`, sans `--store`, aucune écriture dans la base ; avec `--store`, les positions non confirmées de toutes les images sont enregistrées (table `sample_flags`, affichées par le site). Le joueur observé est enregistré par périodes (table `observed_segments`) par `resolve.py` et par l'analyse.
- `resolve.py` : refait le suivi des positions d'une vidéo déjà analysée sans relire la vidéo (lectures en cache de `evaluate.py`).
- Données : `default_zones.json`, `map_teleports.json` (paires de stations de tyrolienne par carte : un joueur qui entre dans l'une ressort à l'autre), `map_spawns.json` (zones de départ par carte : un disque blanc « qui attend » hors de la zone de départ de son équipe, comme la boîte de capture de Polaris, est un joueur en jeu), `map_masks/<Carte>_lignes.png` (traits de murs blancs fixes de la minimap, retirés de la silhouette du disque du joueur observé avant de mesurer sa direction), `map_masks/` (masque des zones praticables par carte, image noir et blanc tirée de la médiane de la minimap, construit par `map_mask.py`, seulement pour les cartes dont le plan reste identique : Polaris), `map_zones.json` (minimap propre à chaque carte, entre la calibration de l'utilisateur et la zone par défaut), `tracking_params.json` (versionné), `*.npz` (modèles de chiffres et de croix), `weapon_icons/` (`names.json`, `reviews.json`, images), `map_names/`.
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
| GET | `/api/flags?game=`, `/api/reliability?map=` | positions non confirmées et joueur observé, carte de fiabilité |
| GET, POST, DELETE | `/api/marks?game=`, `/api/marks`, `/api/marks/:id` | corrections à la main (position, regard) |
| GET, PUT | `/api/kill-flags?game=`, `/api/kill-flags` | kills marqués « libanaise » (table `kill_flags`) |
| GET, PUT | `/api/map-annotations?map=` | cartographie à la main d'une carte (document JSON par carte) |
| POST | `/api/map-annotations/apply?map=` | traduit la cartographie en fichiers du programme (`map_annotations.py`) |
| POST | `/api/games/:id/resolve` | recalcule le suivi d'une game (lectures en cache et corrections), `server/analysisPlugin.ts` |
| GET, POST | `/api/comments` | lister (`?video=`) ou créer |
| PATCH, DELETE | `/api/comments/:id` | modifier ou supprimer |
| GET, POST, DELETE | `/api/corrections`, `/api/corrections/:id` | corrections de joueurs |
| GET, PUT | `/api/calibrations` | zones du HUD d'une carte |
| GET, PUT | `/api/teams` | diminutifs d'équipe et leur nom complet (ex. SNV : nom saisi) |

## Fichiers à surveiller (plus de 400 lignes)

- `analysis/tracking.py` : séparer trajectoires, vote des joueurs et paramètres.
- `src/components/analysis/ReplayPanel.tsx` (549) : extraire cadrage, horloge de lecture et dessin du plan.
- `src/components/MapCanvas.tsx` (516) : un module par outil de dessin et la sélection à part.
- `analysis/db.py` (402) : répartir les requêtes par domaine (games, kills, positions, commentaires).
