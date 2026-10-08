# EVA Strat

Planificateur tactique pour le jeu **EVA**.

En tant qu'admin tu peux :

- importer une **image de plan** d'une carte (sert de fond) ;
- **dessiner des murs** par-dessus *(à venir)* ;
- gérer plusieurs **étages** (jusqu'à 3 niveaux, reliés par ascenseurs) ;
- afficher une **vision joueur en cône** qui bute sur les murs *(à venir)* ;
- déplacer les **joueurs** entre les étages *(à venir)* ;
- **sauvegarder** la config (murs + étages) par carte — auto dans le navigateur + export/import JSON — pour ne pas tout refaire.

## Stack

- [Vite](https://vite.dev/) + React + TypeScript
- [Konva](https://konvajs.org/) / `react-konva` — canvas interactif
- [Zustand](https://github.com/pmndrs/zustand) — état global + persistance `localStorage`

## Démarrer

```bash
npm install
npm run dev      # serveur de dev (http://localhost:5173)
npm run build    # build de production
npm run preview  # prévisualiser le build
```

> Note : si `npm` échoue avec une erreur de certificat SSL (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`),
> lance avec `NODE_OPTIONS=--use-system-ca`.

## Structure

```
src/
  types/map.ts          Modèle de données (cartes, étages, murs, joueurs)
  store/mapStore.ts      État global + auto-save localStorage (clé "eva_strat:maps")
  lib/storage.ts         Export/import JSON + lecture d'image en data URL
  components/
    MapCanvas.tsx        Rendu du fond de carte + murs (Konva)
    Toolbar.tsx          Gestion cartes, import image, export/import JSON
    FloorSelector.tsx    Sélecteur d'étage
  App.tsx
```

## Roadmap

- [ ] Outil de dessin de murs (polyligne) + édition/suppression
- [ ] Zones d'ascenseur reliant les étages
- [ ] Vision joueur en cône (raycasting contre les murs)
- [ ] Placement et déplacement des joueurs entre étages

## Onglet Analyse

On charge un .mp4 (bouton « Parcourir… » ou chemin collé) ou une URL YouTube, puis on pose soi-même les marqueurs de début et de fin de chaque game.

**Prérequis** : Python 3.10+, ffmpeg dans le PATH, puis `python -m pip install -r analysis/requirements.txt`.

**Source de la vidéo** : il faut un fichier **.mp4** local. Pour une vidéo YouTube, l'extraire d'abord avec [4K Video Downloader](https://www.4kdownload.com/) (en 1080p ou plus, la minimap est illisible en 360p), puis charger le .mp4 obtenu. Le téléchargement direct par URL (yt-dlp) est souvent bloqué par YouTube.

**Détection des games** : à l'analyse, le chrono (boîte grise sous le logo) est lu chaque seconde. Une game commence quand le chrono quitte sa valeur de départ (10:00, 12:00… selon la carte) ; la « marge » de la barre du haut garde quelques secondes avant ce départ (« Avant ») et quelques secondes après la dernière lecture du chrono pour inclure l'écran de victoire (« Après »). Les games détectées sont à confirmer, et les passages incertains (chrono illisible, pause, vidéo coupée…) sont hachurés en orange sur la timeline. Le bouton « Détecter les games » relance la détection sur la vidéo choisie, sauf si toutes ses games sont déjà confirmées, vérifiées (aucune zone à vérifier) et munies d'une carte. Le nom de la carte (sous le chrono) est lu automatiquement à partir de modèles rangés dans `analysis/map_names/` : une carte sans modèle reste vide, et choisir sa carte à la main sur une game suffit pour que la prochaine analyse la reconnaisse. Les modèles de chiffres (`analysis/digit_templates.npz`) se régénèrent avec `analysis/build_templates.py` si la police du chrono change.

**Replay** : une fois les positions lues, sélectionner une game affiche un replay sur le plan de sa carte (joueurs numérotés, direction, ✕ pour un mort, traînées en option). Il suit la vidéo ou se rejoue seul (lecture, vitesse jusqu'à 8×), les joueurs se masquent un par un, et « Alignement sur le plan » ajuste le cadre de la minimap sur l'image du plan (mémorisé par carte).

**Utilisation** : `npm run dev`, onglet « Analyse », charger la vidéo, « Analyser » : détecte les games (sans rien relire si elles sont déjà vérifiées) puis, une fois le chantier 2 livré, extrait les positions des joueurs. « Détecter les games » ne fait que la partie games. Le champ « Positions : toutes les N frames » règle la cadence de lecture de la minimap (6 par défaut, soit 5 lectures par seconde à 30 i/s) : plus N est petit, plus c'est précis et fluide, au prix d'une analyse plus longue ; changer N relit les positions des games déjà lues. Les positions (minimap : équipe, numéro, position normalisée, direction, vivant) sont lues chaque seconde et stockées dans la table `samples` ; elles ne sont relues que pour les games qui n'en ont pas (déplacer une borne les efface). Les chiffres de la minimap se lisent par modèles (`analysis/minimap_digits.npz`) et, pour l'équipe bleue, par comptage de trous (6, 8, 9).
Les données sont dans `data/eva.db` (SQLite, ignoré par git) ; les vidéos YouTube téléchargées sont dans `data/cache/`.
Les vidéos locales ne sont jamais copiées.

**Réglages** : variable d'environnement `EVA_PYTHON` pour utiliser un autre exécutable Python que `python`.

**Tests** : `npm test` (Node et Python).
