# EVA Strat

Planificateur tactique et analyse de rediffusions pour le jeu **EVA**. Quatre onglets :

- **Stratégie** : importer le **plan** d'une carte, le dessiner (lignes, rectangles, cercles, crayon, couleur et épaisseur), gérer jusqu'à 3 **étages**, poser des **armes** avec leur portée (échelle à calibrer), **sauvegarder** par carte (automatique dans le navigateur, export et import JSON).
- **Analyse** : lire une vidéo de partie (.mp4) : repérage des games par le chrono, pseudos, équipement, kills, score de capture et **positions et regards des joueurs** sur la minimap, replay sur le plan, commentaires liés à un instant.
- **Lecture** : ce que le programme sait d'une carte (couloirs, tyroliennes, zones de départ, points de capture), la forme des joueurs lue sur la minimap, et la **cartographie à la main** qui construit les masques des cartes.
- **Armes** : nommer les icônes d'armes vues par l'analyse.

L'analyse fonctionne sous **Windows** (la reconnaissance de texte des pseudos et du killfeed utilise celle de Windows) : un conteneur Docker ne convient donc pas, `npm start` fait l'installation.

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

## Documentation de reprise

- [`docs/CHANGER_DE_PC.md`](docs/CHANGER_DE_PC.md) : installer le projet sur un autre PC et ce qui n'est pas dans Git (base, vidéos, réglages du navigateur).
- [`docs/PLAN_RESTANT.md`](docs/PLAN_RESTANT.md) : où en est l'onglet Analyse, ce qui reste à faire dans l'ordre.
- [`docs/PLAN_OPTIMISATIONS.md`](docs/PLAN_OPTIMISATIONS.md) : pistes pour analyser plus vite, avec les mesures de référence (`python analysis/benchmark.py`).

## Structure

La carte complète du projet (fichiers, routes de l'API, flux de données) est dans [`ARCHITECTURE.md`](ARCHITECTURE.md), à lire avant de chercher ou de créer un fichier. En bref :

```
src/            site (React, Konva, Zustand) : onglets Stratégie, Analyse, Lecture, Armes
server/         API d'analyse (plugin du serveur Vite, SQLite) et lancement des analyses
analysis/       lecture des vidéos (Python, OpenCV, ffmpeg) et cartes (masques, tyroliennes, zones de départ)
tests/          tests du site et du serveur (npm run test:js)
docs/           reprise sur un autre PC, plan de ce qui reste, pistes de vitesse
```

## Suite

Ce qui reste à faire dans l'onglet Analyse est dans [`docs/PLAN_RESTANT.md`](docs/PLAN_RESTANT.md). Côté Stratégie : vision joueur en cône qui bute sur les murs, placement et déplacement des joueurs entre étages (non faits).

## Onglet Analyse

**Parcours** : (1) « Détecter les games » repère les games par le chrono (environ 3 minutes pour une vidéo de 83 minutes) ; elle n'est refaite que si la vidéo n'a encore aucune game ou si on clique « Refaire la détection », et les games dont les bornes ne changent pas gardent leur analyse ; (2) on vérifie les bornes dans la liste des games et la vidéo ; (3) dans « Analyse détaillée », on coche les games à analyser et on choisit leur ordre (flèches, ou « Une carte d'abord »), puis « Analyser la sélection dans cet ordre » ou « Analyser toute la vidéo ». Les noms des deux équipes (orange à gauche, bleue à droite) se saisissent d'un coup pour un **morceau de la vidéo** (deux champs sur la ligne de « Ce que voit le programme », menu « Appliquer à… » : du temps au temps ; utile pour les rediffs de bootcamp de 4 à 5 heures où les équipes tournent) : les games dont le milieu tombe dans le morceau les reçoivent, et le morceau est retenu pour les games détectées ou posées plus tard ; « Proposer d'après les pseudos » découpe la vidéo là où les équipes changent, d'après les diminutifs déjà lus sur les bandeaux (préfixe commun de trois pseudos sur quatre, le x de liaison retiré : NCTXVEX donne NCT). On peut aussi les corriger par game dans la liste des games, pour les statistiques par équipe : le préfixe commun des pseudos (ex. SNV) est seulement proposé, car toutes les équipes n'en ont pas et ce n'est qu'un diminutif ; le nom complet saisi est retenu pour les games suivantes. Lancer l'analyse confirme les bornes des games cochées. Chaque game est analysée en entier avant la suivante, et ce qui est déjà lu et à jour est sauté (rien n'est recalculé sauf si les réglages ou l'algorithme ont changé).

On charge un .mp4 (bouton « Parcourir… » ou chemin collé) ou une URL YouTube, puis on pose soi-même les marqueurs de début et de fin de chaque game.

**Démarrage** : après un clone ou un `git pull`, `npm start` installe ce qui manque (paquets npm, bibliothèques Python, ffmpeg par winget sous Windows) puis lance le site sur http://localhost:5173. `npm run setup` fait l'installation sans lancer le site. Seuls Node 22+ et Python 3.10+ sont à installer soi-même.

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

**Utilisation** : `npm run dev`, onglet « Analyse », charger la vidéo, « Analyser » : détecte les games (sans rien relire si elles sont déjà vérifiées) puis lit, game par game, les pseudos, l'équipement, les kills, le score et les positions des joueurs. « Détecter les games » ne fait que la partie games. Le champ « Positions : toutes les N frames » règle la cadence de lecture de la minimap (6 par défaut, soit 5 lectures par seconde à 30 i/s) : plus N est petit, plus c'est précis et fluide, au prix d'une analyse plus longue ; changer N relit les positions des games déjà lues. Les positions (minimap : équipe, numéro, position normalisée, direction, vivant) sont lues chaque seconde et stockées dans la table `samples` ; elles ne sont relues que pour les games qui n'en ont pas (déplacer une borne les efface). Les chiffres de la minimap se lisent par modèles (`analysis/minimap_digits.npz`) et, pour l'équipe bleue, par comptage de trous (6, 8, 9).
Les données sont dans `data/eva.db` (SQLite, ignoré par git) ; les vidéos YouTube téléchargées sont dans `data/cache/`.
Les vidéos locales ne sont jamais copiées.

**Réglages** : variable d'environnement `EVA_PYTHON` pour utiliser un autre exécutable Python que `python`.

**Tests** : `npm test` (Node et Python).

## Onglet Lecture et cartes

Trois sous-onglets : **Couloirs lus** (la carte telle que le programme la lit, avec une légende et un menu « Calques »), **Joueurs sur la minimap** (formes, regards et corrections posées à la main sur une game) et **Cartographie à la main**.

**Cartographie à la main** : on range les couleurs de la minimap en classes (sol, mur, tir par-dessus, vue seulement, porte, porte vitrée), on trace les tyroliennes, les portes et fenêtres, les points de capture, les zones de départ (deux par équipe, quatre zones neutres pour Outlaw) et des zones de classe (dont « Hors map »), et on aligne la minimap sur le plan avec des repères. « Appliquer au programme » écrit le masque de la carte (`analysis/map_masks/`) et les fichiers `analysis/map_*.json`, nettoie les petites taches et refuse un masque qui rejetterait plus de 1 % des positions lues avec certitude. Les positions déjà enregistrées ne changent qu'à la prochaine analyse.

**Règles propres aux cartes** : anneaux tournants d'Engine, point de capture unique d'Outlaw (un seul actif à la fois, calendrier des changements affiché dans l'onglet Lecture), portes à bouton de Reef Point (murs pour la vue, passages pour les trajets). Le détail et les mesures sont dans `CLAUDE.md`.

**Suivi** : en plus du lissage décrit plus haut, le suivi applique des règles mesurées : les regards des tyroliennes, des duels et des kills, le mur entre deux joueurs, et le départ (aucun joueur hors de sa zone de départ avant le début de la game). L'algorithme est versionné (`ALGO_REVISION` dans `analysis/tracking.py`) : changer de version relit les positions au prochain « Analyser ».
