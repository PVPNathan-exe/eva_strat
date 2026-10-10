# EVA Strat : règles pour Claude Code

Projet : application web (Vite, React, TypeScript, Konva, Zustand) avec un onglet Analyse qui lit des vidéos du jeu EVA (Python, OpenCV, ffmpeg,
SQLite). Contexte et état d'avancement : `docs/PLAN_RESTANT.md`. Autre PC : `docs/CHANGER_DE_PC.md`. Vitesse : `docs/PLAN_OPTIMISATIONS.md`.

## Façon de travailler

- **Lire `ARCHITECTURE.md` avant de chercher ou de créer un fichier** (carte du projet, endpoints, flux), et le mettre à jour quand un fichier est ajouté, renommé ou supprimé.
- **Un fichier = une fonctionnalité**, nom clair, fonctions courtes et commentées. Les couleurs de l'interface sont dans `src/styles/tokens.css` (jamais de couleur en dur dans un autre fichier CSS), un fichier CSS par composant ou zone dans `src/styles/`.
- **Répondre en français**, clairement, sans jargon inutile.
- **Aucun emoji** ni pictogramme Unicode (play, flèche, cible) dans l'interface : utiliser `lucide-react` (classe `ic` dans `src/styles/icons.css`).
- **Aucun tiret quadratin** (le long tiret) dans le code, les commentaires, les textes d'interface et la documentation : deux-points, virgule ou parenthèses.
- **Un commit poussé après chaque morceau terminé**, sur la branche de travail (`feat/onglet-analyse`). Ne fusionner dans `main` que si on le demande. Terminer le message de commit par la ligne `Co-Authored-By` indiquée par la session.
- **Dire ce qui est vérifié et ce qui ne l'est pas.** Ne jamais donner un chiffre non mesuré, ne pas écrire « c'est corrigé » sans l'avoir contrôlé sur les données ou dans le navigateur. Les limites et les échecs se disent clairement.
- **Tester pour de vrai** : navigateur headless piloté par CDP pour l'interface, vérification sur les vraies vidéos pour l'analyse, tests automatiques en plus.
- Fins de ligne : le dépôt est en CRLF sous Windows ; écrire les fichiers par script Python plutôt que par heredoc quand il y a des guillemets ou des barres obliques inverses.

## Sécurité de la machine

- **Ne jamais fermer un processus par son nom** (`taskkill /IM brave.exe`, tuer tous les `node.exe`) : cela ferme aussi le navigateur et le serveur de l'utilisateur. Cibler uniquement ses propres processus de test
  (navigateur lancé avec `--remote-debugging-port=9333` et son propre `--user-data-dir`, serveur lancé avec `--port 5199`), par leur ligne de commande ou leur PID.
- **Mémoire et processeur** : le PC de développement a 8 Go de mémoire, souvent moins de 1 Go libre. Pas plus de 3 processus de lecture (`positions._workers()`, variable `EVA_WORKERS`), un seul calcul lourd à la fois, jamais deux analyses en même temps sur `data/eva.db`.
- Demander avant de relancer un calcul de plus de quelques minutes si l'utilisateur a déjà le résultat.

## Commandes

```bash
npm run dev                        # site (http://localhost:5173)
npx tsc -b                         # typage
npm run test:js                    # tests du site et du serveur
python -m pytest -q                # tests de l'analyse
python analysis/recap.py --video 2 # bilan de qualité d'une vidéo analysée
python analysis/evaluate.py --video 1   # accord du suivi avec les bandeaux, positions manquantes, sauts, part de positions réellement lues
python analysis/evaluate.py --video 1 --gap-test   # erreur du comblement de trous sur des positions sûres cachées (vérité simulée)
python analysis/reread_loadouts.py --video 3   # relit l'équipement d'une vidéo (après un changement de loadout.py) et retire les icônes B et G inutiles
python analysis/resolve.py --video 1   # refait le suivi sans relire la vidéo (lectures en cache), après un changement de tracking.py
python analysis/benchmark.py --video Ceres.mp4   # vitesse des étapes sur cette machine
```

Une seule erreur de lint existait avant le travail sur l'onglet Analyse : `MapCanvas.tsx` (setState dans un effet). Ne pas en ajouter d'autres.

## Pièges techniques de l'analyse

- **Zone de minimap par carte** : `analysis/map_zones.json` (la minimap n'a pas la même taille sur toutes les cartes : une zone trop petite coupait le haut d'Outlaw, Artefact, Silva, Atlantis, Polaris). Une nouvelle carte sans entrée prend la zone par défaut : la vérifier à l'œil (planche avec grille) et l'ajouter.
- **Les disques blancs avec flèche** de certaines cartes (Artefact, Outlaw, Polaris, Atlantis) sont des stations de tyrolienne : un joueur y traverse la carte en une fraction de seconde. Ces sauts sont réels, ne pas les « corriger ».
- **Bandeaux = témoin des vivants** : un joueur vivant n'a jamais de trou (recover_from_unused puis bridge_gaps), un mort n'a aucune position vivante, un état du bandeau de moins de 1,5 s est un clignotement. Une mort du killfeed que le bandeau contredit est ignorée.
- **`ALGO_REVISION`** (`analysis/tracking.py`) : l'incrémenter dès que l'algorithme de lecture ou de suivi change, sinon les positions déjà enregistrées ne sont pas relues. La zone de minimap est aussi suivie (`samples_meta.zone_key`).
- **Vérifier un instant d'une longue vidéo avec ffmpeg** (`names._grab`), jamais avec `cv2.VideoCapture.set(CAP_PROP_POS_MSEC)` : sur la vidéo de 58 minutes il est imprécis et fausse les comparaisons.
- **Les bandeaux** du haut de l'écran sont un témoin fiable : fond rempli depuis le bas = points de vie (grisé = mort), cadre blanc = joueur observé. Un disque blanc numéroté dans la zone de départ est un **joueur mort qui attend**, pas une pastille en jeu.
- **Gadgets** : seules les grenades DX3 et STICKY comptent comme gadget d'un kill ; le sonar et le clone ne tuent pas.
- **Armes d'un kill** : lues sur le bandeau du tueur au moment du kill (l'équipement change à chaque réapparition), pas sur l'icône du killfeed.
- **Chrono** : ne jamais coder 600 s en dur (Outlaw dure 12 minutes, certaines games sont plus courtes). Ne pas déduire la fin d'une game d'un pourcentage de capture (remontées après 98 ou 99 %).
- `data/` (base, cache) et les `*.mp4` ne sont pas dans Git.
