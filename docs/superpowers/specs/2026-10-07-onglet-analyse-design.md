# Onglet Analyse — design (chantier 1)

Date : 2026-10-07
Statut : à relire

## Contexte et objectif

EVA Strat est une app 100 % locale (Vite, React, Konva, Zustand) pour dessiner des stratégies sur des cartes. On ajoute un onglet **Analyse** qui permet de charger une vidéo de partie (fichier .mp4 ou URL YouTube), de la découper automatiquement en games, puis, dans des chantiers suivants, d'en extraire les positions des joueurs pour produire des récaps (heatmaps, occupation de l'espace, trous de formation) et croiser les habitudes des équipes sur plusieurs games.

Ce document couvre uniquement le **chantier 1**. Les deux suivants ont leur propre spec :

1. **Chantier 1 (ce document)** : onglet Analyse, lecteur, ingestion mp4 et YouTube, détection de segments, calibration des zones, schéma de base complet.
2. **Chantier 2** : extraction par vision (positions, directions, PV, armes, points de capture) dans `samples` et `capture_state`.
3. **Chantier 3** : récaps et analyse multi-games.

Plus tard, le même onglet accueillera l'éditeur de stratégie en temps réel pour des situations hypothétiques. Il est hors périmètre, mais l'architecture ne doit pas l'empêcher (voir « Composants »).

## Décisions

- Le traitement tourne **en local**. Un script Python fait l'analyse, le serveur de dev Vite l'orchestre. Aucun serveur supplémentaire.
- Le **bouton « Analyser » est dans l'app** : un plugin Vite expose les routes et lance le script.
- Les données sont dans **SQLite**, pour pouvoir croiser plusieurs games.
- Les vidéos font jusqu'à environ 10 Go : elles ne sont **jamais copiées**. On garde leur chemin.
- Les vidéos sont toujours en 1080p. Le layout du HUD peut varier selon la carte, d'où une **calibration par carte**.
- Entrées possibles : un .mp4 local, ou une URL YouTube téléchargée par yt-dlp dans un dossier de cache.

## Architecture

```
[Onglet Analyse] --POST /api/ingest--> [Plugin Vite] --spawn--> [analysis/analyze.py]
      ^                                    |                         |
      |<--GET /api/*, SSE progression------+<--lecture-- eva.db <--écriture
```

- `analysis/analyze.py` est **le seul à écrire les données d'analyse** (`videos`, games détectées, et plus tard `samples` et `capture_state`).
- Le plugin Vite (`server/analysisPlugin.ts`) utilise `node:sqlite` (natif dans Node 24). Il écrit **uniquement les corrections de l'utilisateur** (confirmer, ajuster, ajouter ou supprimer une game, enregistrer une calibration). Il lance et suit le script, et sert la vidéo avec les requêtes par plage d'octets (`Range`) nécessaires pour naviguer dans un fichier de 10 Go.
- La base est en mode WAL pour que le script et le serveur puissent l'utiliser en même temps. Le schéma vit dans un seul fichier, `analysis/schema.sql`, lu par Python et par Node.
- Le code existant sous `src/` n'est modifié que pour ajouter l'onglet et sa navigation.

### Dépendances à installer

- Python : `opencv-python`, `numpy`, `yt-dlp` (compatibilité avec Python 3.14 à vérifier à l'installation).
- ffmpeg est déjà présent.
- Aucune nouvelle dépendance npm attendue (`node:sqlite` est intégré).

## Schéma SQLite

| Table | Colonnes principales |
| --- | --- |
| `videos` | id, chemin, url_source (nullable), durée, fps, largeur, hauteur |
| `games` | id, video_id, début_s, fin_s, carte, statut (`detected` / `confirmed`), gagnant |
| `calibrations` | carte, zone (`minimap`, `capture_points`, `team_a_bar`, `team_b_bar`, `timer`), rectangle relatif (x, y, w, h entre 0 et 1) |
| `samples` | game_id, frame, t, slot (1 à 8), équipe, x, y, angle, vivant, pv, arme, confiance |
| `capture_state` | game_id, t, point, pourcentage, équipe |

- `samples` et `capture_state` sont créées dès le chantier 1 pour figer le schéma. Elles sont remplies au chantier 2.
- Les coordonnées de `samples` sont **normalisées (0 à 1) sur la minimap**, pour être superposables aux images de cartes de l'app quelle que soit la taille de la minimap.
- Les zones de `calibrations` sont en coordonnées relatives, donc indépendantes de la résolution.

## Onglet Analyse

### Disposition

- **Barre du haut** : un champ texte où l'on colle une URL YouTube ou le chemin d'un fichier .mp4 (un navigateur ne donne pas le chemin d'un fichier choisi, donc pas de sélecteur de fichier ; les guillemets du « Copier en tant que chemin » de Windows sont retirés), un bouton « Analyser » et une barre de progression.
- **Zone principale** : lecteur vidéo HTML5 (aucune barre YouTube) et timeline où les segments de game apparaissent en couleur et le lobby en gris.
- **Panneau latéral** : liste des games détectées (début, fin, carte, durée). On ajuste les bornes (champs ou glisser sur la timeline), on renomme la carte, on confirme ou supprime un segment.

### Composants

Chaque composant est indépendant et communique par un store Zustand dédié (`analysisStore`) qui porte la vidéo courante, le temps courant et la game sélectionnée :

- `VideoPlayer` : lecture et position courante.
- `SegmentTimeline` : affichage et édition des bornes.
- `GameList` : liste et actions sur les segments.
- `CalibrationEditor` : dessin des zones sur une frame.
- `IngestBar` : saisie de la source et lancement.

Le futur éditeur de stratégie en temps réel se branchera sur le même store (temps courant et game sélectionnée), sans modifier ces composants.

### Calibration

- Bouton « Calibrer » : on choisit une frame de la vidéo, on dessine les rectangles (minimap, points de capture, bandeaux d'équipe, chrono).
- Les zones sont enregistrées **par carte** dans `calibrations`.
- Au premier lancement, des zones par défaut tirées de la capture de référence sont préremplies.

## Détection des segments

- Le script échantillonne la vidéo à 1 image par seconde et teste la présence du HUD de jeu : les bandeaux de joueurs orange (une équipe) et bleu (l'autre) dans les zones du haut. Le chrono n'est pas lu par OCR au chantier 1.
- Une période où le HUD est présent en continu devient un segment `detected`. Une courte coupure (chargement, pause) ne casse pas le segment, grâce à une tolérance réglable (valeur par défaut à fixer à l'implémentation sur des vidéos réelles).
- Les segments ne sont jamais confirmés automatiquement : c'est l'utilisateur qui valide.

## Gestion des erreurs

- Échec de yt-dlp (URL privée, réseau) : message clair, aucune écriture en base.
- Fichier introuvable ou illisible : erreur affichée dans la barre du haut.
- Analyse interrompue : rien n'est écrit en base (les segments sont enregistrés d'un seul bloc à la fin) et il suffit de relancer. Les games déjà confirmées par l'utilisateur ne sont jamais écrasées par une nouvelle analyse. La reprise partielle ne concerne que l'extraction du chantier 2.
- Un chrono ou HUD illisible sur une image est ignoré et compté dans un indicateur de qualité par game, sans arrêter l'analyse.

## Tests

- **Python** : tests sur des images de référence (la capture fournie et quelques autres) pour la détection du HUD, avec une base temporaire.
- **Serveur** : tests des routes sur une base temporaire (liste des games, plage d'octets, progression).
- **UI** : vérification manuelle du lecteur, du découpage et de la calibration sur une vraie vidéo.

## Notes pour les chantiers suivants

- **Identité des joueurs (chantier 2)** : les bandeaux du haut sont dans un ordre fixe pendant la game. Ils servent de référence pour les slots 1 à 8. Le script attribue les points de la minimap aux slots par suivi, d'abord au spawn puis d'une image à l'autre. Un numéro lisible sur la minimap recale le suivi. Un joueur mort se repère par son bandeau. Chaque échantillon porte une `confiance` pour signaler les croisements ambigus entre joueurs d'une même équipe.
- **Cadence d'échantillonnage** : une image sur 6 par défaut (10 par seconde à 60 fps), réglable. Plus la valeur est petite, plus l'analyse est longue.
- **À vérifier au chantier 2 avec un extrait vidéo** : le nombre exact de slots affichés dans les bandeaux (la capture de référence montre des étiquettes jusqu'à 9), l'apparence d'un joueur mort sur la minimap et celle du cône de direction.
