# Plan Stats : découpage pour agents en parallèle

Document de travail de Claude (chef de chantier). Il décrit **quoi faire, dans quels fichiers, par qui, dans quel ordre**, pour livrer l'onglet Stats, les retakes, les rotations, les zones sûres et l'équipement par vie sans que deux agents écrasent le même fichier.
Rien n'est construit à la date d'écriture (14 octobre 2026). Les décisions de la section 6 ont une valeur par défaut : on peut lancer la vague 1 sans attendre.

## 1. Règles communes (les agents lisent seulement cette section et la leur)

Règles du projet (`CLAUDE.md`) et règles de session, reprises ici pour que les agents n'aient rien d'autre à lire :

1. **Français** partout (code commenté, interface, rapport). **Aucun emoji**, aucun pictogramme Unicode dans l'interface (icônes `lucide-react`, classe `ic`). **Aucun tiret quadratin** (deux-points, virgule ou parenthèses).
2. **Un fichier = une fonctionnalité**, nom clair, fonctions courtes et commentées, même densité de commentaires que le code voisin. Plus de 400 lignes : couper.
3. **Couleurs** uniquement dans `src/styles/tokens.css` (jamais en dur dans un autre CSS), **un fichier CSS par zone** dans `src/styles/`. Interface sobre : menus `.menu`, sous-onglets `.subtabs`, explications dans `<details className="help">`, une seule vue à la fois, rien de plus large que l'écran (1440 et 420 px).
4. **Propriété des fichiers** : un agent ne modifie que les fichiers listés dans sa fiche (section 5). Un fichier hors liste dont il a besoin est **signalé dans son rapport**, jamais modifié. Les **fichiers chauds** (section 3) appartiennent au chef de chantier.
5. **Pas de commit, pas de push** par les agents : le chef de chantier fait un `git add` explicite par morceau, vérifie, commite (ligne `Co-Authored-By` de la session) et pousse sur `feat/onglet-analyse`. Jamais de `git checkout` ni `git stash` ni `git reset`.
6. **Sécurité de la machine** : ne jamais fermer un processus par son nom. Machine de travail mesurée le 14 octobre 2026 : 31,9 Go de RAM (15,9 Go libres), Ryzen 5 5600 (6 cœurs, 12 threads), au lieu des 8 Go de l'ancien PC. **Pas de navigateur ni de serveur Vite lancés par un agent** (les captures CDP sont faites par le chef de chantier, un seul navigateur à la fois). Agents : `python -m pytest`, `npx vitest`/`npm run test:js`, `npx tsc -b` seulement. Un seul calcul vidéo lourd à la fois sur toute la machine (file d'attente tenue par le chef de chantier) ; `EVA_WORKERS` : 5 au plus pour ce calcul (`positions._workers()` plafonne déjà à la moitié des cœurs, soit 6, et réduit selon la RAM libre ; la constante `MAX_WORKERS = 3` du code et la règle de `CLAUDE.md` ne sont pas modifiées sans l'accord de l'utilisateur). Le gain de vitesse n'est pas mesuré : `python analysis/benchmark.py` à lancer une fois avant la première grosse lecture.
7. **Base de données** : jamais `data/eva.db` en écriture. Travailler sur une copie (`copy data\eva.db <scratchpad>\stats_<agent>.db`, variable `EVA_DB`) ; la base est en WAL, copier aussi `-wal` et `-shm` ou faire la copie quand rien n'écrit. Les calculs lourds sur vidéo ne se lancent **pas** sans le feu vert du chef de chantier (demander avant tout calcul de plus de quelques minutes).
8. **Dire ce qui est vérifié et ce qui ne l'est pas.** Aucun chiffre non mesuré, aucun « corrigé » sans contrôle sur les données (3 games de référence : 25 The Cliff, 26 Polaris, 27 Reef Point, recalculées avec les dernières règles ; autres games : anciennes règles).
9. **Écriture des fichiers** : le dépôt est en CRLF. Pour un fichier avec des guillemets ou des barres obliques inverses, écrire par script Python (fonction `edit` de `scratchpad/p_dead.py` en exemple) plutôt que par heredoc.
10. **Économie de jetons** : `Grep` avant `Read`, `Read` avec `offset` et `limit`, ne jamais relire un fichier déjà lu ou qu'on vient d'écrire, ne pas explorer hors de sa fiche. **Rapport final de 15 lignes au plus** : fichiers créés ou modifiés, tests ajoutés et résultat, chiffres mesurés (et sur quelles données), ce qui n'est pas vérifié, besoins de fichiers chauds (une ligne d'`ARCHITECTURE.md` prête à coller, une puce de `CLAUDE.md` prête à coller), décisions ouvertes.
11. Pas de nouvelle erreur de lint (une seule préexistante : `MapCanvas.tsx`). Pas de changement de `ALGO_REVISION` : les tables Stats sont **dérivées**, le suivi ne change pas. Interdit : modifier `tracking.py`.

Contrat commun des modules Python de calcul : `compute(conn, game_id) -> int` (idempotent : efface puis réécrit les lignes de la game, renvoie le nombre de lignes), plus un `main()` en ligne de commande `python analysis/<module>.py --game N [--db chemin]` ; la table `stats_meta` (game_id, module, revision) dit si un module doit être recalculé.

## 2. Contrat de données (écrit une fois par le chef de chantier, vague 0)

Toutes les tables vont dans `analysis/schema.sql` (`CREATE TABLE IF NOT EXISTS`, appliqué au démarrage par `server/db.ts` et par `db.py`, pas de migration). Temps en secondes depuis le début de la game, positions en fractions de la minimap (`ARENA_M = (31,0 ; 16,5)` mètres), `slot` 1 à 8 (numéro de joueur : `slot` si <= 4 sinon `slot + 1`), équipe `A` (slots 1 à 4, orange) ou `B`.

| Table | Colonnes | Écrite par |
|---|---|---|
| `lives` | game_id, slot, idx, t0, t1, x0, y0, x1, y1, ended (`death` ou `end`), killer_slot, weapon, kill_kind ; PK (game_id, slot, idx) | P1 |
| `kill_links` | game_id, t, victim_slot, kind (`trade` ou `revenge`), other_slot, dt, dist_m ; PK (game_id, t, victim_slot, kind) | P1 |
| `point_owner` | game_id, point, t0, t1, owner (`A`, `B`, `none`), source (`box` ou `score`) ; PK (game_id, point, t0) | P2 |
| `life_loadouts` | game_id, slot, life_idx, weapon1, weapon2, gadget, held, source ; PK (game_id, slot, life_idx) | P3 |
| `episodes` | id, game_id, kind (`retake` ou `rotation`), point, point_to, team, t0, t1, outcome, data (JSON), verdict (NULL, `ok`, `ko`, posé par l'utilisateur) | P4 |
| `stats_meta` | game_id, module, revision ; PK (game_id, module) | tous |

Définitions figées (à citer dans les docstrings) :
- **Vie** : de l'apparition (première ligne vivante après une mort ou début de game) à la mort (dernière ligne vivante) ou à la fin de la game (`ended = end`).
- **Trade kill** : duel où les deux joueurs meurent presque en même temps : deux kills croisés (A tue B et B tue A) à moins de 1,0 s l'un de l'autre. Une ligne par victime.
- **Revenge** (ancien « trade ») : un coéquipier de la victime tue le tueur dans les 5,0 s qui suivent, à moins de 12 m du lieu du premier kill. Ligne sur le kill vengeur : `victim_slot` = le tueur vengé, `other_slot` = le joueur vengé. Les deux seuils sont des constantes mesurées sur les 3 games de référence.
- **Retake** : un point (le **même** point) passe d'une équipe à l'autre. Épisode : fenêtre de 20 s avant à 10 s après le changement, coupée aux changements voisins. Départ : au moins 2 attaquants à moins de `R_PUSH` du point. Échec : 2 à 4 attaquants morts en 10 s environ et survivants au-delà de `R_RETREAT`. Réussite : changement de propriétaire du même point, défenseurs morts ou reculés.
- **Rotation** : une équipe quitte un point pour en capturer ou en contester un autre (cartes à plusieurs points : Atlantis, Engine, et Outlaw : le point actif change toutes les 1 min 30). Un changement de propriétaire sur un point différent du précédent est une rotation, jamais un retake.
- Mode : Outlaw = hardpoint (rester sur le point pour capturer), toutes les autres cartes = domination.

Contrat de l'API (toutes les routes en `GET`, JSON ; `games` = identifiants séparés par des virgules) :
`/api/stats/lives?game=`, `/api/stats/links?game=`, `/api/stats/owners?game=`, `/api/stats/presence?map=&games=&team=&slot=&n=64` (renvoie `{n, cells: [[ix, iy, secondes]]}`, agrégé en SQL), `/api/stats/episodes?game=` ou `?map=&kind=`, `PUT /api/stats/episodes/:id` (verdict), `/api/stats/teams?map=&team=` (agrégat avec le nombre de games, `min` = seuil d'affichage). Types TypeScript miroirs dans `src/types/stats.ts`.

## 3. Fichiers chauds : propriété exclusive du chef de chantier

| Fichier | Modification prévue | Quand |
|---|---|---|
| `analysis/schema.sql` | les 6 tables ci-dessus | vague 0 |
| `server/api.ts` | 2 lignes : import de `handleStats` et `const stats = handleStats(...); if (stats) return stats;` | vague 0 |
| `src/App.tsx` | onglet « Stats » (import `StatsTab`) | vague 0 (coquille vide) |
| `src/styles/index.css` | import de `stats.css` | vague 0 |
| `src/styles/tokens.css` | couleurs Stats (propriétaires de points, vie, mort, chaleur) | vague 0, puis à la demande |
| `src/types/stats.ts` | interfaces miroirs du contrat (créé en vague 0) ; ajouts à la demande | vague 0 |
| `analysis/stats_run.py` | liste `STEPS` des modules, appelée par `resolve.py` et `analyze.py` | créé vague 0, rempli à chaque vague |
| `analysis/analyze.py`, `analysis/resolve.py` | appel de `stats_run.run(conn, game_id)` après le suivi | vague 1 (lives) puis inchangé |
| `src/components/analysis/ReplayPanel.tsx` | entrée « Zones sûres » dans le menu Affichage | après F3 |
| `ARCHITECTURE.md`, `CLAUDE.md`, `README.md`, `docs/PLAN_RESTANT.md` | lignes collées depuis les rapports des agents | fin de chaque vague |
| `package.json`, `vite.config.ts`, `server/db.ts`, `analysis/db.py` | **aucune** modification prévue (le schéma est lu tel quel ; les accès vont dans les nouveaux modules) | |

## 4. Vagues (4 agents au plus en même temps, fichiers disjoints)

Le plafond passe de 3 à 4 avec la RAM mesurée (sections 1.6). Chaque agent de test lourd (`tsc -b`, `pytest`) prend environ 1 Go : non mesuré, à surveiller à la première vague (RAM libre notée par le chef de chantier avant et pendant).

| Vague | Agents en parallèle | Dépend de | Livrable vérifiable |
|---|---|---|---|
| 0 | chef de chantier seul | | schéma, tokens, types, coquille d'onglet vide, route stub ; `npx tsc -b` et tests verts |
| 1 | **P1** vies et liens de kill, **S1** API vies et présence, **F1** onglet Stats : Parcours, Morts, Présence, **P2** propriétaire des points (code et tests ; lecture vidéo après feu vert) | 0 (contrat) | Stats v1 visible : trajets par vie, morts avec tueur, arme et durée, carte de chaleur ; propriétaire par point mesuré |
| 2 | **P3** équipement par vie, **P4** retakes et rotations, **S2** API épisodes, **F3** zones sûres (bibliothèque et couche) | P1 pour P3 ; P1 et P2 pour P4 ; 0 pour S2 et F3 | cases d'équipement remplies mesurées, épisodes listés (15 à 20 à valider par l'utilisateur), zones sûres dans le replay |
| 3 | **F2** vues Retakes et Rotations, puis vague 4 (agrégat par équipe : **P5/S3/F4**, matrice stratégie contre équipe, routes et positions moyennes) | F1 (`StatsMapBase`), P4, S2 | vues et liens vers la vidéo ; agrégat à préciser après les épisodes réels (voir 7) |

Un seul calcul vidéo lourd à la fois : P2 (vague 1) puis P3 (vague 2) se partagent la file d'attente. Les calculs sans vidéo (P1, P4) ne comptent pas comme lourds.

Entre deux vagues, le chef de chantier : (a) passe `py -3 -m pytest -q`, `npm run test:js`, `npx tsc -b`, lint ; (b) fait tourner les calculs lourds un par un sur les games de référence ; (c) vérifie dans le navigateur headless (CDP, port 9333, profil et serveur de test 5199 sur copie de la base, 1440 et 420 px) ; (d) colle les lignes d'`ARCHITECTURE.md` et de `CLAUDE.md` ; (e) `git add` explicite, commit, push. Un morceau terminé = un commit.

## 5. Fiches des agents

Chaque fiche : fichiers possédés (créer ou modifier), tâche, mesure attendue, tests. Rien d'autre n'est modifiable.

### P1 : vies, morts, trade et revenge (Python, base seulement, pas de vidéo)
- **Possède** : `analysis/lives.py`, `analysis/kill_links.py`, `analysis/tests/test_lives.py`, `analysis/tests/test_kill_links.py`.
- **Tâche** : `lives.compute` construit les vies depuis `samples` (transitions `alive`) et `kills` (tueur, arme, genre du kill) ; `kill_links.compute` écrit trade kills et revenges avec les définitions de la section 2 ; chercher d'abord (`Grep trade`) tout usage actuel du mot « trade » dans le code et le signaler (renommage en « revenge » demandé par l'utilisateur, fichiers hors fiche à lister, pas à modifier).
- **Mesure** : sur les games 25, 26, 27 : chaque mort du killfeed tombe sur la fin d'une vie à 2 s près (part mesurée), nombre de vies par joueur, durée de vie médiane (attendu autour de 17 s de mort entre deux vies à vérifier), nombre de trades et de revenges avec distributions de `dt` et `dist_m` pour justifier les seuils 1,0 s, 5,0 s, 12 m.
- **Tests** : base en mémoire (`:memory:` avec `schema.sql`), cas synthétiques : mort sans kill, kill sans mort lue, deux morts croisées, vengeance hors délai.

### S1 : API vies, liens et présence (TypeScript serveur)
- **Possède** : `server/statsApi.ts` (répartiteur `handleStats(ctx, method, pathname, query): ApiResult | null`), `server/statsLives.ts` (`lives`, `links`), `server/statsPresence.ts` (`presence`, agrégat en SQL par case de la grille `n`, temps = nombre de lignes x pas), `tests/server/stats.test.ts`.
- **Tâche** : suivre le style de `server/api.ts` (`listSamples`, `listCaptureBoxes`) : validation de `game`, `map`, `games`, `n` (bornes), 400 clair. La présence agrège sur plusieurs games d'une même carte, par équipe ou par `slot`, seulement les lignes vivantes. Aucune écriture.
- **Tests** : base en mémoire avec lignes synthétiques : agrégat exact à la main, paramètres invalides.

### F1 : onglet Stats, vues Parcours, Morts, Présence (React)
- **Possède** : `src/components/stats/StatsTab.tsx`, `StatsFilters.tsx` (carte, games, équipe, joueur, nombre de games affiché), `StatsMapBase.tsx` (plan + masque, partagé : seul F1 le modifie), `StatsPaths.tsx`, `StatsDeaths.tsx`, `StatsPresence.tsx`, `useStats.ts`, `src/lib/statsApi.ts`, `src/lib/pathCut.ts` (trajet d'une vie coupé aux tyroliennes, paires de `map_teleports.json`), `src/lib/heatGrid.ts` (grille de chaleur, lissage), `src/styles/stats.css`, `tests/pathCut.test.ts`, `tests/heatGrid.test.ts`.
- **Tâche** : sous-onglets (`.subtabs`) Parcours (une trace par vie, couleur par joueur, menu « Affichage »), Morts (croix numérotées, info-bulle tueur, arme, durée de vie, trade et revenge marqués), Présence (chaleur par équipe ou joueur ; zones nommées : reportées). Données de la vague 1 seulement. Le plan et les cadres viennent de `lib/mapReading.ts` et `lib/planInsets.ts` (réutiliser, ne pas copier). Réponses de l'API consommées via `src/types/stats.ts` (en lecture).
- **Vérifié par le chef de chantier** : captures 1440 et 420 px. L'agent ne lance pas de navigateur : tests de fonctions pures et `tsc`.

### P2 : propriétaire de chaque point (Python, vidéo, lourd)
- **Possède** : `analysis/point_owner.py`, `analysis/tests/test_point_owner.py`.
- **Tâche** : lit la couleur de la boîte du point sur la minimap (gris, orange, bleu) environ une fois par seconde, recoupe avec la pente des scores (`capture_state`), écrit `point_owner`. Cartes à un seul point (`map_capture.json`) et Outlaw (`capture_boxes`, `capture_points.py` en lecture seule). **Atlantis et Engine (3 points)** : mesurer la faisabilité et rapporter, ne pas forcer (les rotations en dépendent).
- **Mesure** : accord avec la pente des scores (comparer d'abord, mesuré sur Polaris game 26 : 10 instants sur 11), part de secondes sans couleur lisible, par carte. Une game à la fois, sur copie de la base, après feu vert du chef de chantier.
- **Tests** : image synthétique pour chaque couleur, segments, cas ambigu.

### P3 : équipement par vie et lecture des armes (Python, vidéo, lourd)
- **Possède** : `analysis/loadout_life.py`, `analysis/loadout.py` (boîte `BOXES`, lecture des armes longues coupées comme B29), `analysis/reread_loadouts.py`, `analysis/tests/test_loadout_life.py`, `analysis/tests/test_loadout.py`.
- **Tâche** : l'équipement change à chaque réapparition. Lire les icônes sur les bandeaux dans les secondes qui suivent chaque début de vie (table `lives` de P1), voter par vie, écrire `life_loadouts`. Réduire les cases vides (63 cases sur 312 vides, 97 kills sur 767 sans arme avant) : arme tenue, élargissement de boîte pour les armes longues. Les noms restent ceux de `analysis/weapon_icons/names.json` (l'utilisateur les nomme dans l'onglet Armes : ne pas en inventer, proposer par `guess` seulement).
- **Mesure** : part de cases remplies avant et après sur les 3 games ; planche de 20 cases tirées au hasard dans le scratchpad pour contrôle visuel par l'utilisateur ; part de cases avec un nom connu.
- **Interdit** : relancer l'analyse de tout le corpus ; une game à la fois, après feu vert.

### F3 : zones sûres (bibliothèque TypeScript et couche de dessin)
- **Possède** : `src/lib/visibility.ts` (polygone de visibilité sur la grille du masque, 360 degrés, murs bloquent), `src/lib/weaponRange.ts` (portée utile d'une arme d'après les bandes `falloff` de `src/lib/stuffs.ts`), `src/lib/safeZones.ts` (union des zones couvertes par équipe à un instant, zones couvertes par une seule équipe = « sûres » pour elle), `src/components/stats/SafeZoneLayer.tsx`, `src/components/stats/StatsSafe.tsx` (vue Zones sûres, instant au curseur), `tests/visibility.test.ts`, `tests/weaponRange.test.ts`, `tests/safeZones.test.ts`.
- **Tâche** : hypothèses de la section 6, en constantes en tête de fichier. Équipement : repli sur la portée médiane des armes lues si la case est vide (afficher l'incertitude). Coût : calcul par image du curseur seulement (pas par image de la game), cache par instant.
- **Mesure** : temps de calcul d'une image (alerte si plus de 50 ms), cas de test à la main (mur plein, tir par-dessus, fenêtre).
- Le branchement dans `ReplayPanel.tsx` est fait par le chef de chantier.

### P4 : épisodes de retake et de rotation (Python, base seulement)
- **Possède** : `analysis/retakes.py`, `analysis/rotations.py`, `analysis/episode_common.py` (fenêtres, distances au point, joueurs vivants), `analysis/tests/test_retakes.py`, `analysis/tests/test_rotations.py`.
- **Tâche** : à partir de `point_owner`, `lives`, `samples`, `map_capture.json`, `map_spawns.json`. Retake : changements de propriétaire du même point ; rotation : propriétaire différent du point précédent, ou changement de point actif (Outlaw) ; écrire `episodes` avec `data` JSON (positions de départ, joueurs, premier mort, morts, causes automatiques, résultat). Étalonner `R_PUSH` (environ 15 m), `R_RETREAT` (environ 25 m) et les fenêtres sur les 3 games.
- **Mesure** : nombre d'épisodes par game et par type, part de réussites ; une feuille de 15 à 20 épisodes (instant, lien vidéo) pour validation par l'utilisateur dans `episodes.verdict`. Rien n'est « corrigé » avant cette validation.

### S2 : API épisodes (TypeScript serveur)
- **Possède** : `server/statsEpisodes.ts` (liste, filtre par carte et type, `PUT` du verdict), `server/statsOwners.ts`, `tests/server/stats-episodes.test.ts`.
- **Tâche** : le chef de chantier ajoute une ligne de répartition dans `statsApi.ts` (fichier de S1, plus modifié ensuite par un agent).

### F2 : vues Retakes et Rotations
- **Possède** : `src/components/stats/StatsRetakes.tsx`, `StatsRotations.tsx`, `EpisodeTimeline.tsx` (bandes de propriétaire, morts numérotées, lien vers la vidéo 5 s avant), `RotationFlow.tsx` (cercles par point, flèches : épaisseur = nombre, étiquette = durée moyenne), `ValidateEpisode.tsx` (boutons ok et ko), `src/lib/episodeFormat.ts`, `tests/episodeFormat.test.ts`.
- **Tâche** : importe `StatsMapBase.tsx`, ne le modifie pas. Cases à cocher : interdites (menu « Affichage »). Le nombre de games est affiché, les résultats sous le minimum sont masqués.

### P5, S3, F4 : agrégat par équipe (vague 4, à spécifier après la vague 3)
Voir section 7.

## 6. Décisions et hypothèses (valeurs par défaut, constantes modifiables)

| Sujet | Valeur par défaut | À confirmer par l'utilisateur |
|---|---|---|
| Fenêtre de retake | 20 s avant, 10 s après, coupée aux changements voisins | oui |
| Commencer par | propriétaire des points (P2), puis épisodes montrés à valider avant les vues | oui |
| Un seul joueur qui quitte un point = rotation ? | non : au moins 2 joueurs de l'équipe | oui (question posée, sans réponse) |
| Portée d'une arme (zones sûres) | derniers mètres où la bande de dégâts reste à 50 % ou plus du maximum | oui |
| Tir par-dessus | laisse passer les balles | déjà indiqué |
| Vitres, fenêtres, porte fermée | vitre et fenêtre : laissent voir, bloquent les balles ; porte fermée : bloque | oui |
| Une vue Stats ou dans Lecture | onglet Stats séparé | oui |
| Une game ou plusieurs | plusieurs games d'une même carte (agrégat), avec le nombre de games affiché | oui |
| Zones nommées | d'abord chaleur seule ; outil « Zones nommées » de la cartographie plus tard | oui |

## 7. Ce qui reste volontairement flou

- **Stratégie par équipe et matrice « laquelle marche contre quelle équipe »** : une seule rediffusion ne suffit pas (déjà dit). La « signature » d'une équipe sur une carte (présence moyenne, routes, rotations, retakes) ne peut être définie qu'une fois les épisodes réels vus. Fiche détaillée à écrire après la vague 3, avec seuil minimal de games et affichage du nombre de games.
- **Regard** : stocké mais exclu de tout calcul Stats (consigne de l'utilisateur).
- **Atlantis et Engine** : propriétaire par point pas encore lu sur une minimap de ces cartes. Les rotations y dépendent du rapport de P2.
- **Autres games** : hors 25, 26, 27 (et la 37 de YouTube), les anciennes règles du suivi s'appliquent tant que l'utilisateur ne demande pas le recalcul.

## 8. Modèle de consigne pour un agent (court, pour économiser les jetons)

> Tu es l'agent <Nom> du chantier Stats d'EVA Strat. Lis seulement `docs/PLAN_STATS_AGENTS.md` : sections 1 (règles communes), 2 (contrat de données) et ta fiche (section 5, « <Nom> »). Possède uniquement les fichiers de ta fiche. Tâche, mesure et tests : ceux de ta fiche. Ne commite pas. Rapport final de 15 lignes au plus, en français, avec ce qui est mesuré et ce qui ne l'est pas.
