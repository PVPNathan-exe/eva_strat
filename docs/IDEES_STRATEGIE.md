# Idées pour l'onglet Stratégie (à garder de côté)

Rien de ce qui suit n'est construit. Demande de l'utilisateur : « garde ça dans un coin, on y reviendra après que le système d'analyse soit complet ». Seul l'import d'un plan EBP.GG existe (voir plus bas).

## Vision

Dans l'onglet Stratégie, créer un plan avec :

- une **barre de temps jouable** (lecture, pause, curseur) ;
- un **point and click par joueur**, avec recherche de chemin couplée aux **vitesses moyennes** des joueurs (sprint, course tranquille, marche), tirées des données d'analyse (`samples`) ;
- l'**orientation du regard** de chaque joueur sur la carte ;
- le **déploiement du matériel secondaire** (grenades et autres) avec : délai avant de pouvoir le réutiliser, rayon d'explosion, durée de vol, temps avant explosion, dégâts, durée d'un mur ;
- à terme, **contrôler une équipe pendant que l'ordinateur joue l'autre**, à partir des données des reviews, avec quelques variantes pour débloquer les situations périlleuses (comme un jeu d'échecs grandeur nature) ;
- un **pas de temps choisi par l'utilisateur** (de combien le temps avance).

Même usage pour les stratégies créées dans EVA Strat que pour celles importées d'EBP.GG : voir si le plan est respecté dans une vraie game, et sinon pourquoi.

## Ce qui existe déjà et servira

- Vitesses réelles des joueurs : `analysis/lives.py`, `samples` (pas de 0,1 s, mètres de la minimap).
- Chemins praticables : masques (`analysis/map_masks/`), `tracking` (trajets), tyroliennes (`map_stations.json`).
- Zones de tir et de vision : `lib/visibility.ts`, `lib/safeZones.ts`, `lib/weaponRange.ts` (portées et bandes de dégâts des armes).
- Épisodes de vague, retake et rotation : `analysis/waves.py`, `retakes.py`, `rotations.py` (à valider par l'utilisateur d'abord).

## Ce qui manque

- Valeurs du matériel secondaire (rayon, temps de vol, fuse, dégâts, durée de mur) : non mesurées, à relever.
- Comportement de l'adversaire : il faudra assez de games par équipe (seuil d'au moins 5) avant de prétendre le modéliser.
- Aucune vérité terrain pour les seuils de teamfight, vague et retake : ce sont des conventions.

## Import EBP.GG (premier pas, fait)

`src/lib/ebpImport.ts` lit un export JSON d'EBP.GG (version 5) et convertit les pions de chaque étape vers les repères de l'application ; `src/components/stats/StatsPlans.tsx` (Stats, vue Plans) les affiche sur le plan avec une lecture d'une étape à l'autre.

Conversions retenues (vérifiées sur l'export Atlantis de l'utilisateur) :

- `left` et `top` sont des pourcentages de la zone de la carte, même cadrage que notre image de plan : minimap = inverse de `planInsets.project` ;
- `angle` EBP (0 = haut, sens horaire) devient notre regard (0 = est, sens horaire) par `angle - 90` ;
- équipe jaune (orange) = joueurs 1 à 4, équipe bleue = joueurs 6 à 9 de l'export, devenus 5 à 8 ;
- `stepsDetails[i].time` (2000 ms) est lu comme la durée du passage de l'étape i à l'étape i + 1 (hypothèse : non vérifiée dans EBP.GG).

Ignoré : dessins, texte, spécialités, icônes, éléments de carte, étages (gardés tels quels mais non utilisés), équipements, bloc `immersive` (17 éléments non décodés).

Prochaine étape quand l'analyse sera complète : comparer le plan aux positions d'une game (écart de position et de regard par joueur et par étape, premier moment où un joueur s'écarte du plan, cause probable : mort, retard, autre chemin).

## Constantes de début de game et de capture (relevés de l'utilisateur, 16 octobre 2026)

Importantes pour le jeu d'échecs (le temps exact d'un geste, d'un lancer, d'une prise de point), sans effet sur les statistiques globales : on ne décale donc pas `games.start_s` ni les données déjà calculées.

- **Début des actions :** le jeu autorise les actions quand « En avant » s'affiche (fin du compte à rebours), pas quand le chrono quitte 10:00. Sur Polaris (game 26 de NCT contre SNV) la grenade (SONAR) est lancée 71 images après l'affichage de « En avant » : à 60 images par seconde cela fait 1,18 s (l'utilisateur dit environ 1 s). Ce délai est le **temps de réaction humain** (le ping et le doigt : même en martelant le bouton de lancer, rien n'est instantané) : pour un joueur simulé, prévoir environ 1 s entre « En avant » et la première action.
- **Ce que disent les données de la même game (mesuré) :** le chrono affiche encore 10:00 de 0 à 2,5 s de game (09:59 à 3,0 s), un éclair de SONAR est visible à 2,5 s, les premiers SONAR sont lus à 2,25 s (`gadget_state`). Le temps de game zéro est donc environ 3 s avant le départ du chrono (09:59 à 3,0 s), et les premières actions tombent entre 1 et 2,5 s.
- **Capture sur Engine (revue de SNV, game 30) :** le remplissage de l'hexagone du point de départ devient visible environ 0,35 s APRÈS l'affichage de 9:54 du chrono (mesure de `analysis/capture_speed.py`, lecture à 60 images par seconde) ; l'utilisateur a d'abord compté 10 images avant, puis a retenu cette mesure le 17/10/2026 (il a écrit « 0,35 s de 9:55 » : j'ai gardé 9:54 comme dans la mesure). C'est environ 6 s après le départ du chrono ; les données donnent le passage du point B à l'équipe A à 9,0 s de game.
- **Temps de capture selon le nombre de joueurs (mesuré, `analysis/capture_speed.json`) :** sur les cartes de domination, 1 joueur remplit un point en 9,9 s (médiane, 36 épisodes), 2 joueurs en 4,4 s (31 épisodes), soit environ 2,2 fois plus vite ; sans joueur dessus le remplissage se vide à environ 0,10 par seconde ; Outlaw (hardpoint) : 2,9 s à 1 joueur (11 épisodes). **3 et 4 joueurs : pas de mesure fiable**, rien à extrapoler : à mesurer avec plus de games.

