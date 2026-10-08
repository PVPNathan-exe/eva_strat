# EVA Strat

Planificateur tactique pour le jeu **EVA**.

En tant qu'admin tu peux :

- importer une **image de plan** d'une carte (sert de fond) ;
- **dessiner des murs** par-dessus *(à venir)* ;
- gérer plusieurs **étages** (jusqu'à 3 niveaux, reliés par ascenseurs) ;
- afficher une **vision joueur en cône** qui bute sur les murs *(à venir)* ;
- déplacer les **joueurs** entre les étages *(à venir)* ;
- **sauvegarder** la config (murs + étages) par carte (auto dans le navigateur + export/import JSON) pour ne pas tout refaire.

## Stack

- [Vite](https://vite.dev/) + React + TypeScript
- [Konva](https://konvajs.org/) / `react-konva` : canvas interactif
- [Zustand](https://github.com/pmndrs/zustand) : état global + persistance `localStorage`

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

**Cohérence des positions** : les pastilles lues image par image sont reliées dans le temps (`analysis/tracking.py`) : chaque trajectoire reçoit son joueur par vote de tous ses numéros lus, les croix sont rattachées au joueur qui vient de s'arrêter à cet endroit, les disparitions courtes sont comblées et les directions sont lissées (le sens est choisi sur toute la trajectoire, pas image par image). Les positions déjà lues avec un ancien algorithme sont refaites automatiquement.

**Direction des joueurs** : l'axe de la pastille est mesuré sur sa forme (stable) ; le sens (avant ou arrière) vient de l'asymétrie de la goutte, de la silhouette complète pour le joueur observé (blanc plus liseré coloré) et du déplacement : un joueur regarde presque toujours là où il court, ce qui tranche quand la forme est ambiguë. Le sens est choisi sur toute la trajectoire.

**Réglage automatique du suivi** (`analysis/tune.py`) : les réglages du suivi sont dans `analysis/tracking_params.json` (versionné : un `git pull` sur un autre PC les retrouve). Pour les améliorer avec de nouvelles rediffs : charger la vidéo et lancer « Analyser » (les games et leurs cartes doivent être justes), puis `python analysis/tune.py build --video "chemin.mp4" --name ceres-2` (extrait les détections dans `analysis/datasets/`, sans avoir besoin de la vidéo ensuite), `python analysis/tune.py eval` (note actuelle) et `python analysis/tune.py search --minutes 10` (cherche de meilleurs réglages ; ils ne sont sauvegardés que s'ils font mieux, et la recherche repart toujours des meilleurs connus). La note vient d'un test sans vérité manuelle : 70 % des numéros lus sur les pastilles sont cachés, et on regarde si le suivi retrouve le bon joueur. Plusieurs vidéos d'une même carte avec des déplacements différents rendent les réglages plus généraux. L'historique de toutes les sauvegardes est dans `analysis/tracking_params.history.jsonl`.

**Pseudos** : les 8 pseudos de chaque game sont lus sur les bandeaux du haut (reconnaissance de texte intégrée à Windows, sans installation), par vote sur plusieurs images ; un pseudo tronqué par le jeu suffit, il sert seulement à reconnaître le joueur. L'ordre des bandeaux donne le numéro 1 à 8. Ils s'affichent en infobulle dans le replay, et la case « Pseudos » les écrit près des pastilles. Les zones « Équipe gauche/droite » du HUD incluent les numéros, et deux zones « % de capture » (une par équipe) sont calibrables en vue de la lecture des captures.

**Noms déduits** : le nom d'une arme du killfeed est déduit de l'équipement du tueur (l'arme d'un kill est forcément dans son équipement) : si une icône revient chez plusieurs tueurs qui n'ont qu'une arme nommée en commun, c'est elle ; si aucune arme n'est commune mais que tous les tueurs ont une grenade équipée, c'est le logo générique « GRENADE », qui n'est pas affiché dans l'onglet Armes. Un nom déduit est marqué « deviné » ; un nom saisi passe toujours avant. Plus il y a de games analysées, plus le programme en déduit.

**Armes inconnues** : après chaque analyse, si le programme a rencontré des icônes d'armes qu'il ne connaît pas, une fenêtre demande leur nom (propositions tirées de l'onglet Stratégie ; « Plus tard » la ferme jusqu'à la prochaine nouveauté), et l'onglet Armes affiche le nombre d'icônes sans nom. Pour un kill à la grenade, le logo du killfeed est le même pour toutes les grenades : le programme prend alors la grenade équipée par le tueur (DX3 ou STICKY, lue sur son bandeau).

**Arme d'un kill** : elle n'est plus lue sur l'icône du killfeed (trop petite, trop sale) mais sur le bandeau du tueur : l'arme tenue (en noir) juste avant l'entrée du killfeed, relue à ce moment-là car l'équipement change à la réapparition. Pour une grenade (logo compact du killfeed), c'est le gadget du tueur, et seules les grenades DX3 et STICKY comptent. Si le bandeau est ambigu, l'arme reste vide plutôt que devinée. Un tueur illisible est déduit par élimination (adversaires en vie, arme tenue, distance à la victime) seulement si c'est cohérent, et marqué « déduit ».

**Signaler une icône** : sur chaque icône de l'onglet Armes, « Signaler » ouvre une fenêtre qui relit les bandeaux autour des endroits où l'icône a été vue et propose des images. « Recalculer automatiquement » moyenne les images nettes, entières et de la bonne forme ; on peut aussi désigner une image comme modèle. Pour un nom deviné par le programme, « Bon » le confirme et « Pas bon » ne le fait plus reproposer. Les avis sont dans `analysis/weapon_icons/reviews.json`. Après un recalcul, relancer « Analyser » pour que les kills et l'équipement en profitent.

**Onglet Armes** : toutes les icônes vues par l'analyse y sont rangées en trois catalogues : les armes du killfeed (W…), les deux armes de chaque joueur lues sur les bandeaux (B…, l'arme tenue en noir, l'autre en pâle) et les gadgets (G…). On tape le nom sous chaque logo ; il est enregistré dans `analysis/weapon_icons/names.json` (versionné, comme les icônes) et affiché dans la liste des kills. Plusieurs icônes peuvent porter le même nom. Dans le killfeed, la petite cible est le marqueur de headshot (retirée de l'icône de l'arme) ; un kill sans tueur est une mort du décor ou d'un admin ; le même pseudo des deux côtés est un suicide.

**Score de capture** : les pourcentages de chaque équipe (de part et d'autre du chrono, zones « % de capture » calibrables) sont lus chiffre par chiffre à partir de modèles (`analysis/capture_digits.npz`), nettoyés (valeurs aberrantes écartées, petits trous comblés) et tracés sous le replay ; un clic sur la courbe déplace le replay.

**Killfeed** : le killfeed (haut droite) est lu par ligne : le pseudo du tueur et celui de la victime sont reconnus parmi les 8 de la game (lecture approximative acceptée), avec l'heure du kill. L'icône d'arme est comparée à des modèles (`analysis/weapon_icons/`) ; une icône nouvelle devient « W1 », « W2 »… et on la nomme en l'écrivant dans `analysis/weapon_icons/names.json` (`{"W1": "Blaster"}`). Les morts du killfeed corrigent le suivi : une croix manquée sur la minimap est reposée à la dernière position du joueur. Les kills sont listés sous le replay (clic = aller au moment dans la vidéo).

**Correction manuelle** : si le suivi a échangé deux joueurs de la même équipe, ouvre « Corriger le suivi » sous le replay, clique sur leurs deux pastilles (ou choisis-les dans les listes) et la durée à partir de l'instant affiché, puis « Échanger ». La correction est enregistrée, listée (et annulable), et réappliquée automatiquement si les positions sont relues.

**Commentaires** : sous la vidéo, une zone de commentaires liés à un instant. Un clic dans le champ met la vidéo en pause et fige l'instant ; on choisit une catégorie (suivi, équipe, note) et, si besoin, les joueurs concernés ; Ctrl + Entrée ajoute. Chaque commentaire ramène la vidéo 2 secondes avant, apparaît comme un repère sur la timeline, indique sa game et le temps dans la game, et peut être marqué traité. « Copier le texte » met les commentaires en attente dans le presse-papiers, prêts à coller dans une conversation pour décrire ce qui ne va pas dans le suivi ; ils sont aussi dans la table `comments` de `data/eva.db`.

**Replay** : une fois les positions lues, sélectionner une game affiche un replay sur le plan de sa carte (joueurs numérotés, direction, ✕ pour un mort, traînées en option). Il suit la vidéo ou se rejoue seul (lecture, vitesse jusqu'à 8×), les joueurs se masquent un par un, et « Alignement sur le plan » ajuste le cadre de la minimap sur l'image du plan (mémorisé par carte).

**Analyse longue** : l'analyse tourne sur le serveur de développement, pas dans la page : changer d'onglet ou recharger la page ne l'interrompt pas, et la page se reconnecte toute seule à l'analyse en cours (progression, pause, arrêt). Elle s'arrête si `npm run dev` est fermé ; les games déjà terminées sont conservées et ne sont pas relues.

**Utilisation** : `npm run dev`, onglet « Analyse », charger la vidéo, « Analyser » : détecte les games (sans rien relire si elles sont déjà vérifiées) puis, une fois le chantier 2 livré, extrait les positions des joueurs. « Détecter les games » ne fait que la partie games. Le champ « Positions : toutes les N frames » règle la cadence de lecture de la minimap (6 par défaut, soit 5 lectures par seconde à 30 i/s) : plus N est petit, plus c'est précis et fluide, au prix d'une analyse plus longue ; changer N relit les positions des games déjà lues. Les positions (minimap : équipe, numéro, position normalisée, direction, vivant) sont lues chaque seconde et stockées dans la table `samples` ; elles ne sont relues que pour les games qui n'en ont pas (déplacer une borne les efface). Les chiffres de la minimap se lisent par modèles (`analysis/minimap_digits.npz`) et, pour l'équipe bleue, par comptage de trous (6, 8, 9).
Les données sont dans `data/eva.db` (SQLite, ignoré par git) ; les vidéos YouTube téléchargées sont dans `data/cache/`.
Les vidéos locales ne sont jamais copiées.

**Réglages** : variable d'environnement `EVA_PYTHON` pour utiliser un autre exécutable Python que `python`.

**Tests** : `npm test` (Node et Python).
