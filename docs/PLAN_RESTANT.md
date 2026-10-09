# Ce qui reste à faire (onglet Analyse)

Écrit le 9 octobre 2026, à la fin d'une longue session. Le code est sur la branche `feat/onglet-analyse`. Ce document dit où on en est, ce qui est
fiable, ce qui ne l'est pas, et dans quel ordre continuer. Pour changer de PC : `docs/CHANGER_DE_PC.md`. Pour la vitesse : `docs/PLAN_OPTIMISATIONS.md`.

## Où on en est

**Objectif demandé** : positions des joueurs fiables à 98 ou 99 % sur toutes les cartes. **Il n'est pas atteint, et il n'est pas encore mesuré
de bout en bout.** Ce qui existe pour le mesurer :

- `python analysis/evaluate.py --game 24` ou `--video 2` : compare le suivi aux **bandeaux du haut de l'écran** (vivant, mort, joueur observé),
  un témoin indépendant de la minimap. Indicateurs : accord, fantômes (vivant sur la minimap alors que le bandeau est grisé), manquants
  (bandeau vivant mais aucune pastille). Les lectures sont mises en cache dans `data/cache/` ; `--refresh` les refait.
- `python analysis/recap.py --video 2` : bilan game par game (positions comblées, sauts de position, joueurs perdus, kills sans tueur, icônes sans nom).
- Mesure faite en fin de session, Ceres seule : accord 83,9 % sans les bandeaux, 96,3 % avec, fantômes de 13,9 % à 0 %. Les 12 games de NCT vs OR
  n'ont pas encore de mesure avec l'algorithme final (la mesure avait été lancée avec un code qui a changé en cours de route : la refaire avec `--refresh`).

**Fait dans cette session** (tout est poussé, 92 tests Python et 70 tests JS passent, une seule erreur de lint existait déjà : `MapCanvas.tsx`) :

- Suivi : les morts du killfeed corrigent les joueurs lus vivants à tort, la flèche est gardée sur les trous comblés, l'appariement ne peut plus
  exploser (budget de recherche, sinon glouton : une game bloquait pendant des heures), les taches fixes du décor sont retirées.
- Détection : pastilles atténuées (fond sombre derrière la minimap), joueur observé à halo pâle, cercles des joueurs morts qui attendent leur
  réapparition écartés, pastilles blanches sans numéro écartées quand une image en contient trop.
- Bandeaux (`analysis/banners.py`) : le fond se remplit depuis le bas selon les points de vie (grisé = mort), cadre blanc = joueur observé. Le
  suivi s'en sert (pastille blanche = joueur observé, un joueur grisé n'a pas de pastille vivante, élimination seulement parmi les vivants).
- Zone de minimap : les positions sont relues quand la calibration change (Polaris et Silva avaient été lues avec une zone qui coupait le haut de la carte).
- Armes : l'arme d'un kill se lit sur le bandeau du tueur au moment du kill, seules les grenades DX3 et STICKY comptent comme gadget de kill, un
  joueur n'a jamais deux fois la même arme, seuil de reconnaissance relevé pour les armes de bandeaux (NEEDLE et SPECTRE étaient confondues),
  tueur illisible déduit par élimination quand c'est cohérent, bouton « Signaler » avec recalcul de l'icône (automatique, ou à partir d'une image
  choisie, ou par lots en file d'attente), avis « Bon / Pas bon » sur les noms devinés.
- Interface : calques « Ce que voit le programme » (zones, pastilles, bandeaux et équipement, kills récents), champ « aller à » dans la vidéo, lien « Vu dans » des armes.
- Stratégie : MEDPACK (soin sur soi) et CLONE (posé puis orienté, 10 s à 5 km/h), stats de 7 armes à jour, MP52 ajoutée.

## À faire, dans l'ordre

### 1. Valider l'état actuel (à faire en premier, 1 à 2 heures de calcul)

1. Relancer « Analyser » sur NCT vs OR **avec le code actuel** (la révision de l'algorithme est 4 : tout est relu), puis
   `python analysis/evaluate.py --video 2 --refresh` et `python analysis/recap.py --video 2`.
2. Noter les chiffres par carte (accord, fantômes, manquants) dans ce fichier, c'est la référence pour la suite.
3. Regarder à l'œil les cartes qui ressortent mal avec « Ce que voit le programme » (probablement Polaris, Artefact, Outlaw).

### 2. Précision des positions (le gros chantier)

Erreurs connues, classées par ce que j'ai vu sur 47 images de 9 cartes :

- **Pastilles empilées au départ** (zone d'apparition) : numéros échangés (un 3 lu 1, un 6 lu 7). À faire : séparer les amas à partir de
  chaque chiffre lu au lieu du k-means, et ne pas fusionner des pastilles de numéros différents.
- **Axe inversé du joueur observé** (le 8 de Ceres vers 179 s) : le sens de la pastille blanche reste ambigu ; la direction vers laquelle le joueur
  avance devrait trancher davantage.
- **Pastilles atténuées sans numéro** : elles sont trouvées mais sans identité (le numéro est mal lu à cette luminosité) ; l'identité vient du
  suivi, ce qui échoue quand deux joueurs d'une équipe sont atténués ensemble. Piste : n'attribuer que par élimination parmi les vivants (les bandeaux le permettent déjà).
- **Artefact** : trois joueurs perdus la plupart du temps (le 4 n'a une ligne que sur 15 % des images). Vérifier la zone de minimap calibrée de cette carte avant tout.
- **Outlaw** : six joueurs avec des lignes sur 49 à 58 % des images seulement.
- **Polaris** : fond bleu clair de la couleur de l'équipe bleue. Les rustines faites aident (zone recalibrée, cercles d'attente, bruit blanc), pas démontré suffisant.
- **Masque de déplacement** (idée de l'utilisateur) : gris foncé = on marche, gris clair = mur qu'on traverse en tirant, hachures = portes. Les cartes
  de l'onglet Stratégie ont la même convention. Étapes : retrouver automatiquement l'alignement carte-minimap (contour blanc) et l'afficher en
  calque pour validation, puis refuser les pastilles hors zone, puis contraindre le suivi. Servirait aussi à la ligne de tir pour déduire un tueur.
- **Ancrage manuel** : cliquer « ici c'est le 4 » sur 2 ou 3 images d'une game difficile ; le suivi s'y accroche.
- **Classifieur appris** (pastille, chiffre, fond) à partir des lectures validées : le plus lourd, probablement le plus précis sur les cartes difficiles.
- **Relecture fine des fenêtres douteuses** : au lieu d'une image sur six, relire image par image les quelques secondes où un joueur est perdu.
- **Vérité terrain** : garder dans le dépôt un jeu d'images corrigées à la main (positions et numéros) pour mesurer vraiment. Le premier jet
  (47 images) n'a pas été conservé.

### 3. Kills, équipement, gadgets

- **Nommer les icônes** dans l'onglet Armes (B8, B10, B12, B13, B15, B18, G16 sans nom au dernier bilan ; G16 est le CLONE) et recalculer celles
  signalées (B13, B18, B15, B8, G16) avec « Recalculer la sélection ».
- **Tueurs inconnus** : beaucoup restent (Polaris 40 %, Reef Point 27 %). Relire le killfeed pour récupérer la piste d'arme (elle n'existe que
  pour les kills lus après son ajout), puis régler la règle de déduction (distance, ligne de tir avec le masque de déplacement).
- **Équipement variable dans le temps** : les armes changent à chaque réapparition (vu sur Ceres). L'arme d'un kill est déjà lue au bon moment,
  mais l'équipement affiché par joueur est encore unique par game. À faire : une série d'équipements datés.
- **Disponibilité des gadgets** (sonar demandé) : le gadget du bandeau a trois aspects (prêt, en recharge, joueur mort), la recharge du sonar
  est lisible (environ 40 s mesurées). À faire : lire l'état toutes les secondes, garder les périodes, l'afficher dans le replay et marquer les utilisations.
- **Points de vie** : le remplissage du bandeau donne la vie ; `banners.read_team` renvoie `fill`, la colonne `hp` de `samples` n'est pas remplie.
- **Décompte de réapparition** : affiché sur le portrait d'un joueur mort, pas lu.

### 4. Produit

- Capture : lire sous le nom de carte le nombre de points, leur propriétaire (les points changent de couleur sur certaines cartes, et
  l'utilisateur dit que cela fait perdre le suivi : exemple précis demandé, jamais fourni), le hardpoint d'Outlaw.
- « Ce que voit le programme » : ajouter l'état des bandeaux, une vue filtrée (l'inversion de couleurs a été testée : aucun gain de détection, utile seulement à l'affichage).
- Commentaires : édition (aujourd'hui création, état résolu, suppression).
- Image réelle de Reef Point à remplacer par la vraie (celle de l'onglet Stratégie est une image de substitution de 6 Ko).
- Boutons de contrôle d'analyse : l'analyse lancée en ligne de commande n'apparaît pas sur le site ; seule celle lancée depuis la page s'y reconnecte.

## Points d'attention

- **Mémoire** : le PC de développement a 8 Go dont moins de 1 Go libre en travaillant. Les garde-fous de `positions._workers()` limitent à 3 processus de
  lecture (variable `EVA_WORKERS`), jamais plus de la moitié des cœurs, moins si la mémoire libre est juste, en priorité basse.
- **Ne pas lancer deux analyses en même temps** sur la même base : elles écrivent au même endroit et recalculent les mêmes games.
- **`ALGO_REVISION`** (dans `analysis/tracking.py`) : à incrémenter quand l'algorithme change, sinon les positions déjà lues ne sont pas relues.
  Elle vaut 4. La zone de minimap est aussi suivie (colonne `zone_key` de `samples_meta`).
- **OpenCV et les longues vidéos** : `cv2.VideoCapture.set(POS_MSEC)` est imprécis sur la vidéo de 58 minutes. Pour vérifier un instant, utiliser
  ffmpeg (`names._grab`), comme l'analyse. Mes premières vérifications visuelles sur cette vidéo étaient fausses pour cette raison.
- **Ne jamais tuer un processus par nom** (`taskkill /IM brave.exe` ferme le navigateur de l'utilisateur) : cibler le port ou le profil de test.
- **Tests sensibles à la charge** : `tests/server/jobs.test.ts` lance de vrais processus ; un PC occupé par une analyse peut les faire échouer par moments (un cas corrigé 
  en attendant l'événement plutôt qu'une durée fixe). Relancer avant de conclure à une régression.
- La base `data/eva.db` et les vidéos ne sont pas dans Git (voir `docs/CHANGER_DE_PC.md`).
