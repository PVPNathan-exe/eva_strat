# Plan Stats 2 : écran de review, récap de game, duels, secondaires, stats par équipe

Document de travail de Claude (chef de chantier), écrit le 16 octobre 2026 après la demande de l'utilisateur. Suite de `docs/PLAN_STATS_AGENTS.md` : **les règles communes (sa section 1) et le contrat des modules Python (`compute(conn, game_id) -> int`, `stats_meta`) s'appliquent telles quelles**. Les agents lisent la section 1 de l'ancien plan, la section 2 de celui-ci (définitions) et leur fiche.

## 1. Demande de l'utilisateur, avec le traitement prévu

| Demande | Traitement | Fiche |
|---|---|---|
| Reconstruction (aujourd'hui à droite de la vidéo) placée sous la vidéo ; à tout moment : utiliser le secondaire d'un joueur s'il est disponible, modifier le regard, la position, laisser un commentaire | mise en page de l'écran de review ; regard, position et commentaire par les corrections à la main existantes (`user_marks`, `comments`) ; l'utilisation du secondaire à la main vient après la lecture automatique (P8) | F8 |
| Les teamfights sont déjà sur la barre de temps zoomée : ne rien ajouter pour eux ; ajouter, sur la barre, le moment d'un changement de point de capture avec 10 s avant | marqueur de changement de point (`/api/stats/active`) et fenêtre de 10 s avant | F9 |
| Masque affichable de la zone de l'arme équipée | couche de zone de tir de l'arme tenue (réutilise `weaponRange.ts`, `visibility.ts`) dans la reconstruction | F8 |
| Nom de la carte sur la barre de séparation des games | `GameList.tsx` et `SegmentTimeline.tsx` | F9 |
| Récap de game dans Stats : kills et morts, secondaires utilisés sur le maximum possible (garder son stuff est bien, mourir avec est mauvais), vitesse max et moyenne, duels remportés, note par kill et par mort, nombre de changements de point | vue **Récap** (une game) | P8, P9, P11, S4, F6 |
| Par équipe : positions préférées par côté de la carte, taux d'occupation couplé aux duels par joueur pour trouver les endroits faibles (un joueur qui attire pendant que son équipe gagne ailleurs : position correcte, ou adversaire qui oublie un côté), couleur par équipe, par joueur ses positions et passages préférés, légende | vue **Équipe** | S4, F7 |
| Onglet global : toutes les stats couplées, quelles positions sont les plus fortes, quelle stratégie marche le mieux pour capturer ou recapturer | vue **Global** (seuil minimal de games, nombre de games affiché) | F10 |
| Import EBP.GG dans l'onglet Stratégie, le reste de cet onglet viendra après | le bouton « Importer JSON » de la Stratégie reconnaît un export EBP.GG et ouvre le plan (fait par le chef de chantier, vague 0) | chef de chantier |

## 2. Définitions retenues (retour de l'utilisateur du 16 octobre 2026)

- **Secondaire (gadget) utilisé** : l'icône du gadget dans le bandeau passe de **noire à grise** quand il est utilisé, comme l'arme tenue (sombre) contre l'arme rangée (pâle). C'est l'indice à mesurer (non vérifié sur vidéo à la date d'écriture). Il revient noir quand il est de nouveau disponible (délai de recharge à mesurer). Maximum possible = nombre d'utilisations qu'un joueur aurait pu faire dans ses vies compte tenu du délai de recharge (à définir par P8 une fois le délai mesuré).
- **Garder son secondaire** : pas mauvais en soi ; mauvais si le joueur **meurt avec le secondaire encore disponible** (compteur `unused_at_death`) ou le garde plus d'un seuil (à mesurer, valeur par défaut : 60 s sans usage).
- **Teamfight** : moment où beaucoup de joueurs meurent à très peu d'intervalle, typiquement une équipe en moins 3 ou 4 et l'autre aussi. Définition actuelle conservée (série de kills à 10 s au plus, au moins 2 engagés par équipe, sinon duel) ; **on ajoute** les pertes de chaque équipe dans la série (`data.wave.fight.losses = {A, B}`) et un indicateur `heavy` quand les deux équipes perdent au moins 3 joueurs. Le gagnant et les issues ne changent pas.
- **Retake** = teamfight gagné + prise du point (inchangé).
- **Engine et Helios Station n'ont aucun changement de point** : pas de rotations, pas de calendrier (entrée `none` de `map_rotation_schedule.json`), les vues Rotations disent « cette carte n'a pas de changement de point ».
- **Duel** : un joueur en pousse un ou deux sans aide proche (définition de `waves.py`, `HELP_R`). Gagné par celui qui tue ; sans kill, par le plus de points de vie restant (lus sur le bandeau) ; seuils d'un « petit duel » (dégâts seuls) à régler avec l'utilisateur.
- **Note d'un kill** (échelle de -2 à +3, convention) : +1 le kill est le premier de la vague ; +1 il fait gagner le teamfight (l'équipe du tueur perd le moins) ; +1 il précède une prise ou la tenue du point dans les 20 s ; -1 le tueur meurt dans les 5 s (trade) sans suite ; -2 l'équipe du tueur perd le teamfight malgré le kill. Les raisons sont stockées en clair (`reasons`). Le point de vue du mort est le même kill vu de l'autre équipe (impact opposé).
- **Vitesse** : mètres par seconde entre deux lectures consécutives distantes de 0,5 s au plus, tyroliennes et sauts exclus ; moyenne sur les lignes vivantes ; maximum = 98e centile (`v_p98`), le maximum brut (`v_max`) reste affiché avec la mention « peut contenir des erreurs de lecture ».
- **Changement de point** = début d'une période de `point_active` après la première (Outlaw, Atlantis).

## 3. Contrat de données (tables créées en vague 0 dans `analysis/schema.sql`, types dans `src/types/stats.ts`)

`gadget_state`, `duels`, `kill_scores`, `player_game_stats` (colonnes dans le schéma). Temps en secondes depuis le début de la game (les `samples`, `kills` et `capture_state` sont en temps de VIDÉO : soustraire `games.start_s`). Routes ajoutées par S4, toutes en `GET` : `/api/stats/gadgets?game=`, `/api/stats/duels?game=`, `/api/stats/kill-scores?game=`, `/api/stats/player-stats?game=`, `/api/stats/game-summary?game=` (agrège tout, y compris les changements de point), `/api/stats/team-summary?map=&team=&games=` et `/api/stats/global?map=`.

## 4. Fichiers chauds (chef de chantier)

`analysis/schema.sql` et `src/types/stats.ts` (faits), `analysis/stats_run.py` (STEPS), `server/statsApi.ts` (routes de S4 : le chef branche), `src/components/stats/StatsTab.tsx`, `src/styles/tokens.css`, `src/styles/index.css`, `ARCHITECTURE.md`, `CLAUDE.md`, `docs/PLAN_RESTANT.md`, `package.json`.

## 5. Vagues (4 agents au plus à la fois)

| Vague | Agents | Dépend de | Livrable vérifiable |
|---|---|---|---|
| 0 | chef de chantier | | tables, types, plan, import EBP dans la Stratégie |
| 1 | **P8** secondaire (code et mesure sur images isolées, lecture complète après feu vert), **P9** duels et notes (base seulement), **F8** reconstruction sous la vidéo, **F9** barre de temps | 0 | indice du gadget mesuré ; duels et notes sur les 3 games de référence ; écran de review remanié ; marqueurs de point |
| 2 | **P10** cartes sans changement de point et teamfights lourds, **P11** bilan par joueur, **S4** routes | P8, P9 pour S4 | tables remplies, routes testées |
| 3 | **F6** vue Récap, **F7** vue Équipe | S4 | vues contrôlées à 1440 et 420 px |
| 4 | **F10** vue Global | F6, F7, épisodes validés | seuil de games respecté, légende |

Un seul calcul vidéo lourd à la fois sur la machine (P8). Le chef de chantier relance les calculs lourds sur copie de la base, avec le feu vert de l'utilisateur.

## 6. Fiches des agents

### P8 : état du gadget (Python, vidéo, lourd après feu vert)
- **Possède** : `analysis/gadget_state.py`, `analysis/tests/test_gadget_state.py` (ne modifie pas `loadout.py` ni `banners.py` : demander dans le rapport).
- **Tâche** : mesurer, sur des images isolées (`names._grab`, quelques dizaines au plus, pas de lecture complète), comment la case gadget du bandeau change quand le gadget est utilisé (noir vers gris selon l'utilisateur), puis écrire `gadget_state` (`ready`, `used`, `unknown`). Calculer par vie : utilisations, utilisations possibles (délai de recharge mesuré), `unused_at_death`.
- **Mesure** : les kills de gadget (grenades DX3 et STICKY, `kill_kind`) doivent tomber dans un passage à `used` à 2 s près ; transitions comparées à l'image à la main sur 10 cas ; part des vies lisibles. Dire ce qui est lu et ce qui ne l'est pas.

### P9 : duels et notes de kill (Python, base seulement)
- **Possède** : `analysis/duels.py`, `analysis/kill_scores.py`, tests correspondants.
- **Tâche** : écrire `duels` (définition de la section 2 ; les points de vie viennent des états de bandeau du cache `data/cache/eval_<game>.json` ou de ce que contient la base : vérifier d'abord ce qui est disponible et le dire) et `kill_scores` (note de la section 2, raisons en clair).
- **Mesure** : sur les games 25, 26, 27 : nombre de duels, part gagnée par le plus de points de vie contre par kill, distribution des notes, 10 kills relus à la main avec leur note.

### F8 : reconstruction sous la vidéo (React)
- **Possède** : `src/components/analysis/ReplayPanel.tsx` (le couper en fichiers de moins de 400 lignes si besoin), `GameBadge.tsx`, nouveaux composants `src/components/analysis/review/*`, `src/styles/analysis*.css` utiles ; `src/components/analysis/AnalysisTab.tsx` (mise en page : la reconstruction passe sous la vidéo ; aucun autre agent n'y touche).
- **Tâche** : rendre `ReplayPanel` utilisable sous la vidéo (largeur, hauteur, 1440 et 420 px) ; ajouter sans quitter l'écran : regard et position d'un joueur (corrections existantes de `useMarks.ts`, `MarkPanel.tsx`), commentaire (`comments.ts`, `CommentsPanel.tsx`), couche de zone de tir de l'arme tenue (`weaponRange.ts`, `visibility.ts`, `safeZones.ts`, couche `SafeZoneLayer.tsx` réutilisée sans modification), menu Affichage. Pas de bouton secondaire tant que P8 n'a pas rendu.
- **Mesure** : tests TypeScript des fonctions pures ; rapport avec les captures à demander au chef de chantier.

### F9 : barre de temps de la game (React)
- **Possède** : `src/components/analysis/SegmentTimeline.tsx`, `TimelineKills.tsx`, `TimelineCapture.tsx`, `GameList.tsx`, `src/lib/killTimeline.ts`, `captureTimeline.ts`, `timeline.ts`, nouveau `src/lib/pointChangeMarks.ts`, tests.
- **Tâche** : marqueurs des changements de point (`/api/stats/active`) avec une fenêtre de 10 s avant, nom de la carte sur la barre de séparation des games ; ne rien ajouter pour les teamfights.
- **Mesure** : tests de la fonction qui calcule les marqueurs sur les données de `tests/waveFixtures.ts` ou équivalent.

### P10 : cartes sans changement de point et teamfights lourds (Python, base seulement)
- **Possède** : `analysis/waves.py`, `kill_series.py`, `rotation_schedule.py`, `map_rotation_schedule.json`, `rotations.py`, tests ; incrémente `REVISION` de ce qu'il change.
- **Tâche** : Engine et Helios en `none` ; pertes par équipe et `heavy` dans `data.wave.fight` ; rien d'autre ne change.

### P11 : bilan par joueur (Python, base seulement)
- **Possède** : `analysis/player_game_stats.py`, test.
- **Tâche** : `player_game_stats` (colonnes dans le schéma) : kills, morts, temps vivant, distance, vitesses (section 2) ; gadget : `gadget_uses`, `gadget_unused_at_death` (lus dans `gadget_state` et `lives`, sans modifier `gadget_state.py`), `gadget_possible` calculé PAR GADGET avec le délai médian de ce gadget (cycles prêt, utilisé, prêt mesurés dans `gadget_state` sur toutes les games de la base ; au moins 3 cycles, sinon NULL : jamais de valeur inventée) ; duels gagnés, perdus, autres (`duels`). **Mesure** : vitesse médiane d'un joueur en marche franche proche de 1,3 à 1,9 m/s (déjà mesuré), maximum brut contre 98e centile ; délais de recharge trouvés par gadget (P8 a vu 7 à 45 s en mélangeant les gadgets).

### S4 : routes (TypeScript serveur)
- **Possède** : `server/statsGame.ts`, `server/statsTeam.ts`, `tests/server/stats-game.test.ts`, `tests/server/stats-team.test.ts` (le chef branche dans `statsApi.ts`).
- **Tâche** : `GET /api/stats/gadgets?game=`, `duels?game=`, `kill-scores?game=`, `player-stats?game=` (lignes des tables) ; `game-summary?game=` : par joueur les colonnes de `player_game_stats` plus la somme et la liste des notes de `kill_scores`, par équipe les totaux, le nombre de changements de point (périodes de `point_active` après la première, 0 pour Engine et Helios), le nom de la carte ; `team-summary?map=&team=&games=&side=` : nombre de games, kills et morts, duels, gadgets, grille de morts et de kills par case (positions de mort de `lives`, `n=32`), grille de présence par joueur et par côté (comme `statsPresence.ts`), cases où l'équipe perd ses duels ; `global?map=` : mêmes grilles sur toutes les équipes et taux de réussite des vagues et des retakes par issue, avec le nombre de games. Toujours renvoyer le nombre de games et `min` (5) pour que l'interface masque sous le seuil.

### F6, F7, F10 : vues Récap, Équipe, Global (React, vagues 3 et 4)
Fiches détaillées écrites après le rendu de S4 (les champs réels des routes décident). Principes : une couleur par équipe via `.pal`, légende toujours visible, rien de plus large que l'écran, masquage sous 5 games, mention « convention » sur toute note et tout seuil.

## 7. Questions ouvertes pour l'utilisateur
1. Seuil d'un duel gagné quand personne ne meurt (le plus de points de vie restant ?).
2. Échelle des notes de kill : celle de la section 2 convient-elle ou faut-il d'autres critères ?
3. Gadget gardé trop longtemps : 60 s par défaut, à ajuster après mesure.
4. Teamfight « lourd » : au moins 3 pertes de chaque côté, à confirmer.
