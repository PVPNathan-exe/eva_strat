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

- **Vérifier le suivi sur la vraie minimap** : `python analysis/superpose.py --game N` (positions non confirmées par les pixels : 4 % avant, 1 à 1,3 % après les corrections de la deuxième relecture ; positions lues avec certitude non confirmées : 0,2 à 0,5 %). Lire les images à la cadence de l'analyse : l'échantillonnage lent de ffmpeg tombe une demi-période plus tard (un contrôle à 1 image par seconde donnait 31 % de faux refus). Ne confirme pas un joueur caché sous un autre ni un joueur dans une zone de départ ; reste aveugle au « 4 sur la boîte de capture » quand la boîte a la couleur de l'équipe.
- **Pseudo du joueur observé** (`observed_name.py`) : d'accord avec le cadre blanc des bandeaux sur 99,8 % des images (2 780 contre 5), il donne un joueur observé sur 99,2 % des images au lieu de 94,5 % ; il ne change pas les positions calculées (les images ajoutées n'ont de toute façon pas de disque blanc).
- **Disque blanc d'une autre équipe ou d'un autre numéro** : quand l'observé est connu, tout disque blanc qui n'est pas lui est un joueur mort qui attend ou une icône de station, jamais un joueur en jeu (le 9 était attribué au disque d'attente du 7 mort).
- **Joueurs superposés** (`tracking.share_stacks`) : deux joueurs de la même équipe sur une même pastille ne donnent qu'une détection dont le numéro lu alterne ; le joueur sans lecture prend la position de la pile (conditions strictes : alternance nette, joueur lu tout près de la pile avant ou après, pastille stable, une seule trajectoire à la fois ; sinon de faux sauts apparaissent).
- **Regard** : `tracking._choose_directions` choisit le sens d'un regard ambigu avec la forme du disque, le déplacement, la carte des passages (un regard donnant contre un mur à bout portant coûte) et la préférence vers le camp ennemi (cap tiré des zones de départ, `ENEMY_WEIGHT`). Mesure : 81 % des regards lus tournés vers le camp ennemi sans la préférence, 86 % avec. Effacer les traits de murs avant la détection du disque a été essayé et mesuré : aucun gain de couverture (64 % contre 66 %), seul le calcul de la direction ignore maintenant les pixels de mur (effet faible : 31,3 à 30,7 % de regards contre un mur).
- **Joueur observé (couverture)** : sur Polaris NCT vs SNV son disque blanc n'est trouvé que dans 66 % des images où le bandeau le désigne (96 et 93 % sur les deux autres games) : la boîte de capture teintée par l'équipe qui la tient, un liseré mince et terne, et un chiffre trop fin le masquent. Mesure : `images avec un observé vivant / disque blanc de son équipe présent` (évaluer les lectures en cache). Les disques blancs de stations (icône lue comme un chiffre) sont écartés quand ils ne sont pas le joueur observé ; une vie à 1 ou 2 points de vie garde un filet de bandeau (remplissage 0,02, `MIN_FILL` 0,015) et n'est pas une mort.
- **Cadre blanc du joueur observé** (`banners._white_frame`) : sur certaines vidéos (NCT vs SNV) il est teinté (saturation 90 à 120) et la zone du bandeau déborde en bas ; le test cherche un trait blanc en haut et un trait fin (2 à 6 lignes) dans les 30 dernières lignes. Contrôle à refaire sur une nouvelle vidéo : nombre de personnes observées par image (attendu : 1 sur l'ensemble des deux équipes dans presque toutes les images). Sans joueur observé connu, ses disques blancs ne sont jamais ancrés.
- **Disque blanc seul pris pour le joueur observé** : sans numéro lu, il doit être cohérent avec les images voisines où son numéro est lu (`tracking._anchor_ok`) ; une trajectoire de moins de 4 lectures n'est jamais attribuée sans numéro ; une trajectoire qui porte 2 numéros d'un autre joueur n'est pas attribuée par élimination.
- **Contamination de couleur** (`analysis/frame_noise.py`, `tracking.NOISE_MAX`, mesurée en équivalents de pastille) : les stries lumineuses du début de game sont jaunes et orange et passent pour un joueur orange. Le cache `data/cache/eval_<game>.json` contient le bruit : un ancien cache sans lui est relu automatiquement (1 à 2 minutes par game). Une tyrolienne n'est supposée dans un trou que si l'arrivée est une lecture sûre (`RIDE_MIN_CONF`), un trou à plus de 10 m/s n'est pas dessiné, un joueur vivant sans aucune lecture est placé au point de réapparition de son équipe (confiance 0,2).
- **Masque des zones praticables** (`analysis/map_mask.py --map Polaris`, fichier `analysis/map_masks/<Carte>.png` et planche de contrôle `_controle.jpg` : hors masque en rouge, la regarder avant de s'en servir) : il refuse les détections hors des couloirs et donne la distance réelle (couloirs et tyroliennes) ; seulement pour les cartes dont le plan reste identique d'une image à l'autre (Polaris). Atlantis et The Cliff ont des étages superposés et un fond qui change : pas de masque, ne pas en construire un sans l'avoir regardé image par image. Un masque se mesure : part des lectures sûres qu'il rejetterait (0,02 à 0,07 % avec l'élargissement d'une case sur Polaris).
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
