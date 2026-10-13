# EVA Strat : synthèse technique du projet

Document destiné à une IA qui n'a pas accès aux fichiers. État du code au 13 octobre 2026. Chemins relatifs à la racine du projet (sur la machine de l'utilisateur : `C:\Users\eloua\Downloads\eva_strat-main\eva_strat-main`). Tout ce qui suit a été lu dans le code ; les points non vérifiés sont signalés.

---

## 1. VUE D'ENSEMBLE

### But
- Outil personnel d'analyse tactique pour le jeu de tir en arène **EVA** (2 équipes de 4 joueurs, 9 cartes jouées : Polaris, Silva, Engine, Atlantis, Ceres, Reef Point, Outlaw, The Cliff, Artefact).
- Public : un joueur ou un coach qui revoit des rediffusions (VOD YouTube, rediffs de bootcamp de 4 à 5 h).
- Fonctionnement :
  1. on charge une vidéo .mp4 (ou une URL YouTube) ;
  2. le programme repère les games en lisant le chrono du HUD ;
  3. il lit, game par game, les pseudos, l'équipement, le score de capture, le killfeed, et surtout la **position et le regard des 8 joueurs sur la minimap** ;
  4. le tout est rejoué sur le plan de la carte.
- Un onglet Stratégie séparé sert à dessiner des plans tactiques sur les cartes.

### Les 4 onglets (premier niveau, `src/App.tsx`)
| Onglet | Rôle |
|---|---|
| Stratégie | dessin sur le plan d'une carte (traits, rectangles, cercles, crayon), 3 étages max, pose d'armes avec leur portée à l'échelle, sauvegarde dans le navigateur, export et import JSON |
| Analyse | chargement d'une vidéo, détection des games, analyse détaillée, lecteur vidéo, calques « Ce que voit le programme », replay sur le plan, commentaires |
| Lecture | ce que le programme sait d'une carte (couloirs, murs, tyroliennes, zones de départ, points de capture), formes des joueurs dessinées sur la vraie minimap, corrections à la main, cartographie à la main qui fabrique les masques des cartes |
| Armes | nommage des icônes d'armes et de gadgets vues par l'analyse, verrouillage, recalcul des icônes floues |

### Stack technique
| Partie | Technologie | Rôle |
|---|---|---|
| Interface | React 19, TypeScript 6, Vite 8 | site monopage |
| Dessin | `konva` 10 + `react-konva` | canevas de l'onglet Stratégie |
| État | `zustand` 5 (middleware `persist`) | `mapStore` (persisté en localStorage), `analysisStore` (non persisté) |
| Icônes | `lucide-react` | toutes les icônes (aucun emoji ni pictogramme Unicode autorisé) |
| Serveur | plugin Vite (`server/analysisPlugin.ts`), Node 22+ | routes `/api/*`, lancement des scripts Python, flux SSE, lecture vidéo par plages HTTP |
| Base | SQLite : `node:sqlite` (`DatabaseSync`) côté Node, `sqlite3` côté Python | fichier `data/eva.db`, schéma commun `analysis/schema.sql` |
| Analyse | Python 3.10+ | dossier `analysis/` |
| Vision | OpenCV (`opencv-python`, importé `cv2`), NumPy | seuils HSV, contours, moments, corrélation de modèles, k-means |
| Décodage | `ffmpeg` / `ffprobe` (exécutables dans le PATH) | extraction de zones d'image en flux brut BGR, métadonnées |
| Téléchargement | `yt-dlp` | URL YouTube vers .mp4 (souvent bloqué par YouTube : le README conseille 4K Video Downloader) |
| Reconnaissance de texte | OCR intégré à Windows (WinRT `Windows.Media.Ocr`) appelé par PowerShell (`analysis/ocr_win.ps1`) | pseudos, killfeed, pseudo du joueur observé |
| Tests | `node --test` (pas de vitest), `pytest` | `tests/`, `analysis/tests/` |

Dépendances Python : `analysis/requirements.txt` = `opencv-python`, `numpy`, `yt-dlp`, `pytest`. Sur ce PC : Python 3.12 et OpenCV 5.0.0 sont installés, et les 288 tests Python passent.

### Lancer l'application
```powershell
npm start            # installe ce qui manque (npm, paquets Python, ffmpeg par winget) puis lance le site
npm run setup        # installation seule
npm run dev          # site + API sur http://localhost:5173 (l'API n'existe qu'en mode dev, pas avec vite preview)
npx tsc -b           # typage
npm run test:js      # tests du site et du serveur
python -m pytest -q  # tests de l'analyse
# Analyse en ligne de commande (elle n'apparaît pas dans la page) :
python analysis/analyze.py --source "chemin.mp4" --skip-if-ok --positions
```
- Prérequis à installer soi-même : Node 22+, Python 3.10+.
- Windows est nécessaire pour l'OCR et le bouton « Parcourir… » ; ailleurs ces étapes échouent proprement.
- Variable `EVA_PYTHON` : force l'interpréteur Python utilisé par le serveur.
- Variable `EVA_DB` : utilise une autre base (copie de test).

---

## 2. ARBORESCENCE COMMENTÉE

Non listés : `node_modules/`, `dist/`, `data/`, `__pycache__/`, les PNG de `analysis/weapon_icons/` et `analysis/map_names/`.

```
.
  README.md                  présentation et mode d'emploi détaillé de chaque lecture
  ARCHITECTURE.md            carte du projet (fichiers, routes, flux) ; à tenir à jour
  CLAUDE.md                  règles de travail et pièges techniques mesurés (très détaillé)
  PROJECT_OVERVIEW.md        ce document
  package.json               scripts npm et dépendances JS
  vite.config.ts             plugins : react() et analysisPlugin()
  tsconfig.json, tsconfig.app.json (src), tsconfig.node.json (server, tests, vite.config.ts)
  eslint.config.js           lint (une seule erreur connue : MapCanvas.tsx)
  pytest.ini                 tests Python dans analysis/tests
  index.html                 page d'entrée, charge src/main.tsx
  public/favicon.svg
  docs/
    PLAN_RESTANT.md          état d'avancement, mesures, reste à faire
    PLAN_OPTIMISATIONS.md    pistes de vitesse
    CHANGER_DE_PC.md         reprise sur un autre PC (base, vidéos, localStorage)
    SKILLS_ET_OUTILS.md      outils utiles
  scripts/
    setup.mjs                installe npm, Python, ffmpeg ; --run lance vite avec EVA_PYTHON
    crop_maps.py             rogne les plans des cartes
  src/
    main.tsx                 createRoot, <StrictMode><App/>
    App.tsx                  coquille et 4 onglets (rendu conditionnel, pas de routeur)
    index.css                styles de base globaux
    assets/maps/             12 plans de cartes (png/jpg), chargés par import.meta.glob
    components/              onglet Stratégie
      Toolbar.tsx            choix de carte, nouvelle carte depuis un plan, export/import JSON
      FloorSelector.tsx      étages (3 max), pelure d'oignon
      DrawToolbar.tsx        outils, couleur, épaisseur, effacer
      WeaponPanel.tsx        arme choisie, statistiques, calibrage de l'échelle, pose
      MapCanvas.tsx          canevas Konva : fond, formes, brouillon, armes posées et portées
      analysis/              onglets Analyse, Lecture, Armes
        AnalysisTab.tsx      conteneur de l'onglet Analyse
        IngestBar.tsx        source, « Détecter les games », menu Options, progression, pause, arrêt
        AnalysisPlan.tsx     « Analyse détaillée » : games cochées, ordre, lancement
        GameList.tsx         liste des games : bornes, carte, confirmation, suppression
        GameTeams.tsx        noms des équipes orange et bleue d'une game
        TeamRangeBar.tsx     noms d'équipes par morceau de vidéo
        SegmentTimeline.tsx  frise des games, doutes hachurés, commentaires
        VideoPlayer.tsx      <video> sur /api/videos/:id/stream, menu Calques
        PlayerControls.tsx   lecture, sauts, image par image, vitesse, « aller à »
        GameBadge.tsx        numéro de game et carte sur la vidéo
        VisionOverlay.tsx    calques « Ce que voit le programme » (zones, bandeaux, minimap, killfeed)
        CalibrationEditor.tsx  zones du HUD par carte (7 rectangles)
        ReplayPanel.tsx      replay sur le plan (environ 600 lignes : 2 horloges, traînées, score, échange de joueurs)
        ReliabilityLayer.tsx cases peu fiables sur le plan
        useGameFlags.ts      positions non confirmées, joueur observé, fiabilité
        CommentsPanel.tsx    commentaires liés à un instant, export texte
        ReadingTab.tsx       onglet Lecture : 3 sous-onglets
        CorridorMap.tsx      couloirs, murs, tyroliennes, capture, anneaux d'Engine
        CorridorLegend.tsx   légende
        CaptureSchedule.tsx  calendrier des points de capture d'Outlaw
        ShapeViewer.tsx      formes des joueurs sur la vraie minimap, corrections à la main
        MarkPanel.tsx, useMarks.ts, markDraw.ts   outil de correction (position, regard, mort, niveau)
        KillFlagsPanel.tsx   kills marqués « libanaise »
        MapMapping.tsx       cartographie à la main (environ 490 lignes)
        MappingCanvas.tsx, MappingShapes.tsx, MappingColors.tsx, MappingPlan.tsx, useMapAnnotation.ts
        WeaponsTab.tsx       onglet Armes
        WeaponCard.tsx, WeaponPrompt.tsx, WeaponReport.tsx
    lib/
      analysisApi.ts         client HTTP de toute l'API, subscribeJob (SSE)
      timeline.ts, comments.ts, teams.ts   fonctions pures (temps, export, diminutifs d'équipe)
      stuffs.ts              statistiques des 22 armes et gadgets (codées en dur)
      weaponCatalog.ts, weaponNames.ts     suggestions de noms, canonicalName
      builtinMaps.ts         liste des plans de src/assets/maps
      storage.ts             export et import JSON d'une carte Stratégie
      mapReading.ts          masques, traits, stations, départs d'une carte (importe les JSON d'analysis/)
      mapAnnotation.ts       format et validation du document de cartographie
      planInsets.ts          cadre de la minimap sur le plan, projection
      rotors.ts, captureSchedule.ts, pinShape.ts, replayFlags.ts, vision.ts, videoRef.ts, twoLevelMaps.ts
    store/
      mapStore.ts            état Stratégie, persisté (clé localStorage eva_strat:maps)
      analysisStore.ts       état Analyse, Lecture, Armes (non persisté)
    types/
      analysis.ts, map.ts, stuff.ts
    styles/
      index.css              importe tous les CSS (ordre = cascade)
      tokens.css             TOUTES les couleurs (variables CSS)
      ui-common.css          .help, .subtabs, .menu, .fold
      icons.css              classe .ic des icônes lucide
      un fichier par zone : toolbar, canvas, tabs, analysis-*, replay, weapons-tab, comments...
  server/
    analysisPlugin.ts        plugin Vite : routes d'analyse, jobs, armes, vidéo, choix de Python
    api.ts                   handleApi : routes REST (games, positions, commentaires, corrections...)
    db.ts                    ouverture SQLite, schéma, migrations
    jobs.ts                  Job et JobManager : lance analyze.py, relaie ses événements, pause, arrêt
    weapons.ts               catalogue des icônes, names.json, reviews.json, noms déduits
    guard.ts                 refuse les requêtes non locales
    range.ts                 en-tête HTTP Range
    filePicker.ts            boîte « Ouvrir un fichier » Windows (PowerShell + WinForms)
  tests/                     tests node:test du site (lib) et du serveur (tests/server/)
  analysis/                  Python
    requirements.txt         opencv-python, numpy, yt-dlp, pytest
    schema.sql               schéma SQLite (partagé avec Node)
    analyze.py               CLI principale : run() enchaîne toutes les étapes
    ingest.py                source : fichier ou URL (yt-dlp), probe (ffprobe)
    timer.py                 lecture du chrono par modèles de chiffres
    segments.py              découpage en games à partir des lectures du chrono
    mapname.py               nom de la carte (modèles map_names/)
    names.py                 pseudos sur les bandeaux (OCR), _grab (une image par ffmpeg)
    ocr.py, ocr_win.ps1      OCR Windows par PowerShell
    banners.py               bandeaux : vivant ou mort, points de vie, joueur observé
    loadout.py               armes et gadget de chaque joueur (icônes des bandeaux)
    capture.py               pourcentages de capture
    capture_points.py        point de capture actif d'Outlaw
    killfeed.py              kills (OCR + reconnaissance par l'aspect)
    weapons.py               modèles d'icônes W, B, G, netteté
    minimap.py               pastilles de la minimap (couleur, numéro, direction)
    positions.py             lecture de la minimap à cadence régulière, processus parallèles
    frame_noise.py           contamination de couleur par image
    observed_name.py         pseudo du joueur observé (bas droite)
    tracking.py              suivi dans le temps (environ 2 490 lignes) : solve()
    db.py                    accès SQLite et données des cartes
    resolve.py               refait le suivi sans relire la vidéo (cache)
    evaluate.py, recap.py, superpose.py, reliability.py, marks_eval.py, tune.py, benchmark.py   contrôle, mesure, réglage
    map_annotations.py       applique la cartographie à la main (masques et JSON)
    map_mask.py, mask_clean.py, plan_mask.py, plan_align.py, map_tp.py, map_spawn.py, rotors.py   fabrication des données de cartes
    icon_fix.py, reread_loadouts.py, build_templates.py   icônes et modèles
    default_zones.json       zones du HUD par défaut (fractions de l'image)
    map_zones.json           zone de minimap propre à 8 cartes
    map_*.json               tyroliennes, stations, départs, portes, capture, anneaux, cadre du plan
    tracking_params.json     réglages du suivi (versionné), historique dans tracking_params.history.jsonl
    digit_templates.npz      chiffres du chrono
    capture_digits.npz       chiffres des pourcentages
    minimap_digits.npz, minimap_cross.npz   chiffres et croix de la minimap
    map_names/               images binaires des noms de cartes
    map_masks/               <Carte>.png (praticable), _lignes, _classes, _mediane, _controle, _dessous, _plan_*
    map_reliability/         Polaris.json (cases peu fiables)
    weapon_icons/            W*.png, B*.png, G*.png, previews/, candidates/, names.json, reviews.json
    datasets/                ceres-1.json.gz (jeu de réglage de tune.py)
    tests/                   un test_<module>.py par module
```

---

## 3. ARCHITECTURE

### Démarrage
1. `npm run dev` lance Vite. `vite.config.ts` branche `analysisPlugin()`, qui ajoute un middleware dans `configureServer`.
2. Le plugin calcule les chemins :
   - `dbPath = process.env.EVA_DB ?? data/eva.db` ;
   - `cacheDir = data/cache` ;
   - le chemin de `analysis/analyze.py`.
3. Il ouvre la base (`server/db.ts` `openDb`, qui exécute `schema.sql` et les migrations), crée un `JobManager`, puis choisit l'interpréteur Python (`findPython`) :
   - `EVA_PYTHON` s'il est défini ;
   - sinon le premier `python`, `python3` ou `py` du PATH qui répond à `-c "import sys"`. Le raccourci du Microsoft Store est écarté.
4. Le navigateur charge `index.html`, puis `src/main.tsx`, puis `App.tsx`. Au montage, `App` appelle :
   - `loadWeapons()`, pour le badge des armes sans nom ;
   - `resumeJob()`, qui se reconnecte à une analyse en cours.

### Interface
- Pas de routeur : `App.tsx` garde `view: 'strategie' | 'analyse' | 'lecture' | 'armes'` dans un `useState` et rend un seul onglet à la fois. Un onglet quitté est démonté.
- Un composant conteneur par onglet : `AnalysisTab`, `ReadingTab` et `WeaponsTab`. Stratégie est composé directement dans `App` (`Toolbar`, `FloorSelector`, `DrawToolbar`, `WeaponPanel`, `MapCanvas`).
- `WeaponPrompt` (fenêtre « nommer les nouvelles icônes ») est toujours monté.
- Les onglets Analyse, Lecture et Armes partagent `useAnalysisStore`. Lecture n'a pas de sélecteur de vidéo : il prend la vidéo choisie dans Analyse.
- Navigation depuis un autre onglet : `analysisStore.viewRequest` (par exemple le lien « Vu dans » d'une arme ouvre l'onglet Analyse au bon instant).

### Communication entre modules
| De | Vers | Moyen |
|---|---|---|
| Composants React | stores | appels d'actions Zustand |
| Stores | serveur | `fetch` JSON (`src/lib/analysisApi.ts`). Tout POST, PUT ou PATCH doit avoir `Content-Type: application/json` (`guard.ts`) |
| Serveur | Python, analyse longue | `child_process.spawn` (`jobs.ts`), un seul job à la fois |
| Serveur | Python, tâches courtes | `execFile` : `resolve.py`, `map_annotations.py`, `icon_fix.py` (file sérielle) |
| Python | serveur | stdout, une ligne JSON par événement (`progress`, `done`, `error`) ; stderr gardé pour les messages d'erreur |
| Serveur | navigateur | SSE `GET /api/jobs/:id/events` (historique rejoué puis suivi), `EventSource` côté front |
| Pause | Python | **fichier de contrôle** `data/job.control` : sa présence met `analyze.py` en pause (`wait_if_paused`, sondage toutes les 0,25 s) |
| Arrêt | Python | `taskkill /pid <pid> /T /F` sous Windows (tue aussi ffmpeg), `SIGTERM` ailleurs |
| Python et Node | données | **même fichier SQLite** (mode WAL, `busy_timeout` de 5000 ms). Python écrit les résultats, Node les sert et écrit les saisies de l'utilisateur |
| Python | front | fichiers JSON et PNG d'`analysis/` importés **en statique** par le front (`mapReading.ts`, `planInsets.ts`, `captureSchedule.ts`) : une réécriture n'apparaît qu'après rechargement de la page |
| Python | ffmpeg, ffprobe, PowerShell | sous-processus (`subprocess.Popen` / `run`) |
| Python, en interne | processus parallèles | `ProcessPoolExecutor` pour la lecture de la minimap (3 processus au plus) |

### Schéma du flux de données
```
[Navigateur]
  IngestBar / AnalysisPlan
        | startIngest / startAnalysis (analysisStore)
        v
  POST /api/ingest {source, preRoll, postRoll, detectOnly, games, posEvery...}
        |
[Serveur Vite : analysisPlugin.ts]
        | validation, puis jobs.start(python, analyze.py --source --db --cache --control ...)
        | réponse 202 {jobId}
        v
[analysis/analyze.py run()]
   ingest (fichier local ou yt-dlp -> data/cache) -> ffprobe (durée, fps, taille)
   -> db.upsert_video
   -> ETAPE 1 : detect : ffmpeg (zone du chrono, 1 image/s) -> timer.read_timer -> segments.detect_games
               -> db.replace_detected_games -> fill_maps (mapname)
   -> ETAPE 2, game par game : names (OCR) -> loadout -> capture -> killfeed -> positions
               (banners + minimap + frame_noise -> tracking.solve) -> infer_killers
   chaque étape : écrit dans data/eva.db + print({"event":"progress",...})
        |
        | stdout JSON ligne par ligne
        v
[jobs.ts Job] -> SSE /api/jobs/:id/events -> subscribeJob -> analysisStore.job (barre de progression)
        |
        | événement "done" -> loadVideos, selectVideo, auditWeapons, guessWeapons, loadWeapons
        v
[Navigateur] GET /api/games, /api/samples, /api/capture, /api/flags... (server/api.ts lit SQLite)
   -> GameList, SegmentTimeline, ReplayPanel, VisionOverlay, ShapeViewer
```

---

## 4. DÉTAIL PAR FONCTIONNALITÉ

### 4.1 Stratégie
**Rôle** : choisir le plan d'une carte, dessiner dessus, gérer 3 étages, poser une arme pour voir ses paliers de dégâts à l'échelle.

**Fichiers clés**
- `src/components/Toolbar.tsx` : `handlePickBuiltin` (nouvelle carte depuis un plan ; bascule sur une carte existante du même nom), export et import JSON.
- `src/components/MapCanvas.tsx` : Stage Konva de 900 x 600 au plus (`MAX_WIDTH`, `MAX_HEIGHT`).
  - `handleMouseDown`, `handleMouseUp` (création des formes, calibration par `window.prompt` de la distance réelle) ;
  - `StuffRange` (anneaux de dégâts, rayons de grenade, Sonar, trajet du Clone) ;
  - `ShapeView`.
- `src/store/mapStore.ts`, actions principales :
  - cartes : `addMap`, `setActiveMap`, `upsertMap`, `setBackground`, `setMapScale` ;
  - étages : `addFloor`, `removeFloor` ;
  - formes : `addShape`, `updateShape`, `removeShape`, `clearShapes` ;
  - armes posées : `placeStuff`, `movePlacedStuff`, `orientPlacedStuff`.
- `src/lib/stuffs.ts` : données des armes. `src/lib/storage.ts` : `exportMapToJSON`, `importMapFromJSON`.

**Données**
- `MapConfig` est persisté dans localStorage sous la clé `eva_strat:maps` (`persist`, `version: 2`). Seuls `maps`, `activeMapId` et `activeFloorLevel` sont gardés.
- Les armes posées ne sont pas persistées.
- Coordonnées en pixels du Stage. Échelle : `pixelsPerMeter`.

### 4.2 Analyse
**Rôle côté utilisateur**
1. Charger une vidéo : champ chemin ou URL, ou bouton « Parcourir… ».
2. **« Détecter les games »** (étape 1).
3. Vérifier les bornes dans la liste et sur la frise.
4. Dans « Analyse détaillée », cocher les games, choisir leur ordre et lancer (étape 2).
5. Revoir : vidéo avec calques, replay sur le plan, kills, score, commentaires.

**Fichiers clés**
- Front :
  - `IngestBar.tsx`, `AnalysisPlan.tsx`, `GameList.tsx` ;
  - `analysisStore.ts` (`startIngest`, `startAnalysis`, `watchJob`, `refreshGames`, `controlJob`, `resumeJob`) ;
  - `analysisApi.ts` (`ingest`, `subscribeJob`).
- Serveur : `analysisPlugin.ts` (`POST /api/ingest`), `jobs.ts` (`Job`, `JobManager`), `api.ts` (lecture des résultats).
- Python : `analyze.py`, `ingest.py`, `timer.py`, `segments.py`, `mapname.py`, `db.py`, puis les modules de l'étape 2.

#### Précision importante sur `banners.py`
**La détection des games n'utilise pas `banners.py`.** Elle lit uniquement le **chrono** (`timer.py`) puis découpe (`segments.py`).
- `banners.py` lit les bandeaux des joueurs (vivant ou mort, points de vie, joueur observé) et ne sert qu'à l'étape 2 :
  - `positions.detect_states` ;
  - `analyze.drop_unconfirmed_kills` via `banners.confirm_death`.
- `analyze.py` importe tous les modules en tête (`import banners`, `import capture`...). Si `cv2` manque, l'échec arrive donc dès le lancement, avant toute détection. C'est l'erreur `ModuleNotFoundError: No module named 'cv2'` vue dans `banners.py` ligne 7.

#### Pipeline complet de l'étape 1 (« Détecter les games »)
1. **Clic** : `IngestBar` appelle `startIngest(target, { preRoll, postRoll, skipIfOk: true, detectOnly: true })`. `target` = texte du champ, sinon le chemin de la vidéo choisie.
2. **Requête** : `analysisApi.ingest` envoie `POST /api/ingest` avec un corps JSON.
3. **Serveur** (`analysisPlugin.ts`) : validation, puis traduction des champs en arguments de `analyze.py` :

   | Champ | Argument |
   |---|---|
   | `source` (obligatoire, sinon 400) | `--source=` |
   | `preRoll` (0 à 60) | `--pre-roll=` |
   | `postRoll` (0 à 120) | `--post-roll=` |
   | `skipIfOk` | `--skip-if-ok` |
   | `positions` | `--positions` |
   | `detectOnly` | `--detect-only` |
   | `redetect` | `--redetect` |
   | `games` (1 à 200 entiers) | `--games=1,2,3` |
   | `posEvery` (1 à 60) | `--pos-every=` |
   | `detect: false` | `--no-detect` |

   Il ajoute toujours `--db`, `--cache` et `--control=data/job.control`, puis appelle `jobs.start(...)`. Réponses : 202 `{ jobId }`, ou 409 si une analyse tourne déjà.
4. **Suivi** : `watchJob(jobId)` appelle `subscribeJob`, qui ouvre `EventSource('/api/jobs/<id>/events')`.
5. **Python `analyze.main()`** lit les arguments, puis appelle `run(...)`. Toute exception est émise en `{"event":"error","message":...}`.
6. **Source** (`ingest.py`) :
   - URL (`http://` ou `https://`) : `ingest.download`, avec yt-dlp, format mp4 en 1080p au plus, fichier `data/cache/<id YouTube>.mp4`, progression `stage: "download"` ;
   - fichier : `ingest.clean_path` retire espaces et guillemets, puis vérification d'existence (`FileNotFoundError` sinon).
7. **Métadonnées** : `ingest.probe` (ffprobe) donne `duration_s`, `fps`, `width`, `height`. `db.upsert_video` enregistre le chemin **absolu** de la vidéo, sans copie.
8. **Faut-il détecter ?**
   - `detected_now = do_detect and (redetect or aucune game connue)`.
   - Avec `--skip-if-ok`, les games déjà « en ordre » (`db.ok_games` : confirmées, vérifiées, sans doute, avec carte) ne sont pas relues.
   - Seuls les trous entre elles sont relus (`gaps_around`, `MIN_RANGE_S = 25` s).
9. **Lecture du chrono** (`analyze.detect`) :
   - la zone `timer` vient **directement de `default_zones.json`** : `{x:0.474, y:0.038, w:0.052, h:0.058}` en fractions de l'image. La calibration de l'utilisateur et `map_zones.json` ne sont pas utilisées ici ;
   - modèles : `timer.load_templates()` lit `analysis/digit_templates.npz` (générés par `build_templates.py`) ;
   - `timer.iter_crops` lance un seul ffmpeg : `-ss t0 -t durée -i vidéo -vf fps=1/1,crop=w:h:x:y -f rawvideo -pix_fmt bgr24 -`. Il lit des blocs de `w*h*3` octets, soit **1 recadrage par seconde** ;
   - `timer.read_timer(crop, templates)`, pour chaque recadrage :
     - niveaux de gris, intérieur de la boîte (12 à 88 % de la hauteur, 10 à 92 % de la largeur) ;
     - encre = pixels sous `DARK = 80` ;
     - découpe en colonnes : il faut **exactement 5 glyphes** (M, M, :, S, S), sinon None ;
     - chaque chiffre est réduit à 12 x 20 (`GLYPH_SIZE`) puis comparé par corrélation centrée normalisée ;
     - accepté si score >= `MIN_SCORE = 0.75` et écart au second >= `MIN_MARGIN = 0.05` ;
     - secondes > 59 : None ;
     - résultat : secondes restantes, ou None ;
   - pause possible entre deux images. Progression `stage: "detect"`.
10. **Découpage en games** (`segments.detect_games(samples, durée, pre_roll, post_roll)`) :
    - `_drop_outliers` retire une lecture incohérente avec ses deux voisines ;
    - `_split` coupe un groupe si le chrono remonte de plus de `JUMP_UP_S = 5` s, ou après un trou de plus de 30 s (`gap_s`) incohérent (écart chrono et temps de plus de 3 s). Un trou de 6 s ou plus devient un doute « Chrono illisible sur cette zone » ;
    - un groupe est rejeté s'il a moins de `MIN_READINGS = 5` lectures, s'il dure moins de `MIN_GAME_S = 20` s, ou s'il n'a aucune vraie descente (`_has_run` : `RUN_READINGS = 8` lectures qui baissent d'une seconde par seconde) ;
    - `_build_game`, pour le début :
      - plateau à la valeur de départ (compte à rebours figé) : départ = instant où le chrono le quitte (`_origin`, médiane sur `ORIGIN_READINGS = 40` lectures, moins 0,5 s) ;
      - sans plateau : doute « Début estimé » ;
      - début = départ moins `pre_roll` (défaut `PRE_ROLL_S = 3.0`) ;
    - `_build_game`, pour la suite :
      - chrono figé sur 5 lectures ou plus (`FROZEN_DOUBT_READINGS`) : doute « pause ? » ;
      - fin = dernière lecture + 1 + `post_roll` (défaut `POST_ROLL_S = 1.0`) ;
      - chrono arrêté au-dessus de `EARLY_END_S = 5` s : doute « Fin à vérifier » ou « La vidéo s'arrête avant la fin » ;
    - aucune durée de game codée en dur (10:00, 12:00 sur Outlaw...).
11. **Enregistrement** (`db.replace_detected_games`) :
    - une game confirmée n'est jamais modifiée : ses bornes sont seulement comparées à la détection (`BOUNDS_TOLERANCE_S = 1.5`), avec un doute si l'écart est plus grand ;
    - une game détectée aux mêmes bornes est **gardée avec son analyse** ;
    - les autres sont insérées en `status = 'detected'` et `doubts` (JSON) ;
    - les anciennes qui ont disparu sont supprimées (cascade sur leurs données).
12. **Aucune game** : la vidéo est retirée (`drop_video_if_empty`), avec l'erreur « Aucune game trouvée dans cette vidéo (chrono introuvable)... ».
13. **Carte** (`fill_maps`) :
    - une game à laquelle l'utilisateur a donné une carte qui n'a pas de modèle fournit un modèle (`mapname.save_template`) ;
    - pour les autres, `mapname.recognize_game` lit la zone fixe `REGION = {x:0.40, y:0.110, w:0.20, h:0.037}` (sous le chrono) aux instants 12, 25, 45, 70, 100, 140 et 190 s, avec un ffmpeg par image ;
    - masque binaire (gris >= 205) réduit à 160 x 24, corrélation avec `analysis/map_names/*.png` ;
    - accepté si score >= 0,80 et marge >= 0,06, ou score >= 0,65 et marge >= 0,30 ;
    - 3 votes concordants et une majorité stricte sont exigés ;
    - une carte déjà choisie n'est jamais écrasée.
14. **Fin** : `{"event":"done","video_id":N,"message":"N game(s) détectée(s) : vérifie les bornes, puis lance l'analyse"}`.
15. **Front** : `watchJob` reçoit `done`, puis enchaîne `loadVideos`, `selectVideo(video_id)` (qui relit games et commentaires), `auditWeapons`, `guessWeapons` et `loadWeapons(true)`.

**Options de l'étape 1 (menu « Options » de `IngestBar`)**
- « Avant … s » (`preRoll`, défaut 3) et « Après … s » (`postRoll`, défaut 1).
- « Positions : toutes les … images » (`posEvery`, défaut 6, utilisé à l'étape 2).
- « Refaire la détection » (`redetect: true`).
- « Calibrer les zones du HUD » (`CalibrationEditor`).
- Les valeurs sont gardées dans `analysisStore.options`, non persistées.

#### Étape 2 (« Analyser la sélection dans cet ordre »)
- `startAnalysis(gameIds)` envoie `startIngest(video.path, { preRoll, postRoll, withPositions: true, posEvery, games })`, d'où `--positions --games=...`.
- La détection est sautée puisque des games existent. `db.confirm_games(order)` : lancer l'analyse confirme les bornes.
- Cadence de la minimap : `step_s = pos_every / fps`.
- Pour chaque game, dans l'ordre (chaque étape saute ce qui est déjà à jour) :
  1. `extract_names` : `names.read_names`, 8 images, OCR Windows par lot, vote. `OcrUnavailable` fait sauter l'étape avec un message.
  2. `extract_loadouts` : `loadout.read_loadouts`, icônes B (armes) et G (gadgets) comparées aux modèles `weapon_icons/`.
  3. `extract_capture` : `capture.read_game`, chiffres par modèles `capture_digits.npz`. Plus `capture_points.scan_and_store` pour Outlaw.
  4. `extract_kills` : `killfeed.read_events`, zone fixe haut droite, 2 images par seconde, OCR puis reconnaissance des pseudos par l'aspect. Arme lue sur le bandeau du tueur (`kill_weapon`), kills non confirmés par le bandeau de la victime écartés (`banners.confirm_death`).
  5. `upgrade_kill_weapons`.
  6. `extract_positions` (`positions.read_game`) :
     - `detect_states` : `banners.read_states` sur les deux bandeaux ;
     - pseudo du joueur observé (`observed_name`) ;
     - `detect_frames_and_noise` : `minimap.find_markers` sur chaque image (processus parallèles) et `frame_noise` ;
     - `tracking.solve(...)` avec masques, tyroliennes, zones de départ, corrections à la main, kills ;
     - puis `db.replace_samples`, `apply_corrections`, `replace_observed` et `superpose.store_flags`.
  7. `infer_killers` : tueur illisible déduit par élimination si c'est cohérent.
- Fin : `confirm_clean_games` et événement `done`. Les progressions portent `gameIndex` et `gameCount` ; à chaque nouvelle game, le front recharge la liste.

**Entrées et sorties**
- Entrée : un fichier vidéo (mp4 conseillé, 1080p : la minimap est illisible en 360p) ou une URL.
- Sorties en base : tables `videos`, `games`, `players`, `loadouts`, `capture_state`, `capture_boxes`, `kills`, `kills_meta`, `samples`, `samples_meta`, `sample_flags`, `observed_segments`.
- Fichiers : icônes nouvelles dans `analysis/weapon_icons/`, cache `data/cache/`.

### 4.3 Lecture (onglet de premier niveau)
**Rôle** : comprendre et corriger ce que le programme lit.

`ReadingTab.tsx`, 3 sous-onglets (`SUBS`), carte par défaut `Polaris` :
1. « Couloirs lus » (`CorridorMap`, `CorridorLegend`, `CaptureSchedule`) : masque praticable, traits de murs, tyroliennes, portes et fenêtres, zones de départ, polygones de capture, anneaux tournants d'Engine (curseur d'instant), cases peu fiables. Menu « Calques ».
2. « Joueurs sur la minimap » (`ShapeViewer`, `MarkPanel`, `KillFlagsPanel`) :
   - deuxième `<video>` qui dessine la vraie minimap découpée selon la calibration, avec la forme (disque et pointe) de chaque joueur à la position et au regard calculés ;
   - contour rouge = non confirmé, orange pointillé = regard incertain (`gaze_coh < 0.4`) ;
   - correction à la main : clic = position, glisser = regard, case « Le joueur est mort », niveau rdc ou étage 1 sur Atlantis et The Cliff ;
   - « Recalculer avec mes corrections » : `POST /api/games/:id/resolve`, qui lance `resolve.py`.
3. « Cartographie à la main » (`MapMapping` et `Mapping*`) :
   - outils : `colors`, `zones`, `hors`, `tps`, `openings`, `capture`, `spawns`, `align` ;
   - classes : sol, mur, tir par-dessus, vue seulement, porte, porte vitrée, hors map ;
   - « Enregistrer » : `PUT /api/map-annotations?map=` (table `map_annotations`) ;
   - « Appliquer au programme » : `POST /api/map-annotations/apply?map=`, qui lance `map_annotations.py`. Le script réécrit `analysis/map_masks/<Carte>*.png` et les `analysis/map_*.json`. Le masque est refusé s'il rejetterait plus de 1 % des lectures sûres.

**Données** : `samples`, `sample_flags`, `observed_segments`, `user_marks`, `kill_flags`, `map_annotations`, plus les fichiers de cartes d'`analysis/`.

### 4.4 Armes
**Rôle** : nommer les icônes vues par l'analyse. Trois catalogues :
- **W** : killfeed ;
- **B** : armes des bandeaux ;
- **G** : gadgets.

**Fichiers clés**
- Front : `WeaponsTab.tsx` (sections, recalcul par lot `startBatch`, verrouillage), `WeaponCard.tsx` (nom, avis « Bon » ou « Pas bon », « Vue dans », « Signaler »), `WeaponPrompt.tsx`, `WeaponReport.tsx`.
- Serveur : `server/weapons.ts` (`listWeapons`, `setWeaponName`, `setReview`, `inferKillfeedNames`, `effectiveNames`).
- Python : `analysis/weapons.py` (`identify`, `edge_width`, `SHARP_MAX = 2.0`), `analysis/icon_fix.py` (`audit`, `candidates`, `rebuild`, `guess`).

**Flux**
1. Une icône inconnue devient `B12.png` et un aperçu.
2. L'utilisateur la nomme : `PUT /api/weapons/:id`, qui écrit `names.json`.
3. « Recalculer les floues et signalées » : `POST /api/weapons/audit`, puis `icon_fix.py rebuild` par icône, puis `POST /api/weapons/guess`.
4. Un modèle verrouillé n'est jamais recalculé.

**Priorité des noms** : nom saisi, puis nom déduit (équipement commun des tueurs, logo `GRENADE`), puis nom deviné (ressemblance à un modèle verrouillé).

---

## 5. DONNÉES ET FORMATS

### Où sont les données
| Emplacement | Contenu | Dans Git |
|---|---|---|
| `data/eva.db` (+ `-wal`, `-shm`) | toute l'analyse et les saisies de l'utilisateur | non |
| `data/cache/` | vidéos téléchargées (`<id>.mp4`), caches `eval_<game>.json` de `evaluate.py` | non |
| `data/job.control` | fichier de pause (existe pendant une pause) | non |
| Vidéos locales | jamais copiées : chemin absolu dans `videos.path` | non |
| `analysis/*.json`, `analysis/map_masks/`, `analysis/weapon_icons/`, `*.npz` | données de cartes, modèles, noms d'armes | oui |
| localStorage du navigateur | `eva_strat:maps` (Stratégie), `eva_strat:vision`, `eva_strat:vision-on` (calques), `eva_strat:replay-inset[:aligned]:<carte>` (cadre du replay) | non |

### Tables SQLite (`analysis/schema.sql`)
- `videos(id, path UNIQUE, source_url, duration_s, fps, width, height, created_at)`
- `games(id, video_id, start_s, end_s, map, status 'detected'|'confirmed', winner, checked, doubts JSON, team_a, team_b)`
- `players(game_id, slot 1-8, name)` : slots 1 à 4 = équipe orange (gauche, `A`), 5 à 8 = équipe bleue (droite, `B`).
- `loadouts(game_id, slot, weapon1, weapon2, gadget)` : identifiants d'icônes (`B3`, `G5`).
- `kills(game_id, t, killer_slot, victim_slot, weapon, headshot, kind)`, avec `kind` = kill, suicide, environment, unknown ou inferred. `kills_meta(game_id, revision)`.
- `samples(game_id, frame, t, slot, team, x, y, angle, alive, hp, weapon, confidence, gaze_coh)` :
  - une ligne par joueur et par image lue ;
  - `x` et `y` sont normalisés de 0 à 1 dans la minimap ;
  - `angle` en degrés ;
  - `hp` et `weapon` ne sont pas remplis.
- `samples_meta(game_id, params_version, with_kills, zone_key)` : relecture automatique si la version du suivi ou la zone de minimap change.
- `sample_flags(game_id, frame, slot, flag)` (`'unconfirmed'`), `observed_segments(game_id, slot, t0, t1)`.
- `capture_state(game_id, t, point, pct, team)` (points `score_A`, `score_B`), `capture_boxes(game_id, t0, t1, x, y, w, h, point)`.
- `calibrations(map, zone, x, y, w, h)`, avec `zone` parmi minimap, capture_points, capture_pct_a, capture_pct_b, team_a_bar, team_b_bar, timer.
- `user_marks(id, game_id, slot, t, x, y, angle, created, frame, frame_t, level 'etage'|'dessous', dead)`
- `corrections(id, game_id, t0, t1, slot_a, slot_b)` : échange de deux joueurs entre t0 et t1.
- `comments(id, video_id, game_id, t, tag 'suivi'|'equipe'|'note', text, slots '2,5', resolved, created_at)`
- `teams(tag, name)`, `team_ranges(id, video_id, start_s, end_s, team_a, team_b)`, `kill_flags(game_id, t, victim_slot, flag 'libanaise')`, `map_annotations(map, data JSON, updated)`

### Objets principaux (front, `src/types/analysis.ts`)
```ts
interface Game {
  id: number; video_id: number; start_s: number; end_s: number; map: string | null;
  status: 'detected' | 'confirmed'; winner: string | null; team_a: string | null; team_b: string | null;
  doubts: { start_s: number; end_s: number; label: string }[];
  samples: number;   // nombre de positions lues
  players: { slot: number; name: string; weapon1: string | null; weapon2: string | null; gadget: string | null }[];
  kills: Kill[];
}
interface Kill { t: number; killer: number | null; victim: number; weapon: string | null; weaponName: string | null;
  stuff: string | null; headshot: boolean; kind: 'kill' | 'suicide' | 'environment' | 'unknown' | 'inferred' | null; }
interface Sample { frame: number; t: number; slot: number; team: 'A' | 'B'; x: number; y: number;
  angle: number | null; alive: number; confidence: number | null; gaze_coh?: number | null; }
interface JobEvent { event: 'progress' | 'done' | 'error';
  stage?: 'download' | 'detect' | 'maps' | 'names' | 'loadout' | 'capture' | 'kills' | 'positions';
  pct?: number; video_id?: number; message?: string; gameIndex?: number; gameCount?: number; }
interface Weapon { id: string; kind: 'killfeed' | 'arme' | 'gadget'; name: string; inferred: boolean; uses: number;
  reported: boolean; verdict: 'ok' | 'bad' | null; blur?: number | null; blurry?: boolean; locked: boolean;
  sources: { videoId: number; gameId: number; video: string; game: number; map: string | null; t: number; player: string | null }[]; }
```
Autres types du même fichier : `Video`, `VideoComment`, `UserMark`, `GameFlags`, `Correction`, `CaptureSeries`, `TeamRange`, `Zone`.

### Game côté Python (sortie de `segments.detect_games`)
```python
{"start_s": 123.0, "end_s": 734.5, "doubts": [{"start_s": 700.0, "end_s": 734.5, "label": "Fin à vérifier : chrono arrêté à 0:42"}]}
```

### Ligne de suivi (sortie de `tracking.solve`)
`(frame, t, slot, team, x, y, angle, alive, confidence)`. Confiance : 1.0 = numéro lu (vote), 0.7 = continuité, 0.4 = élimination, 0.3 = trou comblé, 0.2 = point de réapparition deviné.

### Arme et carte (onglet Stratégie, `src/types/stuff.ts`, `src/types/map.ts`)
```ts
type Stuff = Firearm | Grenade | Utility;
interface Firearm { kind: 'firearm'; name: string; damage: { head; body; extremities; average };
  falloff: { fromM: number; toM: number | null; pct: number }[]; fireRateRpm: number; magazine?: number;
  reloadS?: number; dispersionDeg?: number; bulletSpeedMs?: number; equipS?: number; /* ... */ }
interface Grenade { kind: 'grenade'; name; fuseS; reloadS; maxDamage; maxDamageRadiusM; damageLimitRadiusM }
interface Utility { kind: 'utility'; name; reloadS; hp?; durationS?; radiusM?; healHp?; speedKmh?; placeable? }
// Exemple réel (src/lib/stuffs.ts)
{ kind: 'firearm', name: 'AK77', damage: { head: 17, body: 15, extremities: 14, average: 15.3 },
  falloff: [{ fromM: 0, toM: 25, pct: 100 }, { fromM: 25, toM: 35, pct: 83 }, { fromM: 35, toM: null, pct: 75 }],
  dispersionDeg: 0.3, fireRateRpm: 552, magazine: 35, reloadS: 1.8, bulletSpeedMs: 1000, equipS: 0.6 }

interface Shape { id: string; kind: 'line' | 'rect' | 'ellipse' | 'pen'; points?: number[];
  x?: number; y?: number; width?: number; height?: number; stroke: string; strokeWidth: number; }
interface Floor { id: string; level: number; shapes: Shape[]; elevatorZones: ElevatorZone[] }
interface MapConfig { id: string; name: string; backgroundImage: string | null; pixelsPerMeter: number | null; floors: Floor[] }
```
- L'export JSON d'une carte Stratégie est le `MapConfig` brut (`JSON.stringify(map, null, 2)`), dans un fichier `eva_strat_<nom>.json`.
- `stuffs.ts` contient 22 entrées : 16 armes à feu, 2 grenades (DX3, STICKY), 4 gadgets (SONAR, SHIELD, MEDPACK, CLONE).

### Fichiers JSON d'`analysis/` (structures réelles)
```jsonc
// default_zones.json : zones du HUD en fractions de l'image (x, y = coin haut gauche)
{ "minimap": {"x":0.0036,"y":0.786,"w":0.2294,"h":0.208}, "capture_points": {...}, "capture_pct_a": {...},
  "capture_pct_b": {...}, "team_a_bar": {"x":0.005,"y":0.026,"w":0.31,"h":0.096},
  "team_b_bar": {"x":0.685,"y":0.026,"w":0.31,"h":0.096}, "timer": {"x":0.474,"y":0.038,"w":0.052,"h":0.058} }
// map_zones.json : minimap propre à 8 cartes (Ceres absente)
{ "Silva": { "minimap": { "x": 0.0, "y": 0.742, "w": 0.206, "h": 0.254 } }, "Outlaw": { "minimap": {"x":0.01,"y":0.648,"w":0.198,"h":0.347} } }
// map_teleports.json : paires de stations de tyrolienne
{ "Polaris": [[[0.6056,0.6934],[0.6034,0.0556]], ...] }
// map_stations.json : cercles et directions
{ "Polaris": [{"a":{"x":0.6056,"y":0.6934,"r":0.0194,"angle":326.67},"b":{"x":0.6034,"y":0.0556,"r":0.02,"angle":146.67}}] }
// map_spawns.json : zones de départ [x0,y0,x1,y1] (ou liste de rectangles) par équipe
{ "Ceres": {"A":[0.0043,0.3134,0.1664,0.6804],"B":[0.8428,0.3176,0.9985,0.6762]} }
// map_doors.json : portes, fenêtres, murs, tirs par-dessus
{ "Reef Point": [{"from":[0.6775,0.2887],"to":[0.7323,0.2628],"kind":"porte","glass":false,"side":0,"under":false}] }
// map_capture.json : polygones de capture
{ "Polaris": [[[0.4456,0.4620],[0.5250,0.4620],[0.5250,0.6176],[0.4456,0.6176]]] }
// map_plan_insets.json : cadre de la minimap sur le plan stratégique
{ "Polaris": {"l":0.0002,"t":0.0118,"r":-0.0389,"b":0.0039,"correlation":0.476} }
// map_rotors.json : anneaux tournants d'Engine (omega en degrés par seconde)
{ "Engine": {"aspect":1.8992,"centre":[0.4938,0.4975],"t_ref":15.0,"anneaux":[{"nom":"interieur","omega":-3.0,"ouvertures":[[105.5,142.5],[285.5,319.0]], ...}]} }
// map_capture_points.json : Outlaw, points A à E et calendrier des changements
// weapon_icons/names.json
{ "B4": "WARDEN", "B3": "ATLAS", "W1": "SPECTRE", "G5": "STICKY", "G21": "CLONE" }
// weapon_icons/reviews.json
{ "B13": {"verdict":"ok","locked":true}, "B7": {"guess":"AK77","verdict":"bad","rejected":["AK77"]}, "G16": {"reported":true} }
```

### Document de cartographie (`map_annotations.data`, `src/lib/mapAnnotation.ts`)
```ts
interface MapAnnotation {
  colors: { rgb: [number, number, number]; tol: number; cls: 'sol'|'mur'|'tir'|'vue'|'porte'|'porte_vitre'|'hors' }[];
  tps: { a: Station; b: Station }[];             // Station = { x, y, r, angle | null }
  doors: { from: Point; to: Point; kind: 'porte'|'fenetre'|'mur'|'tir'; glass: boolean; side: -1|0|1; under: boolean }[];
  spawns: Record<'A' | 'B' | 'any', [number, number, number, number][]>;
  overrides: { polygon: Point[]; from: ClassName | 'any'; to: ClassName; under: boolean }[];
  usePlan: boolean; capture: Point[][]; pairs: { minimap: Point; plan: Point }[]; inset: Inset | null;
}
```

### Modèles (templates)
| Fichier | Sert à | Régénéré par |
|---|---|---|
| `analysis/digit_templates.npz` | chiffres du chrono (détection des games) | `build_templates.py VIDEO --t0 --start-value` |
| `analysis/map_names/<Carte>.png`, `<Carte>__2.png` | nom de carte | automatique (`mapname.save_template`) quand on choisit une carte à la main |
| `analysis/capture_digits.npz` | pourcentages de capture | |
| `analysis/minimap_digits.npz`, `minimap_cross.npz` | numéros des pastilles, croix de mort | |
| `analysis/weapon_icons/W*, B*, G*.png` | icônes d'armes | `weapons.identify`, `icon_fix.py` |

---

## 6. CONFIGURATION ET OPTIONS

### Variables d'environnement
| Variable | Lue par | Effet |
|---|---|---|
| `EVA_PYTHON` | `server/analysisPlugin.ts`, `scripts/setup.mjs` | interpréteur Python utilisé |
| `EVA_DB` | `server/analysisPlugin.ts` | chemin de la base (défaut `data/eva.db`) |
| `EVA_WORKERS` | `analysis/positions.py` `_workers()` | nombre de processus de lecture de la minimap (défaut 3, plafonné à la moitié des cœurs et par la mémoire libre) |
| `EVA_MAPS_OUT` | `analysis/map_annotations.py` (à l'import) | redirige les fichiers écrits par « Appliquer » |
| `NODE_OPTIONS=--use-system-ca` | npm | contournement d'un problème de certificat SSL |

### Options de `analyze.py` (CLI)
| Option | Défaut | Rôle |
|---|---|---|
| `--source` | obligatoire | chemin ou URL |
| `--db` | `data/eva.db` | base |
| `--cache` | `data/cache` | téléchargements |
| `--no-detect` | | vidéo d'une seule game |
| `--pre-roll` | 3.0 | secondes gardées avant le départ du chrono |
| `--post-roll` | 1.0 | secondes gardées après la dernière lecture |
| `--skip-if-ok` | | ne relit pas les games en ordre |
| `--control` | | fichier de pause |
| `--pos-every` | 6 | une lecture de la minimap toutes les N images |
| `--positions` | | étape 2 |
| `--detect-only` | | étape 1 seule |
| `--redetect` | | refait la détection |
| `--games` | | identifiants des games, dans l'ordre (ex. `12,3,7`) |

### Constantes importantes
- **Chrono** (`timer.py`) : `DARK = 80`, `GLYPH_SIZE = (12, 20)`, `MIN_SCORE = 0.75`, `MIN_MARGIN = 0.05`. Cadence de détection : 1 image par seconde (`iter_crops(step_s=1.0)`).
- **Découpage** (`segments.py`) : `PRE_ROLL_S = 3.0`, `POST_ROLL_S = 1.0`, `MIN_GAME_S = 20.0`, `MIN_READINGS = 5`, `JUMP_UP_S = 5`, `UNREADABLE_DOUBT_S = 5.0`, `FROZEN_DOUBT_READINGS = 5`, `EARLY_END_S = 5`, `ORIGIN_READINGS = 40`, `RUN_READINGS = 8`, `gap_s = 30.0`. Dans `analyze.py` : `MIN_RANGE_S = 25.0`. Dans `db.py` : `BOUNDS_TOLERANCE_S = 1.5`.
- **Carte** (`mapname.py`) : `REGION` fixe, `BRIGHT = 205`, `MIN_SCORE = 0.80`, `MIN_MARGIN = 0.06`, `LOW_SCORE = 0.65`, `WIDE_MARGIN = 0.30`, `VOTES_NEEDED = 3`, `SAMPLE_OFFSETS_S = (12, 25, 45, 70, 100, 140, 190)`.
- **Bandeaux** (`banners.py`) :
  - remplissage : `COLORED = {"S": 100, "V": 140}`, `FILL_COLUMNS = (0.34, 0.80)`, `ROW_COLORED = 0.35`, `MIN_FILL = 0.015` ;
  - cadre blanc : `FRAME_V, FRAME_S = 200, 130`, `FRAME_TOP_SHARE = 0.7`, `FRAME_BOTTOM_ROWS = 30`, `FRAME_BOTTOM_SHARE = 0.75`, `FRAME_BOTTOM_THICKNESS = (2, 6)` ;
  - confirmation des morts : `DEATH_OFFSETS_S = (1.2, 2.2, 3.2)`, `MIN_BAR_BRIGHTNESS = 25`, `END_MARGIN_S = 0.5`.
- **Minimap** (`minimap.py`) :
  - couleurs HSV : `ORANGE = ((3,150,195),(22,255,255))`, `BLUE = ((98,100,195),(118,255,255))`, variantes `_DIM`, `RING_*` et `RING_*_WEAK` ;
  - tailles : `MARKER_AREA = (140, 900)` à l'échelle `(largeur/440)^2` ;
  - seuils : `MIN_DIGIT_SCORE = 0.65`, `MIN_CROSS_SCORE = 0.75`.
- **Positions** (`positions.py`) : `EVERY_FRAMES = 6`, `STEP_S = 0.2`, `BATCH = 48`, `MAX_WORKERS = 3`, `WORKER_RAM_MB = 700`, `KEEP_FREE_RAM_MB = 3000`.
- **Suivi** (`tracking.py`) :
  - versions : `ALGO_REVISION = 52`, `PARAMS_VERSION = version de tracking_params.json (1) + ALGO_REVISION` ;
  - distances et vitesses : `ARENA_M = (31.0, 16.5)`, `V_MAX_MS = 10.0`, `IMPOSSIBLE_V_MS = 14.0`, `MIN_SEPARATION = 0.035` ;
  - bruit : `NOISE_MAX = 6.0` ;
  - regard : `OBSERVED_FOLLOW_SPEED = 0.07`, `ENEMY_WEIGHT = 0.6`, `WALL_WEIGHT = 0.4`, `DUEL_MAX_M = 14.0` ;
  - temps et corrections : `FRAME_LAG_S = 0.1`, `MARK_TRUST_M = 1.0`, `USER_DEAD_S = 14.0`, `PRESTART_S = 1.5`, `CROSS_FRESH_S = 6.0`.
  - Les réglables (`TUNABLE` : `GATE_BASE`, `GATE_SPEED`, `MAX_MISS_S`, `ASSIGN_GAP_S`, `SMOOTH_S`, `FLIP_COST`...) sont **écrasés à l'import** par `analysis/tracking_params.json`, produit par `tune.py`.
- **Killfeed** : `killfeed.REVISION = 4`. Un kill lu avec une version plus ancienne est relu.
- **Armes** (`weapons.py`) : `MATCH_SCORE = 0.6` (B : 0.85), `NATIVE_MATCH = 0.93`, `SHARP_MAX = 2.0`. Gadgets qui tuent : `KILLING_GADGETS = ("DX3", "STICKY")`.
- **Front** : `analysisStore.options` par défaut `{ preRoll: 3, postRoll: 1, posEvery: 6 }`. `MapCanvas` : `MAX_WIDTH = 900`, `MAX_HEIGHT = 600`.

### Ordre de priorité d'une zone du HUD (`db.zone_for`)
calibration de l'utilisateur (table `calibrations`), puis `map_zones.json`, puis `default_zones.json`. **Exceptions** : ces zones ne passent pas par `zone_for` :
- la détection des games (chrono : `default_zones.json` directement) ;
- `mapname.REGION`, `killfeed.REGION` et `observed_name.ZONE`, codées en dur ;
- `capture_points.py` et `rotors.py`, qui lisent `map_zones.json[carte]["minimap"]` directement.

### Chemins
- Tous les chemins du code sont relatifs : à la racine (`server.config.root`) ou au dossier courant (`--db data/eva.db`).
- Aucun chemin absolu Windows dans le code de production. Le seul chemin absolu est celui des vidéos, stocké en base.
- Les scripts Python s'attendent à être lancés depuis la racine. Exceptions : `evaluate.py` et `tune.py` calculent `data/` à partir de leur propre fichier.

---

## 7. POINTS FRAGILES ET DETTE TECHNIQUE

### Environnement
- **Plusieurs interpréteurs Python** : sur ce PC, Python 3.12 (python.org) et 3.11 (Microsoft Store). Le serveur prend le premier du PATH, sauf si `EVA_PYTHON` est défini. Des paquets installés dans le mauvais Python donnent `ModuleNotFoundError: No module named 'cv2'`. Correctif : `<python choisi> -m pip install -r analysis/requirements.txt`.
- **Imports au chargement** : `analyze.py` importe tous les modules (cv2, numpy) au chargement. Une dépendance manquante fait échouer même la simple détection des games.
- **ffmpeg et ffprobe** doivent être dans le PATH. Leur absence n'est pas vérifiée : `FileNotFoundError` brut.
- **Windows obligatoire** pour :
  - l'OCR (PowerShell 5.1, WinRT, un pack de langue OCR installé, `-ExecutionPolicy Bypass`) ;
  - le bouton « Parcourir… » (`filePicker.ts`) ;
  - la mémoire libre et la priorité basse (`ctypes.windll` dans `positions.py`, erreurs avalées ailleurs).
- **OpenCV 5.0** est installé ici. Le projet a peut-être été écrit avec la 4.x (non vérifié) ; les 288 tests Python passent.
- **L'API n'existe qu'avec `npm run dev`** : pas de `configurePreviewServer`, donc rien avec `vite preview` ni un `dist` statique.
- **Accès local seulement** : `guard.ts` n'accepte que `localhost`, `127.0.0.1` et `[::1]`. `vite --host` ne donne pas accès à l'API.
- **Mémoire** : PC de développement à 8 Go. Jamais deux analyses en même temps sur la même base. Le verrou de `resolve` ne bloque pas une analyse en cours.

### Données
- **Chemins absolus des vidéos en base** (`videos.path`) : déplacer une vidéo donne 404 au lecteur. Correction à la main en SQL (`docs/CHANGER_DE_PC.md`).
- **Migrations écrites deux fois** (`analysis/db.py` et `server/db.ts`), qui ont déjà divergé : `zone_key` et `PRAGMA user_version` n'existent que côté Python. `db.connect` vide toute la table `samples` si `user_version < 2`.
- **Bug** : `swap_slots` (`analysis/db.py`) et `swapSlots` (`server/api.ts`) réinsèrent les positions **sans `gaze_coh`**. Après un échange de joueurs, la cohérence du regard devient NULL (vérifié dans `db.py`).
- **Déplacer une borne de game** (« début ici », « fin ici » dans `GameList`) efface sans confirmation positions, kills, contrôles et scores de la game.
- **« Appliquer » une cartographie** réécrit des fichiers suivis par Git (`analysis/map_*.json`, `map_masks/*.png`), importés en statique par le front : rechargement de la page nécessaire.
- **`names.json` ou `reviews.json` illisible** : il est lu comme `{}`, puis réécrit à la sauvegarde suivante, ce qui perd tous les noms ou avis.
- **`tracking_params.json` illisible** : retour silencieux aux valeurs du code, et `PARAMS_VERSION` change, donc toutes les games seraient relues.
- **Persistance Stratégie** : `migrate` efface toutes les cartes à chaque changement de version du store. Les fonds de carte sont des URL d'assets Vite, différentes en dev et en build : un export JSON n'est pas portable.

### Code
- **Gros fichiers** :
  - `analysis/tracking.py`, environ 2 490 lignes et 110 fonctions ; `solve()` seule fait 215 lignes. Il utilise des globales de module (`_TELEPORTS`, `_WALK`, `_ROUTES`, `_ROTORS`...) et n'est pas réentrant ;
  - `analysis/db.py` (environ 610), `map_annotations.py` (environ 560), `minimap.py` (environ 480, `find_markers` 136 lignes) ;
  - `src/components/analysis/ReplayPanel.tsx` (environ 600), `server/api.ts` (environ 570), `MapCanvas.tsx` (environ 520), `MapMapping.tsx` (environ 490), `server/analysisPlugin.ts` (environ 410, routage par expressions régulières dans une seule fonction).
- **Code dupliqué** :
  - extraction d'une image par ffmpeg (`mapname.grab_crop`, `names._grab`, `killfeed._grab`) ;
  - corrélation centrée (5 copies) ;
  - bornes HSV d'équipe différentes selon le module (bleu 116 dans `killfeed.py`, 118 ailleurs) ;
  - cadence « 6 images » recopiée en littéral dans `resolve.py`, `superpose.py`, `evaluate.py`, `tune.py`, `benchmark.py` ;
  - règle « numéro affiché = slot, ou slot + 1 au-delà de 4 » recopiée 7 fois dans le front ;
  - couleurs d'équipe `#ff9f1c` et `#3d8bff` en dur dans 5 composants (contraire à la règle `tokens.css`) ;
  - zones `ZONE_NAMES`, statuts et catégories de commentaires recopiés entre `schema.sql`, `server/api.ts` et `src/types/analysis.ts` ;
  - `ICON_BOXES` de `VisionOverlay.tsx` a divergé de `loadout.BOXES` en hauteur (0,33 à 0,50 contre 0,29 à 0,52).
- **Fonctions privées appelées d'autres modules** : `names._grab`, `loadout._bar_of`, `evaluate._load`, `weapons._cache`...
- **Erreurs mal gérées** :
  - nombreux `.catch(() => undefined)` silencieux dans le front ;
  - `subscribeJob` ferme l'`EventSource` à la première coupure réseau : le front affiche « Connexion au serveur perdue » alors que l'analyse continue sur le serveur ;
  - un JSON invalide donne 500 au lieu de 400 ;
  - corps de requête sans limite de taille ;
  - `map-annotations/apply` renvoie 200 même quand Python répond `{"erreur": ...}` ;
  - `games` de plus de 200 éléments ignoré sans message ;
  - `WeaponsTab.startBatch` sans `finally` : boutons bloqués après une erreur.
- **Divers** :
  - `analysis/ocr_win.ps1` ligne 30 : `.Replace('/', '')` supprime les `/` au lieu de les remplacer par `\`. Sans effet aujourd'hui (les chemins envoyés sont déjà en `\`) ;
  - `observed_segments` : temps décalés de 0,1 s (`FRAME_LAG_S`) selon qu'ils viennent d'`analyze.py` ou de `resolve.py` ;
  - `streamVideo` envoie toujours `video/mp4`, alors que le sélecteur accepte `.mkv`, `.mov`, `.webm` ;
  - `ShapeViewer` ouvre un deuxième flux vidéo en `preload="auto"` ;
  - Stratégie : la touche Suppr efface la forme sélectionnée même quand le focus est dans un champ, une seule instance par arme posée, `MP-52` et `MP52` en double dans `stuffs.ts` avec des statistiques différentes, `×` Unicode dans deux boutons (contraire à la règle des icônes).
- **Lint** : une erreur connue et tolérée, `src/components/MapCanvas.tsx` (`react-hooks/set-state-in-effect`). Ne pas en ajouter.
- **Tests absents** : routes de `analysisPlugin.ts` (ingest, resolve, SSE), composants React, stores, `storage.ts`, `mapReading.ts`.
- **Documentation en retard** : `ARCHITECTURE.md` annonce 3 onglets au lieu de 4 et des nombres de lignes dépassés. `map_mask.py` dit encore que seul Polaris a un masque.

---

## 8. OÙ MODIFIER QUOI

| Si je veux... | Fichiers et fonctions |
|---|---|
| Changer la détection des games (seuils, découpage, doutes) | `analysis/segments.py` (`detect_games`, `_split`, `_build_game`, `_origin`, constantes en tête) ; `analysis/analyze.py` `detect()` ; tests `analysis/tests/test_segments.py` |
| Changer la lecture du chrono (police, zone) | `analysis/timer.py` (`glyphs`, `_match`, `read_timer`, `DARK`, `MIN_SCORE`) ; modèles : `python analysis/build_templates.py VIDEO --t0 T --start-value S` ; zone : `analysis/default_zones.json` clé `timer` (la calibration n'est pas utilisée par la détection : modifier `analyze.detect` pour passer par `db.zone_for` si besoin) |
| Changer les marges avant et après une game | défauts `segments.PRE_ROLL_S`, `POST_ROLL_S` ; valeurs du front `analysisStore.ts` `options` ; validation serveur `analysisPlugin.ts` (0 à 60, 0 à 120) |
| Changer la cadence de lecture des détections | `analyze.detect` (appel de `timer.iter_crops(..., step_s=1.0)` par défaut) et `segments` (les seuils supposent 1 lecture par seconde) |
| Ajouter une option à « Détecter les games » | `IngestBar.tsx` (menu Options), `analysisStore.ts` (`options`, `startIngest`), `analysisApi.ts` (`ingest`), `analysisPlugin.ts` (validation de `POST /api/ingest`, construction de `extra`), `analyze.py` (`argparse` de `main`, signature de `run`) |
| Corriger l'état vivant ou mort, le joueur observé | `analysis/banners.py` (`read_team`, `_white_frame`, constantes) ; utilisé par `positions.detect_states` et `banners.confirm_death` ; tests `test_banners.py` |
| Changer le téléchargement YouTube | `analysis/ingest.py` `download` (format yt-dlp, `outtmpl`) |
| Ajouter une carte | plan `src/assets/maps/<Nom>.png` (pris automatiquement par `builtinMaps.ts`) ; modèle du nom : choisir la carte à la main sur une game puis relancer la détection (`map_names/<Carte>.png` créé) ; zone de minimap : `analysis/map_zones.json` ; masque, tyroliennes, départs : onglet Lecture, Cartographie, Appliquer (ou `map_mask.py`, `map_tp.py`, `map_spawn.py`) ; cartes à deux niveaux : `src/lib/twoLevelMaps.ts` |
| Ajouter une arme (onglet Stratégie) | `src/lib/stuffs.ts` (tableau `stuffs`, types dans `src/types/stuff.ts`) ; les suggestions de noms de l'onglet Armes en dérivent (`weaponCatalog.ts`) ; une grenade qui tue doit aussi aller dans `analyze.KILLING_GADGETS`, `server/weapons.ts` `GRENADE_NAMES` et `tracking.KILL_GAZE_SKIP_WEAPONS` |
| Nommer une icône d'arme | onglet Armes, ou `analysis/weapon_icons/names.json` (`{"B12": "NOM"}`) |
| Changer la reconnaissance des icônes | `analysis/weapons.py` (`identify`, `MATCH_SCORE*`, `NATIVE_*`, `SHARP_MAX`), `analysis/loadout.py` (`BOXES`) |
| Changer la lecture du killfeed | `analysis/killfeed.py` (`REGION`, `read_events`, `resolve_by_appearance`), incrémenter `killfeed.REVISION` |
| Changer la détection des pastilles | `analysis/minimap.py` (`find_markers`, bornes HSV) ; incrémenter `tracking.ALGO_REVISION` |
| Changer le suivi des joueurs | `analysis/tracking.py` (`solve` et les passes), **incrémenter `ALGO_REVISION`** sinon rien n'est relu ; tester sans relire la vidéo : `python analysis/resolve.py --video N` ; mesurer : `evaluate.py`, `marks_eval.py`, `superpose.py` |
| Changer le nombre de processus | `EVA_WORKERS` ou `positions.MAX_WORKERS` |
| Ajouter une route d'API | lecture et écriture SQLite simples : `server/api.ts` `handleApi` ; tâche Python ou job : `server/analysisPlugin.ts` ; client : `src/lib/analysisApi.ts` ; types : `src/types/analysis.ts` ; tests `tests/server/api.test.ts` |
| Ajouter une colonne ou une table | `analysis/schema.sql` + migration dans `analysis/db.py` `connect` **et** `server/db.ts` `openDb` |
| Ajouter un onglet de premier niveau | `src/App.tsx` (type `View`, bouton dans `nav.tabs`, branche du rendu) ; un composant conteneur dans `src/components/...` ; un fichier CSS dans `src/styles/` importé dans `src/styles/index.css` ; mettre à jour `ARCHITECTURE.md` |
| Ajouter un sous-onglet à Lecture | `ReadingTab.tsx` (`SUBS`, classe `.subtabs`) |
| Modifier le style, les couleurs | couleurs : `src/styles/tokens.css` uniquement (variables `--c-*`) ; styles d'une zone : son fichier dans `src/styles/` ; composants communs : `ui-common.css` (`.help`, `.menu`, `.subtabs`, `.fold`) ; icônes : `lucide-react` avec `className="ic"` (`icons.css`) |
| Changer les calques de la vidéo | `VisionOverlay.tsx`, `src/lib/vision.ts`, menu dans `VideoPlayer.tsx` |
| Changer le replay | `ReplayPanel.tsx`, cadre : `src/lib/planInsets.ts`, `analysis/map_plan_insets.json` |
| Changer le dessin Stratégie | `MapCanvas.tsx` (`handleMouseDown`, `handleMouseUp`, `ShapeView`, `StuffRange`), `mapStore.ts`, `DrawToolbar.tsx` |

### Règles du projet à respecter (extraites de `CLAUDE.md`)
- **Langue et ponctuation** :
  - textes d'interface, commentaires et documentation en français ;
  - **aucun tiret quadratin** (le long tiret) : utiliser deux-points, virgule ou parenthèses ;
  - aucun emoji ni pictogramme Unicode dans l'interface : icônes `lucide-react`.
- **Interface sobre** :
  - pas de rangée de cases à cocher : menu « Calques » ou « Affichage » (`.menu`) ;
  - textes d'aide dans `<details className="help">` ;
  - une seule vue par sous-onglet ;
  - rien de plus large que l'écran (vérifier à 1440 et 420 pixels de large).
- **Organisation du code** : un fichier = une fonctionnalité, fonctions courtes et commentées. Couleurs seulement dans `tokens.css`, un fichier CSS par zone.
- **Données et calculs** :
  - incrémenter `tracking.ALGO_REVISION` à chaque changement de lecture ou de suivi ;
  - ne jamais coder 600 s (10 minutes) en dur : Outlaw dure 12 minutes ;
  - pour vérifier un instant d'une longue vidéo, utiliser ffmpeg (`names._grab`), jamais `cv2.VideoCapture.set(CAP_PROP_POS_MSEC)` (imprécis).
- **Sécurité de la machine** : ne jamais tuer un processus par son nom (navigateur et serveur de l'utilisateur). Au plus 3 processus de lecture, une seule analyse à la fois.
- **Fichiers** : le dépôt est en fins de ligne CRLF. Mettre `ARCHITECTURE.md` à jour à chaque fichier ajouté, renommé ou supprimé.

---

## 9. EXTRAITS DE CODE CLÉS

### 9.1 Source de la vidéo : `analysis/ingest.py` (fichier complet sauf les imports)
```python
# analysis/ingest.py
def is_url(source):
    return source.strip().lower().startswith(("http://", "https://"))


def clean_path(source):
    """Retire espaces et guillemets (Windows « Copier en tant que chemin » en ajoute)."""
    return source.strip().strip('"').strip("'")


def probe(path):
    out = subprocess.run(
        [
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=width,height,avg_frame_rate",
            "-show_entries", "format=duration",
            "-of", "json", str(path),
        ],
        capture_output=True, text=True, check=True, stdin=subprocess.DEVNULL,
    ).stdout
    data = json.loads(out)
    stream = data["streams"][0]
    num, den = stream["avg_frame_rate"].split("/")
    fps = float(num) / float(den) if float(den) else 0.0
    return {
        "duration_s": float(data["format"]["duration"]),
        "fps": fps,
        "width": int(stream["width"]),
        "height": int(stream["height"]),
    }


def download(url, cache_dir, on_progress):
    """Télécharge une vidéo (1080p max) en mp4 dans cache_dir et renvoie son chemin."""
    import yt_dlp

    cache_dir = Path(cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)

    def hook(d):
        if d["status"] == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            if total:
                on_progress(d["downloaded_bytes"] / total * 100)

    options = {
        "format": "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best[height<=1080]",
        "merge_output_format": "mp4",
        "outtmpl": str(cache_dir / "%(id)s.%(ext)s"),
        "progress_hooks": [hook],
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
    }
    with yt_dlp.YoutubeDL(options) as ydl:
        info = ydl.extract_info(url, download=True)
        return Path(ydl.prepare_filename(info)).with_suffix(".mp4")
```

### 9.2 Lecture du chrono : `analysis/timer.py`
```python
# analysis/timer.py
TEMPLATES_PATH = Path(__file__).with_name("digit_templates.npz")
GLYPH_SIZE = (12, 20)  # largeur, hauteur des chiffres normalisés
DARK = 80  # niveau de gris sous lequel un pixel est de l'encre
MIN_SCORE = 0.75  # corrélation minimale avec le meilleur modèle
MIN_MARGIN = 0.05  # écart minimal avec le deuxième meilleur modèle


def load_templates(path=TEMPLATES_PATH):
    data = np.load(path)
    return {k: data[k].astype(np.float32) for k in data.files}


def _runs(mask):
    runs, start = [], None
    for i, on in enumerate(mask):
        if on and start is None:
            start = i
        elif not on and start is not None:
            runs.append((start, i))
            start = None
    if start is not None:
        runs.append((start, len(mask)))
    return runs


def glyphs(crop):
    """Découpe le recadrage du chrono en 5 glyphes binaires (M, M, :, S, S), ou None si la mise en page est inattendue."""
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    # On écarte les coins arrondis de la boîte (sombres) en ne gardant que l'intérieur.
    y0, y1, x0, x1 = int(h * 0.12), int(h * 0.88), int(w * 0.10), int(w * 0.92)
    ink = (gray[y0:y1, x0:x1] < DARK).astype(np.uint8)
    rows = np.flatnonzero(ink.sum(axis=1) > 0)
    if rows.size == 0:
        return None
    ink = ink[rows[0] : rows[-1] + 1]
    runs = _runs(ink.sum(axis=0) > 0)
    if len(runs) != 5:
        return None
    out = []
    for a, b in runs:
        out.append(ink[:, a:b] * 255)
    return out


def _normalize(glyph):
    return cv2.resize(glyph, GLYPH_SIZE, interpolation=cv2.INTER_AREA).astype(np.float32).ravel() / 255.0


def _match(vec, templates):
    scores = []
    for label, tpl in templates.items():
        a, b = vec - vec.mean(), tpl - tpl.mean()
        denom = np.linalg.norm(a) * np.linalg.norm(b)
        scores.append((float(a @ b / denom) if denom else -1.0, label))
    scores.sort(reverse=True)
    best, second = scores[0], scores[1]
    if best[0] < MIN_SCORE or best[0] - second[0] < MIN_MARGIN:
        return None, best[0]
    return best[1], best[0]


def read_timer(crop, templates):
    """Renvoie le chrono en secondes restantes, ou None si illisible (HUD absent, image floue, autre écran)."""
    parts = glyphs(crop)
    if parts is None:
        return None
    digits = []
    for i in (0, 1, 3, 4):
        label, _ = _match(_normalize(parts[i]), templates)
        if label is None:
            return None
        digits.append(int(label))
    minutes = digits[0] * 10 + digits[1]
    seconds = digits[2] * 10 + digits[3]
    if seconds > 59:
        return None
    return minutes * 60 + seconds


def timer_box(zone, width, height):
    """Zone relative (x, y, w, h entre 0 et 1) -> rectangle en pixels (x, y, w, h), dimensions paires."""
    w = max(2, round(zone["w"] * width) // 2 * 2)
    h = max(2, round(zone["h"] * height) // 2 * 2)
    return round(zone["x"] * width), round(zone["y"] * height), w, h


def iter_crops(video, zone, width, height, step_s=1.0, t0=0.0, t1=None):
    """Génère (t, recadrage BGR du chrono) toutes les step_s secondes entre t0 et t1, décodé par ffmpeg (seule la zone sort du pipe)."""
    import subprocess

    x, y, w, h = timer_box(zone, width, height)
    cmd = [
        "ffmpeg", "-v", "error", "-an",
        *(["-ss", f"{t0:.2f}"] if t0 > 0 else []),
        *(["-t", f"{t1 - t0:.2f}"] if t1 is not None else []),
        "-i", str(video),
        "-vf", f"fps=1/{step_s},crop={w}:{h}:{x}:{y}",
        "-f", "rawvideo", "-pix_fmt", "bgr24", "-",
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    size = w * h * 3
    i = 0
    try:
        while True:
            buf = proc.stdout.read(size)
            if len(buf) < size:
                break
            yield t0 + i * step_s, np.frombuffer(buf, np.uint8).reshape(h, w, 3)
            i += 1
    finally:
        proc.stdout.close()
        proc.kill()
        proc.wait()
```
`iter_crops` sert aussi aux bandeaux, à la minimap et à la capture (zone et cadence différentes).

### 9.3 Découpage en games : `analysis/segments.py` (fichier complet sauf `fmt`)
```python
# analysis/segments.py
from statistics import median

PRE_ROLL_S = 3.0  # secondes gardées avant le départ du chrono (compte à rebours)
POST_ROLL_S = 1.0  # secondes gardées après la dernière lecture du chrono (écran de victoire)
MIN_GAME_S = 20.0
MIN_READINGS = 5
JUMP_UP_S = 5  # le chrono remonte de plus que ça : nouvelle game
UNREADABLE_DOUBT_S = 5.0
FROZEN_DOUBT_READINGS = 5
EARLY_END_S = 5  # chrono restant au-delà duquel la fin est à vérifier


def _drop_outliers(readings):
    """Retire les lectures isolées incohérentes avec leurs deux voisines (chiffre mal lu)."""
    kept = []
    for i, (t, v) in enumerate(readings):
        if 0 < i < len(readings) - 1:
            before, after = readings[i - 1][1], readings[i + 1][1]
            if before >= after and not (after - 2 <= v <= before + 2):
                continue
        kept.append((t, v))
    return kept


def _split(readings, gap_s):
    groups, gap_doubts = [], []
    current, doubts = [], []
    for t, v in readings:
        if current:
            pt, pv = current[-1]
            gap = t - pt
            jump_up = v > pv + JUMP_UP_S
            long_gap = gap > gap_s
            consistent = abs((pv - v) - gap) <= 3
            if jump_up or (long_gap and not consistent):
                groups.append((current, doubts))
                current, doubts = [], []
            elif gap >= UNREADABLE_DOUBT_S + 1:
                doubts.append({"start_s": pt, "end_s": t, "label": "Chrono illisible sur cette zone"})
        current.append((t, v))
    if current:
        groups.append((current, doubts))
    return groups


ORIGIN_READINGS = 40  # lectures de la suite cohérente examinées pour retrouver l'instant du départ
RUN_READINGS = 8  # une suite de lectures qui descendent d'une seconde par seconde, sur au moins ce nombre de lectures, est le vrai chrono


def _is_run(seg):
    """Vrai si les lectures descendent d'une seconde par seconde (à une seconde près : une lecture manquante allonge l'écart des deux côtés)
    ET que le chrono baisse vraiment d'autant que le temps passe : un chrono figé (compte à rebours, pause) n'est pas une suite."""
    if len(seg) < RUN_READINGS or not all(abs((a[1] - b[1]) - (b[0] - a[0])) <= 1 for a, b in zip(seg, seg[1:])):
        return False
    return (seg[0][1] - seg[-1][1]) >= 0.7 * (seg[-1][0] - seg[0][0])


def _origin(group, plateau):
    """Instant où le chrono a commencé à descendre. On cherche la première suite cohérente (une seconde par seconde) après le plateau : sur un replay
    brut le chrono peut afficher 12:00 (figé), 11:00 puis 10:00 avant de descendre vraiment, et le départ n'est alors pas à 12:00.
    Si la suite continue la valeur du plateau (normal), on extrapole jusqu'à l'instant où il l'a quittée ; sinon le départ est le début de la suite."""
    n = len(group)
    j = next((i for i in range(plateau, n) if _is_run(group[i : i + RUN_READINGS])), plateau)
    v_ref = group[j - 1][1] if j > 0 and abs(group[j - 1][1] - group[j][1]) <= 2 else group[j][1]
    return median(t - (v_ref - v) for t, v in group[j : j + ORIGIN_READINGS]) - 0.5


def _build_game(group, doubts, duration, pre_roll, post_roll):
    t_first, v_first = group[0]
    t_last, v_last = group[-1]
    doubts = list(doubts)

    plateau = 0
    while plateau < len(group) and group[plateau][1] == v_first:
        plateau += 1
    if plateau >= 2 and plateau < len(group):
        # Compte à rebours vu : on retrouve l'instant où le chrono a quitté sa valeur de départ.
        origin = _origin(group, plateau)
        start = max(0.0, origin - pre_roll)
    else:
        start = max(0.0, t_first - pre_roll)
        doubts.append(
            {
                "start_s": max(0.0, t_first - 30),
                "end_s": t_first + 5,
                "label": f"Début estimé : le chrono était déjà à {fmt(v_first)} quand la game est apparue",
            }
        )

    # Chrono figé en pleine game (pause ?).
    run_start = None
    for i in range(plateau, len(group) + 1):
        same = i < len(group) and i > 0 and group[i][1] == group[i - 1][1]
        if same and run_start is None:
            run_start = i - 1
        if not same and run_start is not None:
            if i - run_start >= FROZEN_DOUBT_READINGS:
                doubts.append(
                    {"start_s": group[run_start][0], "end_s": group[i - 1][0], "label": f"Chrono figé à {fmt(group[run_start][1])} (pause ?)"}
                )
            run_start = None

    end = min(duration, t_last + 1 + post_roll)
    if t_last + 2 >= duration and v_last > EARLY_END_S:
        doubts.append({"start_s": max(start, t_last - 10), "end_s": end, "label": f"La vidéo s'arrête avant la fin de la game (chrono à {fmt(v_last)})"})
    elif v_last > EARLY_END_S:
        doubts.append({"start_s": max(start, t_last - 5), "end_s": end, "label": f"Fin à vérifier : chrono arrêté à {fmt(v_last)}"})
    return {"start_s": start, "end_s": end, "doubts": doubts}


def _has_run(group):
    """Vrai si le chrono descend réellement quelque part dans le groupe (une suite d'au moins RUN_READINGS lectures qui baissent d'une seconde par seconde)."""
    return any(_is_run(group[i : i + RUN_READINGS]) for i in range(len(group) - RUN_READINGS + 1))


def detect_games(samples, duration, pre_roll=PRE_ROLL_S, post_roll=POST_ROLL_S, gap_s=30.0):
    """samples : liste de (t, secondes restantes ou None), triée par t. Renvoie les games détectées avec leurs doutes."""
    readings = _drop_outliers([(t, v) for t, v in samples if v is not None])
    games = []
    for group, doubts in _split(readings, gap_s):
        if len(group) < MIN_READINGS or group[-1][0] - group[0][0] < MIN_GAME_S:
            continue
        if not _has_run(group):
            continue  # chrono figé du début à la fin (compte à rebours d'une game qui n'a pas démarré, fin de session) : ce n'est pas une game
        games.append(_build_game(group, doubts, duration, pre_roll, post_roll))
    return games
```

### 9.4 Orchestration : `analysis/analyze.py` (`detect` et `run`)
```python
# analysis/analyze.py
ZONES_PATH = Path(__file__).with_name("default_zones.json")


def wait_if_paused(control):
    """Bloque tant que le fichier de contrôle existe (pause demandée par l'interface)."""
    while control and Path(control).exists():
        time.sleep(0.25)


def detect(path, meta, emit, pre_roll, post_roll, ranges=None, control=None):
    """Lit le chrono toutes les secondes (zone par défaut) et en déduit les games, sur toute la vidéo ou sur des plages."""
    zone = json.loads(ZONES_PATH.read_text(encoding="utf-8"))["timer"]
    templates = timer.load_templates()
    ranges = ranges or [(0.0, meta["duration_s"])]
    total = max(sum(b - a for a, b in ranges), 1)
    done, last_pct, games = 0.0, -1, []
    for a, b in ranges:
        samples = []
        for t, crop in timer.iter_crops(path, zone, meta["width"], meta["height"], t0=a, t1=b):
            wait_if_paused(control)
            samples.append((t, timer.read_timer(crop, templates)))
            pct = int(100 * (done + t - a) / total)
            if pct != last_pct:
                last_pct = pct
                emit({"event": "progress", "stage": "detect", "pct": pct})
        done += b - a
        games += segments.detect_games(samples, b, pre_roll=pre_roll, post_roll=post_roll)
    return games


def run(source, db_path, cache_dir, emit=print_event, do_detect=True, pre_roll=segments.PRE_ROLL_S, post_roll=segments.POST_ROLL_S, skip_if_ok=False, control=None, with_positions=False, pos_every=positions.EVERY_FRAMES, detect_only=False, redetect=False, games=None):
    """Analyse une vidéo en deux temps que l'utilisateur sépare :
      1. détection des games (chrono) et de leur carte ; elle n'est refaite que si la vidéo n'a encore aucune game ou si redetect est demandé,
         et elle conserve les games déjà analysées dont les bornes n'ont pas changé ;
      2. lecture détaillée (pseudos, équipements, score, kills, positions) game par game, dans l'ordre de `games` (identifiants) ou dans celui de la vidéo.
         Ce qui est déjà lu et à jour est sauté : rien n'est recalculé sauf si les réglages ou l'algorithme ont changé.
    detect_only : s'arrêter après l'étape 1 (l'utilisateur confirme les bornes avant l'analyse détaillée)."""
    conn = db.connect(db_path)
    source_url = None

    if ingest.is_url(source):
        emit({"event": "progress", "stage": "download", "pct": 0})
        path = ingest.download(
            source.strip(), cache_dir,
            lambda p: emit({"event": "progress", "stage": "download", "pct": round(p, 1)}),
        )
        source_url = source.strip()
    else:
        path = Path(ingest.clean_path(source))
        if not path.is_file():
            raise FileNotFoundError(f"Fichier introuvable : {path}")

    meta = ingest.probe(path)
    video_id = db.upsert_video(conn, str(path.resolve()), source_url, **meta)
    known = conn.execute("SELECT COUNT(*) AS n FROM games WHERE video_id = ?", (video_id,)).fetchone()["n"]

    detected_now = do_detect and (redetect or known == 0)
    if detected_now:
        emit({"event": "progress", "stage": "detect", "pct": 0})
        ok = db.ok_games(conn, video_id) if skip_if_ok else []
        ranges = gaps_around(ok, meta["duration_s"]) if ok else None
        found = detect(path, meta, emit, pre_roll, post_roll, ranges, control) if ranges != [] else []
        db.replace_detected_games(conn, video_id, found, keep_ok=skip_if_ok)
        if not conn.execute("SELECT 1 FROM games WHERE video_id = ?", (video_id,)).fetchone():
            db.drop_video_if_empty(conn, video_id)
            raise ValueError("Aucune game trouvée dans cette vidéo (chrono introuvable) : ce n'est pas une rediff EVA exploitable. Analyse arrêtée.")
    fill_maps(conn, video_id, path, meta, emit, control)  # ne lit que les games sans carte

    total = conn.execute("SELECT COUNT(*) AS n FROM games WHERE video_id = ?", (video_id,)).fetchone()["n"]
    if detect_only or not with_positions:
        message = f"{total} game(s) détectée(s)" if detected_now else f"{total} game(s) déjà détectée(s) : rien à relire"
        emit({"event": "done", "video_id": video_id, "message": message + (" : vérifie les bornes, puis lance l'analyse" if detect_only else "")})
        return

    all_ids = [r["id"] for r in conn.execute("SELECT id FROM games WHERE video_id = ? ORDER BY start_s", (video_id,))]
    order = [i for i in (games if games is not None else all_ids) if i in all_ids]
    db.confirm_games(conn, order)  # lancer l'analyse d'une game vaut confirmation de ses bornes
    step_s = pos_every / meta["fps"] if meta.get("fps") else positions.STEP_S
    problems, positions_read = [], 0
    for n, gid in enumerate(order, 1):
        def tag(event, n=n):
            if event.get("event") == "progress":
                event = {**event, "gameIndex": n, "gameCount": len(order)}
            emit(event)

        _, names_error = extract_names(conn, video_id, path, meta, tag, control, only=[gid])
        if names_error:
            problems.append(f"pseudos non lus ({names_error})")
        extract_loadouts(conn, video_id, path, meta, tag, control, only=[gid])
        extract_capture(conn, video_id, path, meta, tag, control, only=[gid])
        _, kills_error = extract_kills(conn, video_id, path, meta, tag, control, only=[gid])
        upgrade_kill_weapons(conn, video_id, path, meta, tag, control, only=[gid])
        if kills_error:
            problems.append(f"killfeed non lu ({kills_error})")
        positions_read += extract_positions(conn, video_id, path, meta, tag, control, step_s=step_s, only=[gid])
        infer_killers(conn, video_id, path, meta, tag, control, only=[gid])
    db.confirm_clean_games(conn, video_id, only=order)
    text = f"positions lues sur {positions_read} game(s) sur {len(order)}" if positions_read else "tout est déjà à jour : rien à relire"
    emit({"event": "done", "video_id": video_id, "message": " · ".join(dict.fromkeys(problems + [text]))})
```
`main()` lit les arguments `argparse` (section 6), appelle `run` et transforme toute exception en `{"event": "error", "message": str(exc)}`. Sous Windows, `sys.stdout.reconfigure(encoding="utf-8")`.

### 9.5 Enregistrement des games et zones : `analysis/db.py`
```python
# analysis/db.py
BOUNDS_TOLERANCE_S = 1.5  # écart toléré entre une borne posée à la main et la détection (1 lecture par seconde)
OK_SQL = "status = 'confirmed' AND checked = 1 AND doubts IS NULL AND map IS NOT NULL"


def replace_detected_games(conn, video_id, games, keep_ok=False):
    """Met à jour les games détectées d'une vidéo. Les games confirmées ne sont jamais touchées ni chevauchées : on vérifie seulement leurs bornes
    contre la détection. Une game détectée qui a les mêmes bornes (à BOUNDS_TOLERANCE_S près) qu'une détection précédente est GARDÉE telle quelle,
    avec ses pseudos, kills et positions : relancer la détection ne détruit pas une analyse déjà faite. Seules les games dont les bornes ont
    changé (autres réglages, autre détection) sont remplacées."""
    previous = [dict(r) for r in conn.execute("SELECT id, start_s, end_s FROM games WHERE video_id = ? AND status = 'detected' ORDER BY start_s", (video_id,))]
    confirmed = conn.execute("SELECT id, start_s, end_s FROM games WHERE video_id = ? AND status = 'confirmed'", (video_id,)).fetchall()
    skipped = {r["id"] for r in ok_games(conn, video_id)} if keep_ok else set()
    _check_confirmed(conn, [c for c in confirmed if c["id"] not in skipped], games)
    kept, added = set(), 0
    for g in games:
        if any(g["start_s"] < c["end_s"] and g["end_s"] > c["start_s"] for c in confirmed):
            continue
        doubts = json.dumps(g["doubts"], ensure_ascii=False) if g["doubts"] else None
        same = next((p for p in previous if p["id"] not in kept and abs(p["start_s"] - g["start_s"]) <= BOUNDS_TOLERANCE_S and abs(p["end_s"] - g["end_s"]) <= BOUNDS_TOLERANCE_S), None)
        if same:
            kept.add(same["id"])
            conn.execute("UPDATE games SET doubts = ? WHERE id = ?", (doubts, same["id"]))
            continue
        conn.execute("INSERT INTO games (video_id, start_s, end_s, status, doubts) VALUES (?, ?, ?, 'detected', ?)", (video_id, g["start_s"], g["end_s"], doubts))
        added += 1
    for p in previous:
        if p["id"] not in kept:
            conn.execute("DELETE FROM games WHERE id = ?", (p["id"],))
    conn.commit()
    return added


def zone_for(conn, map_name, zone):
    """Rectangle relatif d'une zone du HUD : calibration de l'utilisateur, sinon zone connue de la carte (map_zones.json), sinon zone par défaut."""
    if map_name:
        row = conn.execute("SELECT x, y, w, h FROM calibrations WHERE map = ? AND zone = ?", (map_name, zone)).fetchone()
        if row:
            return dict(row)
        known = json.loads(MAP_ZONES_PATH.read_text(encoding="utf-8")).get(map_name, {}).get(zone)
        if known:
            return known
    return json.loads(DEFAULT_ZONES_PATH.read_text(encoding="utf-8"))[zone]
```
`_check_confirmed` compare chaque game confirmée à la détection et écrit des doutes du type « Début posé trop tard de 4 s (la détection propose 120 s) ».

### 9.6 Bandeaux des joueurs : `analysis/banners.py` (`_white_frame`, `read_team`, `read_states`)
```python
# analysis/banners.py
COLORED = {"S": 100, "V": 140}  # pixel « coloré » (couleur de l'équipe)
FILL_COLUMNS = (0.34, 0.80)  # colonnes examinées : hors portrait (à gauche) et hors points de vie (à droite)
ROW_COLORED = 0.35  # une ligne du bandeau est « remplie » si au moins cette part de ses pixels est colorée
MIN_FILL = 0.015  # remplissage minimal (part de la hauteur) pour être vivant : un bandeau de mort est entièrement gris (0,00) ; un joueur vivant à 1 ou 2 points de vie garde un mince filet (0,02), mesuré
FRAME_V, FRAME_S = 200, 130  # pixel du cadre blanc : clair et peu saturé (teinté de bleu ou d'orange sur certaines vidéos : saturation jusqu'à 120)
FRAME_TOP_ROWS = 3  # le trait du haut du cadre est dans ces premières lignes du bandeau
FRAME_TOP_SHARE = 0.7  # part de la largeur du trait du haut qui doit être blanche
FRAME_BOTTOM_ROWS = 30  # le trait du bas est cherché dans ces dernières lignes (la zone du bandeau déborde parfois sous le bandeau)
FRAME_BOTTOM_SHARE = 0.75  # part de la largeur d'une ligne du trait du bas qui doit être blanche
FRAME_BOTTOM_THICKNESS = (2, 6)  # épaisseur (lignes) du trait du bas : une zone claire plus épaisse est le décor derrière le bandeau


def _banner(crop, index, n=4):
    h, w = crop.shape[:2]
    bw = w / n
    return crop[:, int(index * bw) : int((index + 1) * bw)]


def _white_frame(hsv):
    """(part blanche du trait du haut, vrai si le bandeau est entouré du cadre blanc du joueur observé). Le cadre a un trait en haut (première ou deux premières
    lignes) et un trait fin en bas ; seuls le haut et le bas comptent, les côtés se confondent avec le cadre des bandeaux voisins. Mesuré sur trois games :
    une seule personne observée par image dans 69 à 76 images sur 80 (l'ancien test, trop strict sur la saturation et sur la position du bas : 3 sur 80 pour une des games)."""
    h, w = hsv.shape[:2]
    x0, x1 = int(0.08 * w), int(0.92 * w)
    white = (hsv[:, x0:x1, 2] >= FRAME_V) & (hsv[:, x0:x1, 1] <= FRAME_S)
    rows = white.mean(axis=1)
    top = float(rows[:FRAME_TOP_ROWS].max())
    lo, hi = FRAME_BOTTOM_THICKNESS
    bottom = any(lo <= n <= hi for n in _runs(rows[-FRAME_BOTTOM_ROWS:] >= FRAME_BOTTOM_SHARE))
    return top, top >= FRAME_TOP_SHARE and bottom


def read_team(crop, n=4):
    """[{ "alive", "spectated", "fill" }] pour les n bandeaux d'une équipe.

    Le fond du bandeau se remplit de la couleur de l'équipe depuis le bas, proportionnellement aux points de vie : pleine hauteur à 100,
    à moitié à 50, et entièrement grisé à 0 (joueur mort). « fill » est la part de hauteur colorée (≈ points de vie)."""
    out = []
    for i in range(n):
        banner = _banner(crop, i, n)
        h, w = banner.shape[:2]
        hsv = cv2.cvtColor(banner, cv2.COLOR_BGR2HSV)
        cols = hsv[:, int(FILL_COLUMNS[0] * w) : int(FILL_COLUMNS[1] * w)]
        colored = (cols[:, :, 1] >= COLORED["S"]) & (cols[:, :, 2] >= COLORED["V"])
        rows = colored.mean(axis=1) >= ROW_COLORED
        fill = float(rows[int(0.1 * h) :].mean())
        top, spectated = _white_frame(hsv)
        out.append({"alive": fill >= MIN_FILL, "spectated": spectated, "fill": round(fill, 2), "white_border": round(top, 2)})
    return out


def read_states(crop_a, crop_b):
    """{slot: {"alive", "spectated"}} pour les 8 slots (1 à 4 : équipe de gauche, 5 à 8 : équipe de droite)."""
    states = {}
    for base, crop in ((1, crop_a), (5, crop_b)):
        if crop is None:
            continue
        for i, st in enumerate(read_team(crop)):
            states[base + i] = st
    return states
```
Le fichier contient aussi `_runs` (longueurs des suites de valeurs vraies) et `confirm_death(video, bar_zone, width, height, t, index, offsets, end_s)`. Cette dernière lit le bandeau de la victime 1,2, 2,2 et 3,2 s après un kill (`names._grab`) : `True` si au moins 2 images sur 3 sont grisées, `None` si moins de 2 images sont lisibles (écran noir).

### 9.7 Lancement d'une analyse : `server/analysisPlugin.ts` (route `POST /api/ingest`)
```ts
// server/analysisPlugin.ts
          if (url.pathname === '/api/ingest' && method === 'POST') {
            const body = (await readJson(req)) as { source?: unknown; detect?: unknown; preRoll?: unknown; postRoll?: unknown; skipIfOk?: unknown; positions?: unknown; posEvery?: unknown; detectOnly?: unknown; redetect?: unknown; games?: unknown } | undefined;
            const source = typeof body?.source === 'string' ? body.source.trim() : '';
            if (!source) return sendJson(res, 400, { error: 'Indique un chemin de fichier ou une URL' });
            try {
              const extra: string[] = [];
              if (body?.detect === false) extra.push('--no-detect');
              if (typeof body?.preRoll === 'number' && Number.isFinite(body.preRoll) && body.preRoll >= 0 && body.preRoll <= 60) {
                extra.push(`--pre-roll=${body.preRoll}`);
              }
              if (typeof body?.postRoll === 'number' && Number.isFinite(body.postRoll) && body.postRoll >= 0 && body.postRoll <= 120) {
                extra.push(`--post-roll=${body.postRoll}`);
              }
              if (body?.skipIfOk === true) extra.push('--skip-if-ok');
              if (body?.positions === true) extra.push('--positions');
              if (body?.detectOnly === true) extra.push('--detect-only');
              if (body?.redetect === true) extra.push('--redetect');
              // Games à analyser en détail, dans l'ordre voulu (identifiants entiers seulement : jamais de texte libre dans la ligne de commande).
              if (Array.isArray(body?.games) && body.games.length > 0 && body.games.length <= 200 && body.games.every((g) => Number.isInteger(g) && g > 0)) extra.push(`--games=${body.games.join(',')}`);
              if (Number.isInteger(body?.posEvery) && (body?.posEvery as number) >= 1 && (body?.posEvery as number) <= 60) extra.push(`--pos-every=${body?.posEvery}`);
              const controlPath = join(root, 'data', 'job.control');
              const job = jobs.start(python, [script, `--source=${source}`, '--db', dbPath, '--cache', cacheDir, `--control=${controlPath}`, ...extra], controlPath);
              return sendJson(res, 202, { jobId: job.id });
            } catch (err) {
              return sendJson(res, 409, { error: (err as Error).message });
            }
          }
```

### 9.8 Processus d'analyse et événements : `server/jobs.ts` (classes `Job` et `JobManager`, complètes)
```ts
// server/jobs.ts
export interface JobEvent {
  event: string;
  [key: string]: unknown;
}

type Listener = (event: JobEvent) => void;

export class Job {
  readonly id = randomUUID();
  readonly events: JobEvent[] = [];
  finished = false;
  paused = false;
  private listeners = new Set<Listener>();
  private stdoutBuffer = '';
  private stderrTail = '';
  private child: ChildProcess;
  private controlPath: string | undefined;

  constructor(command: string, args: string[], controlPath?: string) {
    this.controlPath = controlPath;
    this.setPaused(false);
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });

    this.child = child;

    child.stdout.setEncoding('utf-8');
    child.stdout.on('data', (chunk: string) => {
      this.stdoutBuffer += chunk;
      const lines = this.stdoutBuffer.split('\n');
      this.stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) this.handleLine(line);
    });

    child.stderr.setEncoding('utf-8');
    child.stderr.on('data', (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-2000);
    });

    child.on('error', (err) => this.finish({ event: 'error', message: `Impossible de lancer ${command} : ${err.message}` }));
    child.on('close', (code) => {
      if (this.stdoutBuffer.trim()) this.handleLine(this.stdoutBuffer);
      if (this.finished) return;
      const detail = this.stderrTail.trim().split('\n').slice(-3).join(' ');
      this.finish({ event: 'error', message: detail || `Le script s'est arrêté (code ${code})` });
    });
  }

  // La pause passe par un fichier de contrôle que le script consulte entre deux étapes.
  private setPaused(paused: boolean) {
    this.paused = paused;
    if (!this.controlPath) return;
    if (paused) writeFileSync(this.controlPath, 'pause');
    else rmSync(this.controlPath, { force: true });
  }

  pause() {
    if (!this.finished) this.setPaused(true);
  }

  resume() {
    this.setPaused(false);
  }

  /** Arrête le script (et ffmpeg, lancé par lui). Rien n'est écrit en base : les résultats sont enregistrés à la fin. */
  stop() {
    if (this.finished) return;
    this.setPaused(false);
    const pid = this.child.pid;
    if (process.platform === 'win32' && pid) spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    else this.child.kill('SIGTERM');
    this.finish({ event: 'error', message: 'Analyse arrêtée' });
  }

  private handleLine(line: string) {
    if (!line.trim()) return;
    try {
      const event = JSON.parse(line) as JobEvent;
      if (event.event === 'done' || event.event === 'error') this.finish(event);
      else this.push(event);
    } catch {
      // Ligne qui n'est pas du JSON : ignorée (sortie parasite d'une bibliothèque).
    }
  }

  private push(event: JobEvent) {
    this.events.push(event);
    for (const listener of this.listeners) listener(event);
  }

  private finish(event: JobEvent) {
    if (this.finished) return;
    this.finished = true;
    this.setPaused(false);
    this.push(event);
  }

  /** Rejoue l'historique puis suit les nouveaux événements. Renvoie la fonction de désabonnement. */
  subscribe(listener: Listener): () => void {
    for (const event of this.events) listener(event);
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export class JobManager {
  private jobs = new Map<string, Job>();
  private current: Job | null = null;

  start(command: string, args: string[], controlPath?: string): Job {
    if (this.current && !this.current.finished) throw new Error('Une analyse est déjà en cours');
    const job = new Job(command, args, controlPath);
    this.jobs.set(job.id, job);
    this.current = job;
    return job;
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  /** L'analyse en cours, s'il y en a une (pour que la page se reconnecte après un rechargement). */
  running(): Job | null {
    return this.current && !this.current.finished ? this.current : null;
  }
}
```
Message d'erreur affiché quand Python plante (par exemple `ModuleNotFoundError`) : les 3 dernières lignes de stderr (`stderrTail`).

### 9.9 Côté navigateur : `src/store/analysisStore.ts` (`watchJob`, `startAnalysis`, `startIngest`) et `src/lib/analysisApi.ts` (`subscribeJob`)
```ts
// src/store/analysisStore.ts
  const watchJob = (jobId: string) =>
    subscribeJob(jobId, (e: JobEvent) => {
      if (e.event === 'progress') {
        const previous = get().job.gameIndex;
        if ((e.gameIndex ?? 0) > previous && previous > 0) void get().refreshGames().catch(() => undefined); // la game précédente est enregistrée en entier : replay et positions disponibles sans attendre la fin
        set({ job: { running: true, jobId, paused: get().job.paused, stage: e.stage ?? null, pct: e.pct ?? 0, gameIndex: e.gameIndex ?? 0, gameCount: e.gameCount ?? 0, error: null, message: null } });
      } else if (e.event === 'done') {
        set({ job: { ...idleJob, message: e.message ?? 'Vidéo chargée' } });
        void get()
          .loadVideos()
          .then(() => (e.video_id ? get().selectVideo(e.video_id) : undefined))
          // Les nouvelles icônes sont nommées d'après les modèles verrouillés ; seules celles de forme inconnue sont demandées à l'utilisateur.
          .then(() => analysisApi.auditWeapons().catch(() => undefined))
          .then(() => analysisApi.guessWeapons().catch(() => undefined))
          .then(() => get().loadWeapons(true))
          .catch((err: Error) => set({ job: { ...idleJob, error: err.message } }));
      } else {
        set({ job: { ...idleJob, error: e.message ?? 'Erreur inconnue' } });
      }
    });

  // ...

  startAnalysis: async (gameIds) => {
    const video = get().videos.find((v) => v.id === get().videoId);
    if (!video || gameIds.length === 0) return;
    const { preRoll, postRoll, posEvery } = get().options;
    await get().startIngest(video.path, { preRoll, postRoll, withPositions: true, posEvery, games: gameIds });
  },

  startIngest: async (source, { preRoll, postRoll, skipIfOk, withPositions, posEvery, detectOnly, redetect, games } = {}) => {
    stopBeforeStart = false;
    set({ job: { ...idleJob, running: true } });
    try {
      const { jobId } = await analysisApi.ingest(source, { preRoll, postRoll, skipIfOk, positions: withPositions, posEvery, detectOnly, redetect, games });
      if (stopBeforeStart) {
        stopBeforeStart = false;
        await analysisApi.jobControl(jobId, 'stop').catch(() => undefined);
        set({ job: { ...idleJob, error: 'Analyse arrêtée' } });
        return;
      }
      set({ job: { ...get().job, jobId } });
      watchJob(jobId);
    } catch (err) {
      set({ job: { ...idleJob, error: (err as Error).message } });
    }
  },
```
```ts
// src/lib/analysisApi.ts
/** Suit un job d'analyse en SSE. Renvoie la fonction pour fermer la connexion. */
export function subscribeJob(jobId: string, onEvent: (e: JobEvent) => void): () => void {
  const source = new EventSource(`/api/jobs/${jobId}/events`);
  source.onmessage = (msg) => {
    const event = JSON.parse(msg.data) as JobEvent;
    onEvent(event);
    if (event.event === 'done' || event.event === 'error') source.close();
  };
  source.onerror = () => {
    source.close();
    onEvent({ event: 'error', message: 'Connexion au serveur perdue' });
  };
  return () => source.close();
}
```

### Repère : la fonction d'entrée du suivi (non recopiée, trop longue)
`analysis/tracking.py` :
```python
def solve(frames, step_s, deaths=None, states=None, teleports=None, walk_points=None, walk_mask=None, noise=None, spawns=None,
          reliability=None, coherence_out=None, marks=None, kills=None, stations=None, rotors=None, doors=None, see=None, dead_marks=None):
    # -> liste triée de (frame, t, slot, team, x, y, angle, alive, confiance)
```
Ordre des passes :
1. filtrage des détections (bandeaux, bruit, masque praticable) ;
2. liaison en trajectoires (`_link`) ;
3. attribution des joueurs par vote, continuité ou élimination (`_assign`) ;
4. croix de mort (`_attach_crosses`) ;
5. interpolation par les couloirs et les tyroliennes ;
6. regards (`_choose_directions`, `_smooth_angles`) ;
7. corrections à la main (`apply_marks`) ;
8. comblement guidé par les bandeaux (`recover_from_unused`, `share_stacks`, `bridge_gaps`) ;
9. morts ;
10. lissages (`remove_excursions`, `smooth_unsure`, `despike`, `snap_to_walkable`, `rotor_snap`, `prestart_in_spawn`) ;
11. règles de regard (`observed_enemy_gaze`, `tp_gaze`, `duel_gaze`, `kill_gaze`) ;
12. `separate_players`, puis les corrections à la main en dernier (`apply_marks(final=True)`, `apply_dead_marks`).
