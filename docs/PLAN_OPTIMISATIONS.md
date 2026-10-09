# Pistes de vitesse (pour un PC plus puissant)

Le but : analyser une vidéo longue beaucoup plus vite, sans perdre en précision. Les chiffres ci-dessous ont été mesurés sur le PC de
développement (8 cœurs logiques, 8 Go de mémoire dont moins de 1 Go libre en travaillant, Windows 11), avec **un seul processus de lecture**.
Ils servent de référence : `python analysis/benchmark.py --video Ceres.mp4` les refait sur une autre machine.

## Ce qui prend du temps aujourd'hui

| Étape | Mesure sur ce PC | Remarque |
|---|---|---|
| Lecture de la minimap (détection) | environ 80 à 130 ms par image, 1,6 à 4,5 min pour une game de 4 min | une image sur 6 (5 par seconde). Domine le temps total. |
| Suivi des joueurs (`tracking.solve`) | moins de 10 s par game (avant correction : plusieurs heures sur Polaris) | négligeable maintenant |
| Lecture des bandeaux (états) | un second passage ffmpeg par bandeau, quelques dizaines de secondes par game | |
| Extraction d'une image isolée (`names._grab`) | environ 0,6 à 1 s par appel (un ffmpeg lancé à chaque fois) | utilisée pour les pseudos, l'équipement, l'arme de chaque kill, les images candidates des icônes (36 images, 20 à 25 s) |
| Killfeed | une lecture toutes les 0,5 s, reconnaissance de texte Windows | plusieurs minutes par game |
| Analyse complète de NCT vs OR (12 games, 58 min de vidéo) | de l'ordre d'une heure à une heure et demie | un processus de lecture, un seul calcul lourd à la fois |

## Pistes, par rapport gain / effort

### Gros gain, effort faible à moyen

1. **Plusieurs processus de lecture.** C'est fait (`positions._workers()`, 3 au plus, `EVA_WORKERS=6` pour monter) et testé, mais bridé volontairement par la
   mémoire du PC de développement : il n'en lance qu'un quand il reste moins de 3,7 Go libres. Sur un PC avec 16 Go ou plus, régler
   `MAX_WORKERS`, `WORKER_RAM_MB` et `KEEP_FREE_RAM_MB` en tête de `positions.py` selon les mesures du benchmark. Gain attendu : proche du nombre de processus
   tant que le décodage ffmpeg n'est pas le goulot.
2. **Traiter plusieurs games en parallèle** (une game par processus) au lieu d'une après l'autre : les games sont indépendantes. À faire dans
   `analyze.extract_positions`, avec la même garde mémoire. Attention : les écritures dans SQLite doivent rester séquentielles (le mode WAL le permet, une écriture à la fois).
3. **Un seul passage ffmpeg par game pour tous les recadrages** (minimap, deux bandeaux, killfeed) : aujourd'hui chaque lecteur décode la vidéo
   de son côté. Un `-filter_complex` avec plusieurs sorties, ou un décodage unique puis découpe en mémoire, divise le décodage par 3 ou 4.
4. **Décodage matériel** (`-hwaccel d3d11va` ou `cuda`) pour ffmpeg si la carte graphique le permet : le décodage 1080p H.264 devient presque gratuit.
5. **Remplacer les images isolées lancées une à une** (`names._grab`) par un seul ffmpeg qui sort toutes les images demandées d'une game (liste de temps
   avec `select`), ou par la lecture d'un flux basse cadence mis en cache. L'équipement (16 extractions par game), l'arme des kills (2 par kill) et les
   candidates d'icônes (36) passeraient de plusieurs dizaines de secondes à quelques secondes.

### Gain moyen, effort moyen

6. **Cache des recadrages** (`data/cache`, format compressé) : on réécrit les détecteurs sans refaire le décodage. Un essai de réglage passerait de plusieurs minutes à quelques dizaines de secondes. `evaluate.py` met déjà en cache les détections, pas les images.
7. **Détecteur plus économe** : `minimap.find_markers` enchaîne plusieurs masques de couleur, des composantes connexes et un k-means sur chaque image.
   Réduire la résolution du premier passage (chercher sur une image réduite, affiner seulement autour des candidats), éviter de recalculer la conversion HSV,
   n'appeler le k-means que si l'amas dépasse vraiment la taille de deux pastilles. À profiler d'abord (`cProfile`) : je n'ai pas encore chiffré la part de chaque masque.
8. **Cadence adaptative** : lire plus finement quand rien n'est sûr (joueur perdu, pastilles proches) et moins souvent quand tout est stable, au lieu d'une image sur 6 partout. Plus rapide sur les passages calmes, plus précis sur les passages difficiles.
9. **Reconnaissance de texte persistante** : le killfeed et les pseudos passent par un script PowerShell lancé par lot. Un processus qui reste ouvert, ou un moteur
   embarqué, éviterait le démarrage à chaque lot ; une mémoire des images déjà lues (empreinte) évite de relire un même pseudo 20 fois.
10. **Analyse incrémentale** : ne relire que les fenêtres douteuses ou modifiées (zone recalibrée sur un intervalle, ancrage manuel) plutôt que toute la game.

### Gros gain possible, effort élevé

11. **Compiler les parties lourdes** (Numba ou Cython) pour la détection et l'appariement, ou les réécrire sur la carte graphique avec OpenCV CUDA si disponible.
12. **Un petit réseau de neurones** pour pastille, chiffre et fond (ONNX Runtime, CPU ou GPU) : une inférence par lot sur toutes les images d'une game est
    plus rapide que beaucoup d'étapes OpenCV successives, et c'est aussi la piste la plus prometteuse pour la précision sur Polaris et Artefact.

## Réglages à connaître

| Réglage | Où | Effet |
|---|---|---|
| `EVA_WORKERS` | variable d'environnement | nombre voulu de processus de lecture (borné par les garde-fous) |
| `MAX_WORKERS`, `WORKER_RAM_MB`, `KEEP_FREE_RAM_MB` | `analysis/positions.py` | limites par défaut du parallélisme |
| `EVA_PYTHON` | variable d'environnement | exécutable Python lancé par le site |
| `--pos-every N` | `analyze.py` | une lecture de la minimap toutes les N images (6 par défaut) ; 3 double la précision temporelle et le temps |
| `ALGO_REVISION` | `analysis/tracking.py` | à incrémenter quand l'algorithme change |

## Comment comparer deux machines

1. `python analysis/benchmark.py --video Ceres.mp4 --seconds 30` sur chaque PC, en notant les cœurs et la mémoire affichés.
2. Lancer une analyse complète d'une même vidéo (`python analysis/analyze.py --source "chemin.mp4" --skip-if-ok --positions`) et chronométrer.
3. Vérifier que les résultats n'ont pas changé : `python analysis/recap.py --video <id>` et `python analysis/evaluate.py --video <id>` doivent donner les mêmes
   chiffres (la lecture est reproductible : la graine du k-means est fixée).
