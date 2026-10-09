# Reprendre le projet sur un autre PC

Tout le code est dans Git (branche `feat/onglet-analyse`). Trois choses n'y sont **pas** et sont à copier à la main : la base de données, les
vidéos, et ce qui est enregistré dans le navigateur.

## Ce qu'il faut installer

| Outil | Version testée | Pourquoi |
|---|---|---|
| Node.js | 24 (22 ou plus convient : `node:sqlite` et les tests en TypeScript natif) | site, serveur d'analyse, tests |
| Python | 3.14 (3.10 ou plus) | analyse des vidéos |
| ffmpeg et ffprobe, dans le PATH | 9.0 | décodage des vidéos |
| Windows 10 ou 11 | 11 | la reconnaissance de texte (pseudos, killfeed) utilise celle de Windows par PowerShell (`analysis/ocr_win.ps1`) ; sans Windows, ces étapes échouent proprement (`OcrUnavailable`), le reste fonctionne |

```bash
git clone <adresse du dépôt> eva_strat
cd eva_strat
git checkout feat/onglet-analyse
npm install
python -m pip install -r analysis/requirements.txt
```

Si `npm` échoue sur un certificat SSL : `NODE_OPTIONS=--use-system-ca`.

## Ce qu'il faut copier (hors Git)

1. **`data/eva.db`** : toutes les games, les pseudos, les kills, les positions, les commentaires, les calibrations de zones. Sans lui, il faut tout
   relire (une à deux heures pour la vidéo de 58 minutes). Copier aussi `data/cache/` n'est utile que pour `evaluate.py` (il se refait).
2. **Les vidéos** (`*.mp4`, ignorées par Git) : `Ceres.mp4` à la racine, `NCT vs OR.mp4`. Le chemin de chaque vidéo est enregistré **en absolu** dans la base :
   après la copie, mettre les nouveaux chemins :

   ```bash
   python -c "import sqlite3; c=sqlite3.connect('data/eva.db'); print(c.execute('select id,path from videos').fetchall())"
   python -c "import sqlite3; c=sqlite3.connect('data/eva.db'); c.execute('update videos set path=? where id=?', (r'D:/Videos/NCT vs OR.mp4', 2)); c.commit()"
   ```

3. **Les réglages du navigateur** : les cartes de l'onglet Stratégie, l'alignement du plan sur la minimap par carte et les choix de « Ce que voit le
   programme » sont dans le `localStorage` du navigateur. Les cartes se transfèrent par « Exporter JSON » puis « Importer JSON » dans l'onglet Stratégie ;
   le reste se refait en quelques clics.

Ce qui **est** dans Git et n'a pas besoin d'être copié : les icônes d'armes et leurs noms (`analysis/weapon_icons/`, dont `names.json` et
`reviews.json`), les modèles de chiffres de la minimap, les zones par défaut du HUD, les images de noms de cartes.

## Vérifier que tout marche

```bash
npx tsc -b                                   # typage
npm run test:js                              # tests du site et du serveur (70)
python -m pytest -q                          # tests de l'analyse (92)
python analysis/benchmark.py --video Ceres.mp4 --seconds 30   # vitesse des étapes sur cette machine
python analysis/recap.py --video 2           # bilan de qualité d'une vidéo déjà analysée
npm run dev                                  # le site : http://localhost:5173
```

L'erreur de lint `MapCanvas.tsx` (setState dans un effet) existait avant ce travail.

## Pour profiter d'un PC plus puissant

- Le nombre de processus de lecture est limité par des garde-fous écrits pour le PC de développement (8 Go de mémoire). Sur une machine plus grande :
  `EVA_WORKERS=6` (variable d'environnement) et, si besoin, les trois constantes en tête de `analysis/positions.py`. Détails et autres pistes : `docs/PLAN_OPTIMISATIONS.md`.
- Ne jamais lancer deux analyses en même temps sur la même base.
- Une analyse en ligne de commande n'apparaît pas dans la page ; lancée depuis le site (bouton « Analyser »), elle s'y reconnecte même après un rechargement.
  En ligne de commande : `python analysis/analyze.py --source "chemin.mp4" --skip-if-ok --positions`.
- Après un changement de l'algorithme, incrémenter `ALGO_REVISION` (`analysis/tracking.py`), sinon les positions déjà lues ne sont pas relues.

## Où lire la suite

- `docs/PLAN_RESTANT.md` : ce qui reste à faire, dans l'ordre, et l'état de la précision.
- `docs/PLAN_OPTIMISATIONS.md` : les pistes de vitesse.
- `README.md` (section « Onglet Analyse ») : comment fonctionne chaque lecture.
