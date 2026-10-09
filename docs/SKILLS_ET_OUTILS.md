# Skills, agents et outils pour le projet EVA Strat

Liste de ce qui a été utilisé et de ce qui pourrait servir, par thème. Les skills cités existent dans la configuration de Claude Code de l'auteur
(plugins `superpowers`, `claude-mem`, `code-review`, `security-guidance`, `frontend-design`, skills `gstack`, skills intégrés et skills du compte).
Pour les réinstaller sur un autre PC : voir le document de configuration personnel (hors dépôt).

## 1. Ce qui a réellement été utilisé sur ce projet

Relevé fait dans les historiques de session du projet (9 fichiers), pas de mémoire :

| Outil | Appels | Pour quoi |
|---|---|---|
| Skill `superpowers:brainstorming` | 1 | cadrer l'onglet Analyse au début (le résultat est dans `docs/superpowers/specs/`) |
| Skill `superpowers:writing-plans` | 1 | écrire le plan en chantiers (`docs/superpowers/plans/2026-10-07-onglet-analyse.md`) |
| Skill `superpowers:subagent-driven-development` | 1 | exécuter une partie du plan avec des sous-agents |
| Skill `gstack` | 1 | navigateur headless (essai) |
| Agent `general-purpose` | 5 | tâches déléguées pendant la construction |
| Agent `superpowers:code-reviewer` | 1 | relecture d'un morceau |

Tout le reste a été fait **directement avec les outils de base** : `Bash` (plus de 780 appels : analyses, tests, git), `Read`, `Write`, `Edit`, `PowerShell`, `Monitor`
(attendre la fin d'un calcul long). La validation dans le navigateur s'est faite avec un navigateur headless piloté à la main par le protocole CDP (scripts jetables), pas avec un skill.

**Ce qui n'a jamais été fait avec un skill, et qui manque** : aucune relecture globale du code produit (des milliers de lignes ajoutées), aucune revue de sécurité,
aucun passage de design/UX structuré, et le débogage de l'analyse bloquée s'est fait à la main (sans `systematic-debugging`). Les sections 3 à 6 disent quoi lancer.

## 2. Conception et planification

| Skill | Utilité ici | Quand |
|---|---|---|
| `superpowers:brainstorming` | explorer les options avant un gros chantier | masque de déplacement, classifieur appris, équipement par réapparition |
| `superpowers:writing-plans` / `executing-plans` | découper un chantier en étapes vérifiables | tout chantier de plus de 5 fichiers |
| `claude-mem:make-plan` puis `claude-mem:do` | plan par phases puis exécution par sous-agents | chantier long et découpable |
| `gstack:plan-eng-review` | revue d'architecture d'un plan avant de coder | avant le classifieur appris ou le décodage unique multi-recadrages |
| `gstack:plan-design-review`, `plan-devex-review` | revue d'un plan d'interface ou d'usage | avant le calque « vue filtrée » ou l'ancrage manuel |
| `gstack:office-hours` | remettre en question le besoin | quand une idée change l'orientation du produit |
| `superpowers:using-git-worktrees` | travailler sur une autre branche **sans toucher** au dossier où une analyse tourne | utile : plusieurs fois un calcul long a empêché de changer de branche |

## 3. Analyse et qualité du code

| Skill ou agent | Utilité ici | Quand |
|---|---|---|
| `/code-review` (plugin `code-review`) | relecture de tout le diff de `feat/onglet-analyse` ; niveau `high` ou `xhigh` pour ce volume, `--fix` pour appliquer | **à faire maintenant**, avant de considérer la branche stable |
| `superpowers:requesting-code-review` / `receiving-code-review` | relecture par un agent indépendant puis tri des remarques sans les appliquer à l'aveugle | fin de chaque gros chantier |
| `simplify` | repérer le code dupliqué ou trop long (`tracking.py`, `minimap.py`, `analyze.py` ont beaucoup grossi) | après stabilisation des algorithmes |
| `superpowers:systematic-debugging` | cause racine avant correction | un comportement inattendu dont la cause est inconnue (exemple : la game qui bloquait à 11 %, trouvée en profilant) |
| `gstack:investigate` | enquête guidée sur un bug | idem |
| `superpowers:test-driven-development` | écrire le test d'abord | **surtout pour les pièces pures** : `tracking.py` (appariement, états des bandeaux), `banners.py`, `recap.py`, règles de déduction du tueur |
| `superpowers:verification-before-completion` | exiger une preuve (sortie de test, mesure) avant de dire « c'est corrigé » | avant chaque commit annonçant une correction |
| `superpowers:finishing-a-development-branch` | fusion, PR ou nettoyage structuré | quand on décide de passer sur `main` |
| `claude-mem:smart-explore` et outils `smart_search`, `smart_outline`, `smart_unfold` | lire la structure d'un fichier sans le charger en entier | `tracking.py` (plus de 500 lignes), `analyze.py` |
| agent `architecture-mapper` | produire `ARCHITECTURE.md`, `API_ENDPOINTS.md` avec les lignes | utile : le projet n'a pas ces fichiers |
| `claude-mem:mem-search` | retrouver une décision ou un bug d'une session précédente | « comment avait-on réglé X ? » |

## 4. Sécurité (même en local)

Le serveur d'analyse est un plugin du serveur de développement qui écoute sur `localhost`. « En local » ne veut pas dire sans risque : une page web quelconque ouverte dans le navigateur
peut envoyer des requêtes à `localhost`. Surface à examiner, d'après le code :

| Point | Où | Ce qu'on vérifie |
|---|---|---|
| Requêtes venant d'une autre page web | `server/guard.ts` | contrôle de l'hôte et de l'origine, JSON obligatoire en écriture (déjà en place : à tester contre un rebinding DNS) |
| Chemins de fichiers | `GET /api/videos/:id/stream`, `POST /api/pick-file`, `/api/weapons/:id/icon`, images candidates | pas de sortie du dossier voulu, identifiants validés par expression régulière |
| Lancement de processus | `server/jobs.ts`, `server/analysisPlugin.ts` (`execFile`), `analysis/ocr.py` (PowerShell) | arguments passés en tableau (pas de chaîne de commande), pas d'injection par un nom de fichier ou une URL |
| Téléchargement d'URL | `analysis/ingest.py` (yt-dlp) | schémas acceptés, destination du cache |
| Base de données | `server/db.ts`, `analysis/db.py` | requêtes préparées partout (aucune concaténation de texte venant de l'utilisateur) |
| Données désérialisées | caches de `evaluate.py` | JSON seulement (le `pickle` a été écarté) |
| Fichiers écrits | `analysis/weapon_icons/` (noms, avis), `data/` | écriture limitée aux identifiants valides |

Outils : `security-review` (skill intégré, revue de la branche), `gstack:cso` (revue de sécurité), le plugin `security-guidance` (hook automatique, il a déjà signalé le `pickle`),
et `superpowers:requesting-code-review` avec une consigne centrée sécurité. Un audit complet n'a **jamais** été lancé sur ce projet.

## 5. Interface et expérience utilisateur

| Skill | Utilité ici | Quand |
|---|---|---|
| `frontend-design:frontend-design` | direction visuelle cohérente pour les nouveaux écrans | refonte du replay agrandi, calque « vue filtrée » |
| `anthropic-skills:design-taste-frontend` | règles de composition et de qualité d'interface | relecture d'un composant (`ReplayPanel`, `WeaponsTab`) |
| `anthropic-skills:redesign-existing-projects` | améliorer un écran existant sans casser les fonctions | page Analyse déjà chargée (vidéo, replay, commentaires, liste des games) |
| `gstack:design-review`, `design-consultation`, `design-shotgun`, `design-html` | critique visuelle, variantes, maquettes HTML | choisir entre plusieurs dispositions avant de coder |
| `dataviz` | graphiques lisibles (couleurs, axes, légendes) | courbe de capture, futurs graphiques de points de vie ou de recharge du sonar |
| `gstack:qa`, `qa-only`, navigateur headless | parcours réel des écrans, captures d'écran, bugs avec preuve | après chaque changement d'interface (à la place de scripts CDP écrits à la main) |
| `anthropic-skills:built-in-browser`, `chrome-browser` | piloter un vrai navigateur | essais interactifs, avec les précautions du `CLAUDE.md` (ne fermer que ses propres processus) |
| `run` (intégré) | lancer l'application et vérifier un changement en vrai | vérification de fin de chantier |

Points d'UX connus à traiter : état de l'analyse lancée en ligne de commande (invisible dans la page), édition des commentaires, lisibilité du replay sur petit écran, accessibilité (contrastes, navigation au clavier, `aria-label` des boutons à icône).

## 6. Performance, mesures et suivi des calculs longs

- `gstack:benchmark` et `canary` : comparer des mesures entre deux versions ; en complément `python analysis/benchmark.py` et `python analysis/evaluate.py` (déjà dans le dépôt).
- `loop` et `schedule` : surveiller une analyse de plusieurs dizaines de minutes ou la relancer à heure fixe.
- `Monitor` (outil de base) : attendre une condition (fin de calcul) sans boucle de sommeil.
- Pistes de vitesse : `docs/PLAN_OPTIMISATIONS.md`.

## 7. Documentation, partage et divers

| Skill | Utilité ici |
|---|---|
| `init` | régénérer ou compléter `CLAUDE.md` |
| `gstack:document-release` | mettre à jour la documentation à la fin d'un lot |
| `anthropic-skills:docs`, `pdf`, `pptx`, `xlsx`, `docx` | rapport d'une analyse pour l'équipe (tableaux de kills, bilan par carte), présentation d'un replay |
| `brag` ou `hyperframes` | courte vidéo de démonstration de l'outil de replay |
| `anthropic-skills:deep-research` | rechercher les notes de patch et les statistiques d'armes (sites de la communauté) avant de mettre à jour l'onglet Stratégie |
| `update-config`, `fewer-permission-prompts`, `keybindings-help` | réglages de Claude Code, moins de demandes d'autorisation répétitives |
| `superpowers:dispatching-parallel-agents` | tâches indépendantes en parallèle (par exemple relire plusieurs cartes), **à éviter** quand le PC est chargé : un agent coûte du contexte et de la mémoire |

## 8. Recommandation : par quoi commencer

1. **`/code-review` (niveau `high`)** sur toute la branche : c'est le trou principal de la méthode actuelle.
2. **`security-review`** : un tour sur le serveur local (section 4).
3. **`gstack:qa`** sur le site complet après les derniers changements d'interface, à la place des scripts CDP écrits à la main.
4. **`superpowers:test-driven-development`** pour tout nouveau morceau pur de l'analyse (masque de déplacement, états de gadgets).
5. **`superpowers:systematic-debugging`** au premier comportement inexpliqué, avant de corriger.
6. **`superpowers:using-git-worktrees`** dès qu'un calcul long doit tourner pendant qu'on code sur une autre branche.
7. **`simplify`** quand les algorithmes seront stables (le suivi et la lecture de la minimap ont beaucoup grossi).

## 9. Règles pour ne pas gaspiller

- Ne déclencher un skill que si son résultat change le travail. Une correction de 1 ou 2 fichiers se fait directement.
- Pas d'agent quand on peut faire la tâche dans la session : un agent recharge le contexte et consomme des crédits et de la mémoire.
- Un seul calcul lourd à la fois (l'analyse, un agent, un navigateur de test) : le PC de développement a 8 Go de mémoire.
- Un skill n'est pas une preuve : après un `/code-review` ou un audit, vérifier chaque remarque (certaines sont plausibles sans être vraies) avant de la corriger.
