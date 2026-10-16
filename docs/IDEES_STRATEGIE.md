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
